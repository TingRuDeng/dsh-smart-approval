/** Same-version medium-open semantics for the decisions table, pinned on the real JSON backend and the real domain facility. */

import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { DomainFacility, defineDomain, descriptorOf, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DecisionLogStore,
  ReviewModeStore,
  reviewModeDomainSpec,
  reviewModeRowSchema,
  type ReviewModeRow,
} from '../src/review-mode-storage.ts'

const cleanup: (() => Promise<void>)[] = []

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'smart-approval-medium-'))
  cleanup.push(async () => rm(dir, { recursive: true, force: true }))
  return dir
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()))
})

describe('smart_approval medium open semantics', () => {
  it('opens a same-version medium written by the previous single-table layout', async () => {
    const root = await tempRoot()

    // The pre-decisions layout: same domain name and version 0, sessions table only.
    const previousSpec = defineDomain({
      name: 'smart_approval',
      version: 0,
      tables: {
        sessions: domainTable<string, ReviewModeRow>(reviewModeRowSchema),
      },
    })
    const previousBackend = new JsonStorageBackend(root)
    const previousUnit = await previousBackend.kv.open(descriptorOf(previousSpec))
    await previousUnit.putRecord('sessions', 'session-1', {
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'smart',
    })
    await previousUnit.close()
    await previousBackend.close()

    // The current layout adds the decisions table without bumping the version.
    const currentBackend = new JsonStorageBackend(root)
    const currentUnit = await currentBackend.kv.open(descriptorOf(reviewModeDomainSpec))
    const snapshot = await currentUnit.loadAll()

    expect(snapshot.tables['sessions']?.['session-1']).toEqual({
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'smart',
    })
    expect(snapshot.tables['decisions']).toEqual({})
    await currentUnit.close()
    await currentBackend.close()
  })

  it('persists decision rows in a separate table that survives a reopen', async () => {
    const root = await tempRoot()
    const backend = new JsonStorageBackend(root)
    const unit = await backend.kv.open(descriptorOf(reviewModeDomainSpec))
    await unit.putRecord('decisions', 'session-1', {
      session: { createdAt: 1, cwd: '/work/main' },
      entries: [{ time: 10, toolName: 'bash', outcome: 'allowed-once', reasonCode: 'bounded-build-test', mode: 'smart' }],
    })
    await unit.close()
    await backend.close()

    const reopened = new JsonStorageBackend(root)
    const reopenedUnit = await reopened.kv.open(descriptorOf(reviewModeDomainSpec))
    const snapshot = await reopenedUnit.loadAll()
    expect(snapshot.tables['decisions']?.['session-1']).toEqual({
      session: { createdAt: 1, cwd: '/work/main' },
      entries: [{ time: 10, toolName: 'bash', outcome: 'allowed-once', reasonCode: 'bounded-build-test', mode: 'smart' }],
    })
    await reopenedUnit.close()
    await reopened.close()
  })

  it('opens an old same-version medium through the real domain facility and appends decisions durably', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    const hub = new Storage(ctx)
    const backend = new JsonStorageBackend(root)
    const unregister = hub.backend.register('json', backend)
    try {
      const facility = new DomainFacility(ctx, { backend: 'json' })

      // The pre-decisions layout: sessions table only, version 0.
      const previousSpec = defineDomain({
        name: 'smart_approval',
        version: 0,
        tables: {
          sessions: domainTable<string, ReviewModeRow>(reviewModeRowSchema),
        },
      })
      const previousDomain = await facility.open(previousSpec)
      await previousDomain.table('sessions').put(SessionId('session-1'), {
        session: { createdAt: 1, cwd: '/work/main' },
        mode: 'smart',
      } as ReviewModeRow)
      await previousDomain.close()

      // The current two-table layout must open the same medium at version 0.
      const domain = await facility.open(reviewModeDomainSpec)
      const session = {
        id: SessionId('session-1'),
        header: { id: SessionId('session-1'), version: 0, createdAt: 1, cwd: '/work/main' },
      } as unknown as Session
      expect(new ReviewModeStore(domain.table('sessions')).get(session)).toBe('smart')

      const decisions = new DecisionLogStore(domain.table('decisions'), 50)
      await decisions.append(session, {
        toolName: 'bash',
        outcome: 'allowed-once',
        reasonCode: 'bounded-build-test',
        mode: 'smart',
        callId: 'call-1',
      })
      await domain.close()

      // A second open of the same version reads the decision row back.
      const reopened = await facility.open(reviewModeDomainSpec)
      const entries = new DecisionLogStore(reopened.table('decisions'), 50).list(session)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toEqual(expect.objectContaining({
        toolName: 'bash',
        outcome: 'allowed-once',
        reasonCode: 'bounded-build-test',
        mode: 'smart',
        callId: 'call-1',
        time: expect.any(Number),
      }))
      await reopened.close()
    } finally {
      unregister()
      await backend.close()
    }
  })
})
