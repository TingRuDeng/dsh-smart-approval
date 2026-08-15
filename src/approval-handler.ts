/** Fail-closed composition of mode selection, context extraction, and review. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { preflightApproval, type ReviewerDecision } from './review-policy.ts'
import { buildReviewPayload, type ReviewContextLimits, type ReviewPayload } from './review-context.ts'

/** Sanitized decision record suitable for operational logs. */
export interface SmartApprovalLogRecord {
  /** Whether the plugin granted, delegated, rejected, or observed cancellation. */
  readonly outcome: 'allowed-once' | 'human' | 'rejected' | 'cancelled'
  /** Stable machine-readable reason without raw arguments or model prose. */
  readonly reasonCode: string
  /** Tool name from the approval request. */
  readonly toolName: string
}

/** Collaborators used by the approval waterfall listener. */
export interface SmartApprovalHandlerOptions {
  /** Permission preset name that activates smart review. */
  readonly preset: string
  /** Permission preset name that activates unattended review. */
  readonly unattendedPreset: string
  /** Resolve the selected permission preset from one session log. */
  readonly currentPreset: (events: readonly SessionEvent[]) => string
  /** Trusted-context limits. */
  readonly limits: ReviewContextLimits
  /** Review one prepared payload. A null result is an invalid/unavailable review. */
  readonly review: (
    payload: ReviewPayload,
    request: ApprovalRequest,
  ) => Promise<ReviewerDecision | null>
  /** Record a sanitized outcome. */
  readonly log: (record: SmartApprovalLogRecord) => void
}

/** Signature of one `approval/request` waterfall answerer. */
export type SmartApprovalHandler = (
  request: ApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
) => Promise<ApprovalOutcome>

/**
 * Create the answerer that claims reviewed low-risk grants, delegates smart
 * uncertainty, and rejects non-safe unattended or clearly malicious requests.
 * @param options - mode resolver, reviewer, limits, and sanitized logger.
 * @returns an `approval/request` listener.
 */
export function createSmartApprovalHandler(options: SmartApprovalHandlerOptions): SmartApprovalHandler {
  return async (request, next) => {
    let selectedPreset: string
    try {
      selectedPreset = options.currentPreset(request.agent.session.events)
    } catch {
      safeLog(options, { outcome: 'human', reasonCode: 'preset-error', toolName: request.toolName })
      return next()
    }
    const mode = automatedMode(selectedPreset, options)
    if (mode === undefined) return next()
    if (requestAborted(request)) {
      safeLog(options, { outcome: 'cancelled', reasonCode: 'request-cancelled', toolName: request.toolName })
      return 'cancelled'
    }

    let context: ReturnType<typeof buildReviewPayload>
    try {
      context = buildReviewPayload(request, options.limits)
    } catch {
      return rejectOrHandoff(mode, 'context-error', request, next, options)
    }
    if (context.kind === 'human') {
      return rejectOrHandoff(mode, context.reasonCode, request, next, options)
    }
    let preflight: ReviewerDecision | null
    try {
      preflight = preflightApproval(
        context.payload.action,
        context.payload.userRequests,
        context.payload.workspaceRoot,
      )
    } catch {
      return rejectOrHandoff(mode, 'preflight-error', request, next, options)
    }
    if (preflight !== null) {
      if (preflight.decision === 'reject') {
        safeLog(options, { outcome: 'rejected', reasonCode: preflight.reasonCode, toolName: request.toolName })
        return 'rejected'
      }
      return rejectOrHandoff(mode, preflight.reasonCode, request, next, options)
    }

    let decision: ReviewerDecision | null = null
    let reviewFailed = false
    try {
      decision = await options.review(context.payload, request)
    } catch {
      if (requestAborted(request)) {
        safeLog(options, { outcome: 'cancelled', reasonCode: 'request-cancelled', toolName: request.toolName })
        return 'cancelled'
      }
      reviewFailed = true
    }
    if (requestAborted(request)) {
      safeLog(options, { outcome: 'cancelled', reasonCode: 'request-cancelled', toolName: request.toolName })
      return 'cancelled'
    }
    let currentPreset: string
    try {
      currentPreset = options.currentPreset(request.agent.session.events)
    } catch {
      return rejectOrHandoff(mode, 'preset-error', request, next, options)
    }
    if (currentPreset !== selectedPreset) {
      if (currentPreset === options.unattendedPreset) {
        safeLog(options, { outcome: 'rejected', reasonCode: 'preset-changed', toolName: request.toolName })
        return 'rejected'
      }
      safeLog(options, { outcome: 'human', reasonCode: 'preset-changed', toolName: request.toolName })
      return next()
    }
    if (reviewFailed) return rejectOrHandoff(mode, 'reviewer-error', request, next, options)
    if (decision?.decision === 'reject') {
      safeLog(options, { outcome: 'rejected', reasonCode: decision.reasonCode, toolName: request.toolName })
      return 'rejected'
    }
    if (decision?.decision === 'allow') {
      safeLog(options, { outcome: 'allowed-once', reasonCode: decision.reasonCode, toolName: request.toolName })
      return 'allowed-once'
    }
    return rejectOrHandoff(mode, decision?.reasonCode ?? 'invalid-review', request, next, options)
  }
}

type AutomatedApprovalMode = 'smart' | 'unattended'

/** Map one selected preset to an automated approval mode. */
function automatedMode(
  selectedPreset: string,
  options: SmartApprovalHandlerOptions,
): AutomatedApprovalMode | undefined {
  if (selectedPreset === options.preset) return 'smart'
  if (selectedPreset === options.unattendedPreset) return 'unattended'
  return undefined
}

/** Smart mode delegates non-allows; unattended mode rejects them locally. */
function rejectOrHandoff(
  mode: AutomatedApprovalMode,
  reasonCode: string,
  request: ApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
  options: SmartApprovalHandlerOptions,
): Promise<ApprovalOutcome> {
  if (mode === 'unattended') {
    safeLog(options, { outcome: 'rejected', reasonCode, toolName: request.toolName })
    return Promise.resolve('rejected')
  }
  safeLog(options, { outcome: 'human', reasonCode, toolName: request.toolName })
  return next()
}

/** Keep logging failures from changing the approval outcome. */
function safeLog(options: SmartApprovalHandlerOptions, record: SmartApprovalLogRecord): void {
  try {
    options.log(record)
  } catch {
    // Operational logging is deliberately non-authoritative for approval policy.
  }
}

/** Read cancellation at the instant a decision would be made. */
function requestAborted(request: ApprovalRequest): boolean {
  return request.signal?.aborted === true
}
