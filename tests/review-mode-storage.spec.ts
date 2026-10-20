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

  /**
   * The audit is a fire-and-forget side channel, so consecutive decisions for
   * one Session can be in flight together. A read taken outside the domain's
   * write chain cannot see a queued-but-unlanded row, and both appends would
   * take the `put` branch: the later one silently overwrote the earlier.
   */
  it('keeps both entries when two appends for one Session overlap before any row lands', async () => {
    const rows = new Map<string, DecisionRow>()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const table = {
      get: (key: string) => rows.get(key),
      // A slow backend: the write is still queued when the second append reads.
      put: async (key: string, value: DecisionRow) => { await gate; rows.set(key, value) },
      update: async (key: string, fn: (current: DecisionRow) => DecisionRow) => {
        const current = rows.get(key)
        if (current === undefined) throw new Error('missing-key')
        rows.set(key, fn(current))
      },
    } as unknown as KvTable<never, DecisionRow>
    const store = new DecisionLogStore(table, 50)
    const session = sessionOf(1, '/work/main')

    const first = store.append(session, { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'first', mode: 'smart' })
    const second = store.append(session, { toolName: 'write', outcome: 'human', reasonCode: 'second', mode: 'smart' })
    release?.()
    await Promise.all([first, second])

    expect(rows.get('session-decisions')?.entries.map(entry => entry.reasonCode)).toEqual(['first', 'second'])
    expect(store.list(session).map(entry => entry.reasonCode)).toEqual(['first', 'second'])
  })

  it('keeps every entry when many appends for one Session are fired without awaiting', async () => {
    const rows = new Map<string, DecisionRow>()
    let inFlight = 0
    let peakInFlight = 0
    const table = {
      get: (key: string) => rows.get(key),
      put: async (key: string, value: DecisionRow) => {
        inFlight += 1
        peakInFlight = Math.max(peakInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 1))
        rows.set(key, value)
        inFlight -= 1
      },
      update: async (key: string, fn: (current: DecisionRow) => DecisionRow) => {
        const current = rows.get(key)
        if (current === undefined) throw new Error('missing-key')
        inFlight += 1
        peakInFlight = Math.max(peakInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 1))
        rows.set(key, fn(current))
        inFlight -= 1
      },
    } as unknown as KvTable<never, DecisionRow>
    const store = new DecisionLogStore(table, 50)
    const session = sessionOf(1, '/work/main')

    // Mimic index.ts exactly: fire and forget, never awaiting between appends.
    for (let index = 0; index < 8; index += 1) {
      void store.append(session, {
        toolName: 'bash', outcome: 'allowed-once', reasonCode: `r${index}`, mode: 'smart',
      }).catch(() => {})
    }

    await vi.waitFor(() => {
      expect(store.list(session)).toHaveLength(8)
    })
    expect(store.list(session).map(entry => entry.reasonCode)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
    // Serialized per Session: no two writes for this Session were ever in flight.
    expect(peakInFlight).toBe(1)
  })

  it('still enforces maxEntries when appends are serialized', async () => {
    const bench = decisionBench(2)
    const session = sessionOf(1)
    const pending = ['a', 'b', 'c'].map(reasonCode => bench.store.append(session, {
      toolName: 'bash', outcome: 'allowed-once', reasonCode, mode: 'smart',
    }))
    await Promise.all(pending)

    expect(bench.store.list(session).map(entry => entry.reasonCode)).toEqual(['b', 'c'])
  })

  it('does not let one failed audit write strand later appends for the Session', async () => {
    const rows = new Map<string, DecisionRow>()
    let failNext = true
    const table = {
      get: (key: string) => rows.get(key),
      put: async (key: string, value: DecisionRow) => {
        if (failNext) {
          failNext = false
          throw new Error('backend unavailable')
        }
        rows.set(key, value)
      },
      update: async (key: string, fn: (current: DecisionRow) => DecisionRow) => {
        const current = rows.get(key)
        if (current === undefined) throw new Error('missing-key')
        rows.set(key, fn(current))
      },
    } as unknown as KvTable<never, DecisionRow>
    const store = new DecisionLogStore(table, 50)
    const session = sessionOf(1, '/work/main')

    // The plugin swallows audit failures; the next append must still land.
    const failed = store.append(session, { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'lost', mode: 'smart' })
    const landed = store.append(session, { toolName: 'bash', outcome: 'allowed-once', reasonCode: 'kept', mode: 'smart' })
    await expect(failed).rejects.toThrow('backend unavailable')
    await landed

    expect(store.list(session).map(entry => entry.reasonCode)).toEqual(['kept'])
  })
})
