import type { Session } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import { ReviewModeStore, type ReviewModeRow } from '../src/review-mode-storage.ts'

describe('ReviewModeStore', () => {
  it('does not reuse a mode row after the same Session id starts a new lifecycle', async () => {
    const rows = new Map<string, ReviewModeRow>([
      ['session-reused', {
        session: { createdAt: 1, cwd: '/work/old' },
        mode: 'unattended',
      }],
    ])
    const table = {
      get: (key: string) => rows.get(key),
      put: async (key: string, value: ReviewModeRow) => { rows.set(key, value) },
    } as unknown as KvTable<never, ReviewModeRow>
    const store = new ReviewModeStore(table)
    const session = {
      id: 'session-reused',
      header: { id: 'session-reused', version: 0, createdAt: 2, cwd: '/work/new' },
    } as unknown as Session

    expect(store.get(session)).toBeUndefined()
    await store.set(session, 'smart')
    expect(rows.get('session-reused')).toEqual({
      session: { createdAt: 2, cwd: '/work/new' },
      mode: 'smart',
    })
  })
})
