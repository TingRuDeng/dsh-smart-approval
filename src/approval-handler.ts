/** Fail-closed composition of mode selection, context extraction, and review. */

import type { Session } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import {
  decisionFromAssessment,
  preflightApproval,
  preflightFileTarget,
  type ReviewerAssessment,
  type ReviewerDecision,
} from './review-policy.ts'
import {
  buildReviewPayload,
  type FileReviewAction,
  type FileTargetInspectionResult,
  type ReviewContextLimits,
  type ReviewPayload,
} from './review-context.ts'
import type { ReviewMode } from './review-mode.ts'
import type { DecisionOutcome } from './review-mode-storage.ts'

/** Sanitized decision record suitable for operational logs and the decision audit. */
export interface SmartApprovalLogRecord {
  /** The session whose request was decided; anchors the durable audit row. */
  readonly session: Session
  /** Whether the plugin granted, delegated, rejected, or observed cancellation. */
  readonly outcome: DecisionOutcome
  /** Stable machine-readable reason without raw arguments or model prose. */
  readonly reasonCode: string
  /** Tool name from the approval request. */
  readonly toolName: string
  /** Review mode in force when the outcome was decided; absent when the mode resolver itself failed. */
  readonly mode?: ReviewMode
  /** Tool-call identity from the approval request, for cross-checking session events. */
  readonly callId?: string
}

/** Collaborators used by the approval waterfall listener. */
export interface SmartApprovalHandlerOptions {
  /** Resolve the independent automatic review mode for one Session lifecycle. */
  readonly currentMode: (session: Session) => ReviewMode
  /** Trusted-context limits. */
  readonly limits: ReviewContextLimits
  /** Resolve read-only target evidence for a normalized file mutation. */
  readonly inspectFileTarget?: (
    action: FileReviewAction,
    workspaceRoot: string | undefined,
    request: ApprovalRequest,
  ) => Promise<FileTargetInspectionResult>
  /** Review one prepared payload. A null result is an invalid/unavailable review. */
  readonly review: (
    payload: ReviewPayload,
    request: ApprovalRequest,
  ) => Promise<ReviewerAssessment | null>
  /** Record a sanitized outcome. */
  readonly log: (record: SmartApprovalLogRecord) => void
}

/** Signature of one approval/request waterfall answerer. */
export type SmartApprovalHandler = (
  request: ApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
) => Promise<ApprovalOutcome>

/**
 * Create the answerer that claims reviewed low-risk grants, delegates smart
 * uncertainty, and rejects non-safe unattended or clearly malicious requests.
 * @param options - mode resolver, reviewer, limits, and sanitized logger.
 * @returns an approval/request listener.
 */
export function createSmartApprovalHandler(options: SmartApprovalHandlerOptions): SmartApprovalHandler {
  return async (request, next) => {
    let selectedMode: ReviewMode
    try {
      selectedMode = options.currentMode(request.agent.session)
    } catch {
      safeLog(options, decisionRecord(request, { outcome: 'human', reasonCode: 'mode-error' }))
      return next()
    }
    if (selectedMode === 'manual') return next()
    if (requestAborted(request)) {
      safeLog(options, decisionRecord(request, {
        outcome: 'cancelled', reasonCode: 'request-cancelled', mode: selectedMode,
      }))
      return 'cancelled'
    }

    let context: ReturnType<typeof buildReviewPayload>
    try {
      context = buildReviewPayload(request, options.limits)
    } catch {
      return rejectOrHandoff(selectedMode, 'context-error', request, next, options)
    }
    if (context.kind === 'human') {
      return rejectOrHandoff(selectedMode, context.reasonCode, request, next, options)
    }
    let preflight: ReviewerDecision | null
    try {
      preflight = preflightApproval(
        context.payload.action,
        context.payload.trustedUserContext.messages,
        context.payload.workspaceRoot,
      )
    } catch {
      return rejectOrHandoff(selectedMode, 'preflight-error', request, next, options)
    }
    if (preflight !== null) {
      if (preflight.decision === 'reject') {
        safeLog(options, decisionRecord(request, {
          outcome: 'rejected', reasonCode: preflight.reasonCode, mode: selectedMode,
        }))
        return 'rejected'
      }
      return rejectOrHandoff(selectedMode, preflight.reasonCode, request, next, options)
    }

    let reviewPayload = context.payload
    if (context.payload.action.kind === 'file-write' || context.payload.action.kind === 'file-edit') {
      if (options.inspectFileTarget === undefined) {
        return rejectOrHandoff(selectedMode, 'file-target-unavailable', request, next, options)
      }
      let inspection: FileTargetInspectionResult
      try {
        inspection = await options.inspectFileTarget(
          context.payload.action,
          context.payload.workspaceRoot,
          request,
        )
      } catch {
        if (requestAborted(request)) {
          safeLog(options, decisionRecord(request, {
            outcome: 'cancelled', reasonCode: 'request-cancelled', mode: selectedMode,
          }))
          return 'cancelled'
        }
        return rejectOrHandoff(selectedMode, 'file-target-error', request, next, options)
      }
      if (requestAborted(request)) {
        safeLog(options, decisionRecord(request, {
          outcome: 'cancelled', reasonCode: 'request-cancelled', mode: selectedMode,
        }))
        return 'cancelled'
      }
      if (inspection.kind === 'human') {
        return rejectOrHandoff(selectedMode, inspection.reasonCode, request, next, options)
      }
      const targetPreflight = preflightFileTarget(context.payload.action, inspection.evidence)
      if (targetPreflight !== null) {
        if (targetPreflight.decision === 'reject') {
          safeLog(options, decisionRecord(request, {
            outcome: 'rejected',
            reasonCode: targetPreflight.reasonCode,
            mode: selectedMode,
          }))
          return 'rejected'
        }
        return rejectOrHandoff(selectedMode, targetPreflight.reasonCode, request, next, options)
      }
      reviewPayload = { ...context.payload, fileTarget: inspection.evidence }
      let modeAfterInspection: ReviewMode
      try {
        modeAfterInspection = options.currentMode(request.agent.session)
      } catch {
        return rejectOrHandoff(selectedMode, 'mode-error', request, next, options)
      }
      if (modeAfterInspection !== selectedMode) {
        if (modeAfterInspection === 'unattended') {
          safeLog(options, decisionRecord(request, {
            outcome: 'rejected', reasonCode: 'mode-changed', mode: modeAfterInspection,
          }))
          return 'rejected'
        }
        safeLog(options, decisionRecord(request, {
          outcome: 'human', reasonCode: 'mode-changed', mode: modeAfterInspection,
        }))
        return next()
      }
    }

    let assessment: ReviewerAssessment | null = null
    let reviewFailed = false
    try {
      assessment = await options.review(reviewPayload, request)
    } catch {
      if (requestAborted(request)) {
        safeLog(options, decisionRecord(request, {
          outcome: 'cancelled', reasonCode: 'request-cancelled', mode: selectedMode,
        }))
        return 'cancelled'
      }
      reviewFailed = true
    }
    if (requestAborted(request)) {
      safeLog(options, decisionRecord(request, {
        outcome: 'cancelled', reasonCode: 'request-cancelled', mode: selectedMode,
      }))
      return 'cancelled'
    }
    let currentMode: ReviewMode
    try {
      currentMode = options.currentMode(request.agent.session)
    } catch {
      return rejectOrHandoff(selectedMode, 'mode-error', request, next, options)
    }
    if (currentMode !== selectedMode) {
      if (currentMode === 'unattended') {
        safeLog(options, decisionRecord(request, {
          outcome: 'rejected', reasonCode: 'mode-changed', mode: currentMode,
        }))
        return 'rejected'
      }
      safeLog(options, decisionRecord(request, {
        outcome: 'human', reasonCode: 'mode-changed', mode: currentMode,
      }))
      return next()
    }
    if (reviewFailed) return rejectOrHandoff(selectedMode, 'reviewer-error', request, next, options)
    const decision = assessment === null ? null : decisionFromAssessment(assessment)
    if (decision?.decision === 'reject') {
      safeLog(options, decisionRecord(request, {
        outcome: 'rejected', reasonCode: decision.reasonCode, mode: selectedMode,
      }))
      return 'rejected'
    }
    if (decision?.decision === 'allow') {
      safeLog(options, decisionRecord(request, {
        outcome: 'allowed-once', reasonCode: decision.reasonCode, mode: selectedMode,
      }))
      return 'allowed-once'
    }
    return rejectOrHandoff(selectedMode, decision?.reasonCode ?? 'invalid-review', request, next, options)
  }
}

type AutomatedApprovalMode = Exclude<ReviewMode, 'manual'>

/** Smart mode delegates non-allows; unattended mode rejects them locally. */
function rejectOrHandoff(
  mode: AutomatedApprovalMode,
  reasonCode: string,
  request: ApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
  options: SmartApprovalHandlerOptions,
): Promise<ApprovalOutcome> {
  if (mode === 'unattended') {
    safeLog(options, decisionRecord(request, { outcome: 'rejected', reasonCode, mode }))
    return Promise.resolve('rejected')
  }
  safeLog(options, decisionRecord(request, { outcome: 'human', reasonCode, mode }))
  return next()
}

/** Build the sanitized record shared by the operational log and the decision audit. */
function decisionRecord(
  request: ApprovalRequest,
  fields: { outcome: DecisionOutcome, reasonCode: string, mode?: ReviewMode },
): SmartApprovalLogRecord {
  return {
    session: request.agent.session,
    toolName: request.toolName,
    outcome: fields.outcome,
    reasonCode: fields.reasonCode,
    ...(fields.mode === undefined ? {} : { mode: fields.mode }),
    ...(request.callId === undefined ? {} : { callId: request.callId }),
  }
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
