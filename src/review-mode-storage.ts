/** Durable storage-domain sidecar for per-session automatic review mode and its decision audit. */

import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { REVIEW_MODES, type ReviewMode } from './review-mode.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for one Session-lifecycle-bound mode row. */
export const reviewModeRowSchema = z.object({
  session: z.object({
    createdAt: nonNegativeSafeInteger,
    cwd: z.string().optional(),
  }),
  mode: z.enum(REVIEW_MODES),
})

/** One persisted review-mode row. */
export type ReviewModeRow = z.infer<typeof reviewModeRowSchema>

/** Settled plugin decisions persisted in the per-session audit. */
export const DECISION_OUTCOMES = ['allowed-once', 'human', 'rejected', 'cancelled'] as const
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number]

/** Runtime schema for one automatic-decision audit entry. */
export const decisionEntrySchema = z.object({
  time: nonNegativeSafeInteger,
  toolName: z.string().min(1),
  outcome: z.enum(DECISION_OUTCOMES),
  reasonCode: z.string().min(1),
  mode: z.enum(REVIEW_MODES).optional(),
  callId: z.string().optional(),
})

/**
 * One audit entry: who/what was decided and how. The field whitelist is
 * hardcoded at this schema boundary, so arguments, prompts, and model
 * reasoning are structurally impossible to persist here.
 */
export type DecisionEntry = z.infer<typeof decisionEntrySchema>

/** Runtime schema for one Session-lifecycle-bound decisions row. */
export const decisionRowSchema = z.object({
  session: z.object({
    createdAt: nonNegativeSafeInteger,
    cwd: z.string().optional(),
  }),
  entries: z.array(decisionEntrySchema),
})

/** One persisted decisions row. */
export type DecisionRow = z.infer<typeof decisionRowSchema>

/** One sidecar record per Session id, in two independent tables. */
export const reviewModeDomainSpec = defineDomain({
  name: 'smart_approval',
  version: 0,
  tables: {
    sessions: domainTable<SessionId, ReviewModeRow>(reviewModeRowSchema),
    decisions: domainTable<SessionId, DecisionRow>(decisionRowSchema),
  },
})

/** Lifecycle fingerprint shared by every row in this domain. */
function sessionStamp(session: Session): { createdAt: number, cwd?: string } {
  return {
    createdAt: session.header.createdAt,
    ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
  }
}

/** Session mode store backed by storage-domain's synchronous read cache. */
export class ReviewModeStore {
  constructor(private readonly table: KvTable<SessionId, ReviewModeRow>) {}

  /** Read only a row belonging to this exact Session lifecycle. */
  get(session: Session): ReviewMode | undefined {
    const row = this.table.get(session.id)
    if (row === undefined
      || row.session.createdAt !== session.header.createdAt
      || row.session.cwd !== session.header.cwd) return undefined
    return row.mode
  }

  /** Durably replace this Session lifecycle's selected mode. */
  async set(session: Session, mode: ReviewMode): Promise<void> {
    if (this.get(session) === mode) return
    await this.table.put(session.id, {
      session: sessionStamp(session),
      mode,
    })
  }
}

/** Session decision-audit store backed by storage-domain's synchronous read cache. */
export class DecisionLogStore {
  constructor(
    private readonly table: KvTable<SessionId, DecisionRow>,
    private readonly maxEntries: number,
  ) {}

  /** Read only a row belonging to this exact Session lifecycle. */
  get(session: Session): DecisionRow | undefined {
    const row = this.table.get(session.id)
    if (row === undefined
      || row.session.createdAt !== session.header.createdAt
      || row.session.cwd !== session.header.cwd) return undefined
    return row
  }

  /** Audit entries of this exact Session lifecycle, oldest first. */
  list(session: Session): readonly DecisionEntry[] {
    return this.get(session)?.entries ?? []
  }

  /**
   * Durably append one decision, keeping at most maxEntries per lifecycle.
   * The first entry materializes the row with put; later entries ride the
   * domain's atomic update chain. A lifecycle fingerprint mismatch replaces
   * the whole row instead of appending to a stale one.
   */
  async append(session: Session, entry: Omit<DecisionEntry, 'time'>): Promise<void> {
    if (this.maxEntries === 0) return
    const stored: DecisionEntry = { ...entry, time: Date.now() }
    const current = this.get(session)
    if (current === undefined) {
      await this.table.put(session.id, {
        session: sessionStamp(session),
        entries: [stored],
      })
      return
    }
    await this.table.update(session.id, row => ({
      ...row,
      entries: [...row.entries, stored].slice(-this.maxEntries),
    }))
  }
}
