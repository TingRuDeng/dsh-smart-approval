/** DSH bundle plugin that reviews approval requests before the human answerer. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-user-approval'
import { createSmartApprovalHandler } from './approval-handler.ts'
import { createLlmReviewer, resolveLlmReviewerConfig } from './llm-reviewer.ts'

const DEFAULT_PRESET = 'smart-approval'
const DEFAULT_UNATTENDED_PRESET = 'unattended'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_TOKENS = 128
const DEFAULT_MAX_TOOL_ARGUMENT_CHARS = 12_000
const DEFAULT_MAX_USER_MESSAGES = 4
const DEFAULT_MAX_USER_CONTEXT_CHARS = 8_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Cordis plugin name used in diagnostics. */
export const name = 'dsh-smart-approval'

/** Services that must exist before the answerer registers. */
export const inject = ['approval', 'permissionPresets', 'llm']

/** Runtime configuration for smart approval. */
export interface Config {
  /** Permission preset that activates smart review. */
  readonly preset?: string
  /** Permission preset that activates unattended review. */
  readonly unattendedPreset?: string
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
  /** Number of current-turn direct-user messages included as authorization context. */
  readonly maxUserMessages?: number
  /** Maximum combined character count of included direct-user messages. */
  readonly maxUserContextChars?: number
}

/** Cordis configuration schema with conservative bounded defaults. */
export const Config: z<Config> = z.object({
  preset: z.string().min(1).default(DEFAULT_PRESET),
  unattendedPreset: z.string().min(1).default(DEFAULT_UNATTENDED_PRESET),
  reviewerProvider: z.string().min(1),
  reviewerModel: z.string().min(1),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  maxToolArgumentChars: z.number().step(1).min(1).default(DEFAULT_MAX_TOOL_ARGUMENT_CHARS),
  maxUserMessages: z.number().step(1).min(1).default(DEFAULT_MAX_USER_MESSAGES),
  maxUserContextChars: z.number().step(1).min(1).default(DEFAULT_MAX_USER_CONTEXT_CHARS),
})

/**
 * Register a prepended approval answerer. Mode is resolved from the session log
 * for every request, so `/permission` changes take effect without plugin reload.
 * @param ctx - Cordis context with DSH approval, permission, and LLM services.
 * @param config - optional reviewer route and bounded context limits.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const preset = config.preset ?? DEFAULT_PRESET
  const unattendedPreset = config.unattendedPreset ?? DEFAULT_UNATTENDED_PRESET
  if (preset === unattendedPreset) {
    throw new Error('smart-approval: smart and unattended presets must be different')
  }
  const reviewerConfig = resolveLlmReviewerConfig({
    ...config.reviewerProvider === undefined ? {} : { provider: config.reviewerProvider },
    ...config.reviewerModel === undefined ? {} : { model: config.reviewerModel },
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
  })
  const review = createLlmReviewer(ctx.llm, reviewerConfig)
  const handler = createSmartApprovalHandler({
    preset,
    unattendedPreset,
    currentPreset: events => ctx.permissionPresets.current(events),
    limits: {
      maxToolArgumentChars: config.maxToolArgumentChars ?? DEFAULT_MAX_TOOL_ARGUMENT_CHARS,
      maxUserMessages: config.maxUserMessages ?? DEFAULT_MAX_USER_MESSAGES,
      maxUserContextChars: config.maxUserContextChars ?? DEFAULT_MAX_USER_CONTEXT_CHARS,
    },
    review,
    log: record => ctx.logger.info(
      `smart-approval: ${record.outcome} (${record.reasonCode}) for tool ${JSON.stringify(record.toolName)}`,
    ),
  })
  ctx.on('approval/request', handler, { prepend: true })
}
