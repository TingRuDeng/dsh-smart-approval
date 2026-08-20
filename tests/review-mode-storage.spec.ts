import type { Session } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import {
  DecisionLogStore,
  ReviewModeStore,
  type DecisionRow,
  type ReviewModeRow,
} from '../src/review-mode-storage.ts'

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

describe('DecisionLogStore', () => {
  function decisionBench(maxEntries: number) {
    const rows = new Map<string, DecisionRow>()
    const put = vi.fn(async (key: string, value: DecisionRow) => { rows.set(key, value) })
    const update = vi.fn(async (key: string, fn: (current: DecisionRow) => DecisionRow) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing-key')
      const next = fn(current)
      rows.set(key, next)
      return next
    })
    const table = {
      get: (key: string) => rows.get(key),
      put,
      update,
    } as unknown as KvTable<never, DecisionRow>
    const store = new DecisionLogStore(table, maxEntries)
    return { rows, put, update, store }
  }

  function sessionOf(createdAt: number, cwd?: string): Session {
    return {
      id: 'session-decisions',
      header: { id: 'session-decisions', version: 0, createdAt, ...(cwd === undefined ? {} : { cwd }) },
    } as unknown as Session
  }

  it('materializes the first entry with put and appends later entries with update', async () => {
    const bench = decisionBench(50)
    const session = sessionOf(1, '/work/main')
    await bench.store.append(session, {
      toolName: 'bash', outcome: 'allowed-once', reasonCode: 'bounded-build-test', mode: 'smart', callId: 'call-1',
    })
    await bench.store.append(session, {
      toolName: 'write', outcome: 'human', reasonCode: 'uncertain', mode: 'smart',
    })

    expect(bench.put).toHaveBeenCalledOnce()
    expect(bench.update).toHaveBeenCalledOnce()
    expect(bench.rows.get('session-decisions')).toEqual({
      session: { createdAt: 1, cwd: '/work/main' },
      entries: [
        expect.objectContaining({ toolName: 'bash', outcome: 'allowed-once', reasonCode: 'bounded-build-test', mode: 'smart', callId: 'call-1' }),
        expect.objectContaining({ toolName: 'write', outcome: 'human', reasonCode: 'uncertain', mode: 'smart' }),
      ],
    })
  })

  it('keeps at most maxEntries per Session lifecycle and drops the oldest first', async () => {
    const bench = decisionBench(2)
    const session = sessionOf(1)
    await bench.store.append(session, { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'a', mode: 'smart' })
    await bench.store.append(session, { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'b', mode: 'smart' })
    await bench.store.append(session, { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'c', mode: 'smart' })

    expect(bench.store.list(session).map(entry => entry.reasonCode)).toEqual(['b', 'c'])
    expect(bench.rows.get('session-decisions')?.entries.map(entry => entry.reasonCode)).toEqual(['b', 'c'])
  })

  it('rebuilds the row when the same Session id starts a new lifecycle', async () => {
    const bench = decisionBench(50)
    await bench.store.append(sessionOf(1, '/work/old'), { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'a', mode: 'smart' })
    await bench.store.append(sessionOf(2, '/work/new'), { toolName: 'bash', outcome: 'human', reasonCode: 'b', mode: 'smart' })

    expect(bench.put).toHaveBeenCalledTimes(2)
    expect(bench.update).not.toHaveBeenCalled()
    expect(bench.rows.get('session-decisions')).toEqual({
      session: { createdAt: 2, cwd: '/work/new' },
      entries: [expect.objectContaining({ reasonCode: 'b' })],
    })
    expect(bench.store.list(sessionOf(1, '/work/old'))).toEqual([])
  })

  it('stamps each appended entry with a safe-integer time', async () => {
    const bench = decisionBench(50)
    await bench.store.append(sessionOf(1), { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'a', mode: 'smart' })

    const time = bench.rows.get('session-decisions')?.entries[0]?.time
    expect(typeof time).toBe('number')
    expect(Number.isSafeInteger(time)).toBe(true)
  })

  it('never writes when maxEntries is 0', async () => {
    const bench = decisionBench(0)
    await bench.store.append(sessionOf(1), { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'a', mode: 'smart' })

    expect(bench.put).not.toHaveBeenCalled()
    expect(bench.update).not.toHaveBeenCalled()
    expect(bench.store.list(sessionOf(1))).toEqual([])
  })

  it('serves only entries from the exact Session lifecycle', async () => {
    const bench = decisionBench(50)
    await bench.store.append(sessionOf(1, '/work/main'), { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'a', mode: 'smart' })

    expect(bench.store.list(sessionOf(1))).toEqual([])
    expect(bench.store.list(sessionOf(1, '/work/main'))).toHaveLength(1)
  })
})
