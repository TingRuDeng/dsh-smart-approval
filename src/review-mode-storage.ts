/** Durable storage-domain sidecar for per-session automatic review mode. */

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

/** One sidecar record per Session id. */
export const reviewModeDomainSpec = defineDomain({
  name: 'smart_approval',
  version: 0,
  tables: {
    sessions: domainTable<SessionId, ReviewModeRow>(reviewModeRowSchema),
  },
})

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
      session: {
        createdAt: session.header.createdAt,
        ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
      },
      mode,
    })
  }
}
