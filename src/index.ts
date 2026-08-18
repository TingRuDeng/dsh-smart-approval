/** DSH bundle plugin that reviews approval requests before the human answerer. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import { createSmartApprovalHandler } from './approval-handler.ts'
import {
  createFileTargetInspector,
  type FileProbeTarget,
  type FileTargetFileSystem,
} from './file-target-inspector.ts'
import { createLlmReviewer, resolveLlmReviewerConfig } from './llm-reviewer.ts'
import {
  applyReviewModeEvent, DEFAULT_REVIEW_MODE, foldReviewModeEvents, initialReviewModeState,
  REVIEW_MODES, reviewModeProjectionSchema, viewReviewModeProjection,
} from './review-mode.ts'
import type { ReviewMode, ReviewModeProjectionState } from './review-mode.ts'
import {
  reviewerModelCatalog,
  reviewerModelProjection,
  reviewerConfigForRequest,
  routeAvailable,
  SMART_APPROVAL_SETTINGS_NAMESPACE,
  SmartApprovalSettingsSchema,
  validateSmartApprovalSettings,
  type ReviewerRouteState,
} from './reviewer-settings.ts'
import { reviewModeDomainSpec, ReviewModeStore } from './review-mode-storage.ts'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_TOKENS = 128
const DEFAULT_MAX_TOOL_ARGUMENT_CHARS = 12_000
const DEFAULT_MAX_USER_MESSAGES = 4
const DEFAULT_MAX_USER_CONTEXT_CHARS = 8_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

interface SmartApprovalSettingsScope {
  get(): import('./reviewer-settings.ts').SmartApprovalSettings
  replace(section: object): Promise<void>
}

interface SmartApprovalMutableRouteState extends ReviewerRouteState {
  readonly scope: SmartApprovalSettingsScope
}

interface SmartApprovalConnection {
  readonly rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown) => Promise<unknown>,
      options: { readonly authority: 'trusted-host' },
    ): () => Promise<void>
  }
}

/** Cordis plugin name used in diagnostics. */
export const name = 'dsh-smart-approval'

/** Services that must exist before the answerer registers. */
export const inject = ['approval', 'llm', 'sessions', 'storageDomain', 'fs']

/** Runtime configuration for smart approval. */
export interface Config {
  /** Review mode used by sessions without an explicit selection. */
  readonly defaultMode?: ReviewMode
  /** Optional dedicated reviewer provider; configure together with `reviewerModel`. */
  readonly reviewerProvider?: string
  /** Optional dedicated reviewer model; configure together with `reviewerProvider`. */
  readonly reviewerModel?: string
  /** Whole reviewer-call deadline in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum reviewer output tokens. */
  readonly maxTokens?: number
  /** Maximum raw character count of one tool argument object. */
  readonly maxToolArgumentChars?: number
  /** Number of current and recent direct-user messages included as authorization context. */
  readonly maxUserMessages?: number
  /** Maximum combined character count of included direct-user messages. */
  readonly maxUserContextChars?: number
}

/** Cordis configuration schema with conservative bounded defaults. */
export const Config: z<Config> = z.object({
  defaultMode: z.union(REVIEW_MODES as unknown as ReviewMode[]).default(DEFAULT_REVIEW_MODE),
  reviewerProvider: z.string().min(1),
  reviewerModel: z.string().min(1),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  maxToolArgumentChars: z.number().step(1).min(1).default(DEFAULT_MAX_TOOL_ARGUMENT_CHARS),
  maxUserMessages: z.number().step(1).min(1).default(DEFAULT_MAX_USER_MESSAGES),
  maxUserContextChars: z.number().step(1).min(1).default(DEFAULT_MAX_USER_CONTEXT_CHARS),
})

/**
 * Register a prepended approval answerer. Mode is resolved from the durable
 * sidecar for every request, so `/approval-mode` changes take effect without
 * plugin reload or extension events in the Session log.
 * @param ctx - Cordis context with DSH approval, session, storage, and LLM services.
 * @param config - optional reviewer route and bounded context limits.
 */
export function apply(ctx: Context, config: Config = {}): Promise<void> {
  const defaultMode = config.defaultMode ?? DEFAULT_REVIEW_MODE
  const profile = resolveLlmReviewerConfig({
    ...config.reviewerProvider === undefined ? {} : { provider: config.reviewerProvider },
    ...config.reviewerModel === undefined ? {} : { model: config.reviewerModel },
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
  })
  let reviewerState: SmartApprovalMutableRouteState | undefined
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(
      SMART_APPROVAL_SETTINGS_NAMESPACE,
      SmartApprovalSettingsSchema,
      { validate: validateSmartApprovalSettings },
    )
    reviewerState = { scope, profile }
  })
  const review = createLlmReviewer(ctx.llm, () => reviewerState === undefined
    ? profile
    : reviewerConfigForRequest(reviewerState, {
        timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      }))
  return mount(ctx, config, defaultMode, review, () => reviewerState)
}

/** Open the sidecar before exposing any mode-dependent handler. */
async function mount(
  ctx: Context,
  config: Config,
  defaultMode: ReviewMode,
  review: ReturnType<typeof createLlmReviewer>,
  reviewerState: () => SmartApprovalMutableRouteState | undefined,
): Promise<void> {
  const domain = await ctx.storageDomain.open(reviewModeDomainSpec)
  ctx.effect(() => () => domain.close(), 'smart-approval: close review mode sidecar')
  const modeStore = new ReviewModeStore(domain.table('sessions'))
  const fallbackModes = new WeakMap<Session, ReviewMode>()
  const migrate = async (session: Session): Promise<void> => {
    const state = foldReviewModeEvents(session.events, defaultMode)
    fallbackModes.set(session, state.mode)
    if (state.origin === 'default' || modeStore.get(session) !== undefined) return
    await modeStore.set(session, state.mode)
  }
  const currentMode = (session: Session): ReviewMode =>
    modeStore.get(session) ?? fallbackModes.get(session) ?? defaultMode
  for (const session of ctx.sessions.list()) {
    await migrate(session)
  }
  ctx.on('session/created', async (session) => {
    try {
      await migrate(session)
    } catch (error) {
      ctx.logger.warn(`smart-approval: failed to persist initial review mode: ${String(error)}`)
    }
  })
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register<'approvalReview', ReviewModeProjectionState>({
      key: 'approvalReview',
      schema: reviewModeProjectionSchema,
      init: () => initialReviewModeState(defaultMode),
      apply: applyReviewModeEvent,
      view: viewReviewModeProjection,
      stateVersion: 3,
    })
  })
  ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      name: 'approval-mode',
      description: 'Switch automatic approval review mode',
      input: { hint: '<manual|smart|unattended>' },
      handler: async ({ agent, rawInput }) => {
        const mode = rawInput.trim()
        if (mode === '') {
          return { kind: 'success', text: `current approval mode ${currentMode(agent.session)}` }
        }
        if (!(REVIEW_MODES as readonly string[]).includes(mode)) {
          return { kind: 'error', text: `unknown approval mode "${mode}" (available: ${REVIEW_MODES.join(', ')})` }
        }
        await modeStore.set(agent.session, mode as ReviewMode)
        return { kind: 'success', text: `approval mode ${mode}` }
      },
    })
  })
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = (connectionCtx as Context & { connection: SmartApprovalConnection }).connection
    connectionCtx.effect(() => connection.rpc.handle('/smart-approval', async (endpoint, payload) => {
      const state = reviewerState()
      if (state === undefined) {
        return { ok: false, error: { code: 'internal', message: 'smart approval settings are not available', details: {} } }
      }
      const profileRoute = state.profile.provider !== undefined && state.profile.model !== undefined
      if (endpoint === 'reviewer-model') {
        const providers = await reviewerModelCatalog(ctx.llm, message => ctx.logger.warn(message))
        return { ok: true, value: reviewerModelProjection(state.scope.get(), providers, profileRoute) }
      }
      if (endpoint === 'set-reviewer-model') {
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
          return { ok: false, error: { code: 'bad-request', message: 'expected reviewer model payload', details: { issues: [] } } }
        }
        const candidate = payload as Record<string, unknown>
        const provider = candidate.reviewerProvider
        const model = candidate.reviewerModel
        if (provider === undefined && model === undefined) {
          await state.scope.replace({})
          const providers = await reviewerModelCatalog(ctx.llm, message => ctx.logger.warn(message))
          return { ok: true, value: reviewerModelProjection(state.scope.get(), providers, profileRoute) }
        }
        if (typeof provider !== 'string' || typeof model !== 'string') {
          return { ok: false, error: { code: 'bad-request', message: 'expected reviewerProvider and reviewerModel together', details: { issues: [] } } }
        }
        const providers = await reviewerModelCatalog(ctx.llm, message => ctx.logger.warn(message))
        if (!routeAvailable(providers, provider, model)) {
          return { ok: false, error: { code: 'model-unavailable', message: 'the selected reviewer model is unavailable', details: { provider, model } } }
        }
        await state.scope.replace({ reviewerProvider: provider, reviewerModel: model })
        return { ok: true, value: reviewerModelProjection(state.scope.get(), providers, profileRoute) }
      }
      return { ok: false, error: { code: 'bad-request', message: 'unknown smart approval endpoint', details: { issues: [] } } }
    }, { authority: 'trusted-host' }), 'smart-approval: reviewer settings RPC')
  })

  const handler = createSmartApprovalHandler({
    currentMode,
    limits: {
      maxToolArgumentChars: config.maxToolArgumentChars ?? DEFAULT_MAX_TOOL_ARGUMENT_CHARS,
      maxUserMessages: config.maxUserMessages ?? DEFAULT_MAX_USER_MESSAGES,
      maxUserContextChars: config.maxUserContextChars ?? DEFAULT_MAX_USER_CONTEXT_CHARS,
    },
    inspectFileTarget: createFileTargetInspector(
      (ctx as Context & { fs: FileTargetFileSystem<FileProbeTarget> }).fs,
    ),
    review,
    log: record => ctx.logger.info(
      `smart-approval: ${record.outcome} (${record.reasonCode}) for tool ${JSON.stringify(record.toolName)}`,
    ),
  })
  ctx.on('approval/request', handler, { prepend: true })
}
