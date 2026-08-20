/** DSH bundle plugin that reviews approval requests before the human answerer. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { Session } from '@deepseek-ai/dsh-session'
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
  DecisionLogStore, reviewModeDomainSpec, ReviewModeStore, type DecisionEntry,
} from './review-mode-storage.ts'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_TOKENS = 128
const DEFAULT_MAX_TOOL_ARGUMENT_CHARS = 12_000
const DEFAULT_MAX_USER_MESSAGES = 4
const DEFAULT_MAX_USER_CONTEXT_CHARS = 8_000
const DEFAULT_DECISION_LOG_SIZE = 50
const DEFAULT_APPROVAL_LOG_COUNT = 10
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Cordis plugin name used in diagnostics. */
export const name = 'dsh-smart-approval'

/** Services that must exist before the answerer registers. */
export const inject = ['approval', 'llm', 'sessions', 'storageDomain', 'fs']

/** Runtime configuration for smart approval. */
export interface Config {
  /** Review mode used by sessions without an explicit selection. */
  readonly defaultMode?: ReviewMode
  /** Optional dedicated reviewer provider; configure together with reviewerModel. */
  readonly reviewerProvider?: string
  /** Optional dedicated reviewer model; configure together with reviewerProvider. */
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
  /** Maximum persisted decision-audit entries per Session lifecycle; 0 disables the audit. */
  readonly decisionLogSize?: number
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
  decisionLogSize: z.number().step(1).min(0).default(DEFAULT_DECISION_LOG_SIZE),
})

/**
 * Register a prepended approval answerer. Mode is resolved from the durable
 * sidecar for every request, so /approval-mode changes take effect without
 * plugin reload or extension events in the Session log.
 * @param ctx - Cordis context with DSH approval, session, storage, and LLM services.
 * @param config - optional reviewer route and bounded context limits.
 */
export function apply(ctx: Context, config: Config = {}): Promise<void> {
  const defaultMode = config.defaultMode ?? DEFAULT_REVIEW_MODE
  const reviewerConfig = resolveLlmReviewerConfig({
    ...config.reviewerProvider === undefined ? {} : { provider: config.reviewerProvider },
    ...config.reviewerModel === undefined ? {} : { model: config.reviewerModel },
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
  })
  const review = createLlmReviewer(ctx.llm, reviewerConfig)
  return mount(ctx, config, defaultMode, review)
}

/** Open the sidecar before exposing any mode-dependent handler. */
async function mount(
  ctx: Context,
  config: Config,
  defaultMode: ReviewMode,
  review: ReturnType<typeof createLlmReviewer>,
): Promise<void> {
  const domain = await ctx.storageDomain.open(reviewModeDomainSpec)
  ctx.effect(() => () => domain.close(), 'smart-approval: close review mode sidecar')
  const modeStore = new ReviewModeStore(domain.table('sessions'))
  const decisionLogSize = config.decisionLogSize ?? DEFAULT_DECISION_LOG_SIZE
  const decisionStore = new DecisionLogStore(domain.table('decisions'), decisionLogSize)
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
      ctx.logger.warn('smart-approval: failed to persist initial review mode: ' + String(error))
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
          return { kind: 'success', text: 'current approval mode ' + currentMode(agent.session) }
        }
        if (!(REVIEW_MODES as readonly string[]).includes(mode)) {
          return { kind: 'error', text: 'unknown approval mode "' + mode + '" (available: ' + REVIEW_MODES.join(', ') + ')' }
        }
        await modeStore.set(agent.session, mode as ReviewMode)
        return { kind: 'success', text: 'approval mode ' + mode }
      },
    })
    scope.commands.register({
      name: 'approval-log',
      description: 'List automatic approval decisions in this session',
      input: { hint: '[count]' },
      handler: async ({ agent, rawInput }) => {
        if (decisionLogSize === 0) {
          return { kind: 'success', text: 'decision log disabled' }
        }
        const count = parseDecisionLogCount(rawInput)
        if (count === undefined) {
          return { kind: 'error', text: 'invalid approval-log count "' + rawInput.trim() + '"' }
        }
        const entries = decisionStore.list(agent.session).slice(-count).reverse()
        if (entries.length === 0) {
          return { kind: 'success', text: 'no automatic decisions in this session' }
        }
        return { kind: 'success', text: entries.map(formatDecisionEntry).join('\n') }
      },
    })
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
    log: record => {
      ctx.logger.info(
        'smart-approval: ' + record.outcome + ' (' + record.reasonCode + ') for tool ' + JSON.stringify(record.toolName),
      )
      if (decisionLogSize === 0) return
      void decisionStore.append(record.session, {
        toolName: record.toolName,
        outcome: record.outcome,
        reasonCode: record.reasonCode,
        ...(record.mode === undefined ? {} : { mode: record.mode }),
        ...(record.callId === undefined ? {} : { callId: record.callId }),
      }).catch(() => {
        // The audit is a side channel: a failed write never changes the approval outcome.
      })
    },
  })
  ctx.on('approval/request', handler, { prepend: true })
}

/** Parse an optional positive audit count; undefined on malformed input. */
function parseDecisionLogCount(rawInput: string): number | undefined {
  const input = rawInput.trim()
  if (input === '') return DEFAULT_APPROVAL_LOG_COUNT
  if (!/^[1-9]\d*$/.test(input)) return undefined
  return Number(input)
}

/** One audit line: time, tool, outcome, reason code, and active mode. */
function formatDecisionEntry(entry: DecisionEntry): string {
  const mode = entry.mode === undefined ? '' : ' [' + entry.mode + ']'
  return new Date(entry.time).toISOString() + ' ' + entry.toolName + ' ' + entry.outcome
    + ' (' + entry.reasonCode + ')' + mode
}
