/** Per-session automatic review mode and its browser projection fold. */

import type {} from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z as zod } from 'zod'

/** User-selectable automatic review modes. */
export type ReviewMode = 'manual' | 'smart' | 'unattended'

/** Closed mode vocabulary in display order. */
export const REVIEW_MODES = ['manual', 'smart', 'unattended'] as const

/** Browser projection carrying the current independent review mode. */
export interface ReviewModeProjection {
  mode: ReviewMode
}

/**
 * Internal projection state for pairing built-in command lifecycle events.
 * The durable sidecar stays authoritative; this fold only feeds the browser
 * view, so it carries no mode provenance of its own.
 */
export interface ReviewModeProjectionState {
  readonly mode: ReviewMode
  readonly pending?: Readonly<Record<string, ReviewMode>> | undefined
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Automatic approval review mode for the session. */
    approvalReview: ReviewModeProjection
  }

  interface SessionProjectionStateMap {
    /** Host fold state for the automatic approval review mode. */
    approvalReview: ReviewModeProjectionState
  }
}

/** Runtime schema for the browser projection. */
export const reviewModeProjectionSchema: zod.ZodType<ReviewModeProjection> = zod.object({
  mode: zod.enum(REVIEW_MODES),
})

/** Runtime schema for persisted automatic review mode fold state. */
export const reviewModeProjectionStateSchema: zod.ZodType<ReviewModeProjectionState> = zod.object({
  mode: zod.enum(REVIEW_MODES),
  pending: zod.record(zod.string(), zod.enum(REVIEW_MODES)).optional(),
}).strict()

/** Recommended mode for newly created sessions. */
export const DEFAULT_REVIEW_MODE: ReviewMode = 'smart'

/** Initial projection state for a session without an independent selection. */
export function initialReviewModeState(defaultMode: ReviewMode): ReviewModeProjectionState {
  return { mode: defaultMode }
}

/** Fold one event into projection state. */
export function applyReviewModeEvent(
  state: ReviewModeProjectionState,
  event: SessionEvent,
): ReviewModeProjectionState {
  if (event.type === 'command/run' && event.data.name === 'approval-mode') {
    const mode = event.data.args?.trim()
    if (mode === undefined || !(REVIEW_MODES as readonly string[]).includes(mode)) return state
    return {
      ...state,
      pending: { ...state.pending, [event.data.commandId]: mode as ReviewMode },
    }
  }
  if (event.type !== 'command/done') return state
  const mode = state.pending?.[event.data.commandId]
  if (mode === undefined) return state
  const pending = { ...state.pending }
  delete pending[event.data.commandId]
  return {
    mode: event.data.kind === 'success' ? mode : state.mode,
    ...Object.keys(pending).length === 0 ? {} : { pending },
  }
}

/** Strip internal command-pairing state from the browser value. */
export function viewReviewModeProjection(state: ReviewModeProjectionState): ReviewModeProjection {
  return { mode: state.mode }
}
