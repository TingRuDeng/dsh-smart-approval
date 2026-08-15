/** Per-session automatic review mode and its browser projection fold. */

import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
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

/** Internal projection state for pairing built-in command lifecycle events. */
export interface ReviewModeProjectionState extends ReviewModeProjection {
  readonly fallback: ReviewMode
  readonly origin: 'default' | 'legacy' | 'independent'
  readonly pending?: Readonly<Record<string, ReviewMode>>
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
    /** Legacy pre-rc.4 review mode event, retained only for one-way migration. */
    'smart-approval/mode': { mode: ReviewMode }
  }
}

/** Map one pre-release permission preset to the review mode it previously represented. */
export function legacyReviewMode(legacyPreset: string): ReviewMode | undefined {
  if (legacyPreset === 'smart-approval') return 'smart'
  if (legacyPreset === 'unattended') return 'unattended'
  return undefined
}

/** Initial projection state for a session without an independent selection. */
export function initialReviewModeState(fallback: ReviewMode): ReviewModeProjectionState {
  return { mode: fallback, fallback, origin: 'default' }
}

/** Rebuild the review mode from portable Session events. */
export function foldReviewModeEvents(
  events: readonly SessionEvent[],
  fallback: ReviewMode,
): ReviewModeProjectionState {
  return events.reduce(applyReviewModeEvent, initialReviewModeState(fallback))
}

/** Fold one event into projection state. */
export function applyReviewModeEvent(
  state: ReviewModeProjectionState,
  event: SessionEvent,
): ReviewModeProjectionState {
  if (event.type === 'smart-approval/mode') {
    if (event.data.mode === state.mode && state.origin === 'independent') return state
    return { ...state, mode: event.data.mode, origin: 'independent' }
  }
  if (event.type === 'permission/preset' && state.origin !== 'independent') {
    const mode = legacyReviewMode(event.data.preset)
    const next = mode === undefined
      ? { ...state, mode: state.fallback, origin: 'default' as const }
      : { ...state, mode, origin: 'legacy' as const }
    return next.mode === state.mode && next.origin === state.origin ? state : next
  }
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
    fallback: state.fallback,
    origin: event.data.kind === 'success' ? 'independent' : state.origin,
    ...Object.keys(pending).length === 0 ? {} : { pending },
  }
}

/** Strip internal command-pairing state from the browser value. */
export function viewReviewModeProjection(state: ReviewModeProjectionState): ReviewModeProjection {
  return { mode: state.mode }
}
