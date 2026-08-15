/** Durable per-session automatic review mode. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { z as zod } from 'zod'

/** User-selectable automatic review modes. */
export type ReviewMode = 'manual' | 'smart' | 'unattended'

/** Closed mode vocabulary in display order. */
export const REVIEW_MODES = ['manual', 'smart', 'unattended'] as const

/** Browser projection carrying the current independent review mode. */
export interface ReviewModeProjection {
  mode: ReviewMode
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Automatic approval review mode for the session. */
    approvalReview: ReviewModeProjection
  }
}

/** Runtime schema for the browser projection. */
export const reviewModeProjectionSchema: zod.ZodType<ReviewModeProjection> = zod.object({
  mode: zod.enum(REVIEW_MODES),
})

/** Recommended mode for newly created sessions. */
export const DEFAULT_REVIEW_MODE: ReviewMode = 'smart'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Automatic approval review mode selected for subsequent requests. */
    'smart-approval/mode': { mode: ReviewMode }
  }
}

/**
 * Fold the latest independent review mode from a session log.
 * @param events - session events in log order.
 * @returns the selected mode, or undefined before the mode is pinned.
 */
export function selectedReviewMode(events: readonly SessionEvent[]): ReviewMode | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'smart-approval/mode') return event.data.mode
  }
  return undefined
}

/** Map one pre-release permission preset to the review mode it previously represented. */
export function legacyReviewMode(legacyPreset: string): ReviewMode {
  if (legacyPreset === 'smart-approval') return 'smart'
  if (legacyPreset === 'unattended') return 'unattended'
  return 'manual'
}

/** Resolve the logged mode, falling back only for an unpinned session. */
export function effectiveReviewMode(events: readonly SessionEvent[], fallback: ReviewMode): ReviewMode {
  return selectedReviewMode(events) ?? fallback
}

/** Append a changed independent review mode to the durable session log. */
export function setReviewMode(session: Session, mode: ReviewMode): void {
  if (selectedReviewMode(session.events) === mode) return
  session.append('smart-approval/mode', { mode })
}

/** Fold one event into projection state. */
export function applyReviewModeEvent(state: ReviewModeProjection, event: SessionEvent): ReviewModeProjection {
  if (event.type !== 'smart-approval/mode' || event.data.mode === state.mode) return state
  return { mode: event.data.mode }
}
