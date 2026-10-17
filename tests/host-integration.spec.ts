/**
 * Host-level integration: a real Cordis context, the real `SessionStore`, the
 * real `ApprovalService`, and the real JSON storage domain drive the plugin the
 * way DSH does. Only the model call is stubbed.
 *
 * This is the seam the unit fixtures cannot reach: `tools/pre-execute` commits
 * `tool/call` through `Session.append`, the store publishes it synchronously on
 * `session/event`, the plugin's tracker folds it, and the approval waterfall is
 * dispatched afterwards from a different subsystem. If the ordering or the scope
 * routing ever changes, this test fails instead of the plugin silently falling
 * back to a human answerer on every request.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { Storage } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  // Reverse order: the facility drains into the backend before it closes.
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

const BENIGN_BUILD = '{"riskLevel":"low","authorization":"high","intent":"benign","reasonCode":"bounded-build-test"}'

/** One reviewer output that claims a bounded build/test action. */
function reviewerStream(text: string) {
  return vi.fn(() => (async function* () {
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())
}

/** A model service is the only collaborator the real host does not need here. */
class StubLlm extends Service {
  readonly stream = reviewerStream(BENIGN_BUILD)

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }
}

/** The file probe is only consulted for `write`/`edit`; this fixture uses `bash`. */
class StubFs extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }
}

interface Host {
  readonly ctx: Context
  readonly backend: JsonStorageBackend
}

/** Assemble the same services the host assembles, then mount the plugin. */
async function host(): Promise<Host> {
  const root = await mkdtemp(join(tmpdir(), 'smart-approval-host-'))
  cleanup.push(async () => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.storage.backend.register('json', backend)
  cleanup.push(async () => backend.close())
  // Same lifecycle-bound mount the host uses; this is what puts `storageDomain`
  // on the context the plugin injects.
  // The real facility over the real routed JSON backend. It is provided
  // directly because the host normally mounts it from a plugin whose injected
  // backend services resolve asynchronously; the seam under test is the event
  // and waterfall path, not that mount.
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.reflect.provide('storageDomain', facility)
  cleanup.push(async () => facility.closeAll())
  new StubLlm(ctx)
  new StubFs(ctx)
  await ctx.plugin(ApprovalService)
  // Direct mount: the plugin's own `inject` list is honoured by loading it
  // through Cordis in production, but here the only thing under test is what
  // `apply` registers on the waterfall. The reviewer route is pinned explicitly
  // because a bare fixture session carries no `request/header` to resolve one.
  await plugin.apply(ctx, { reviewerProvider: 'deepseek', reviewerModel: 'deepseek-chat' })
  await vi.waitFor(() => {
    expect(ctx.get('storageDomain')).toBeDefined()
    expect(ctx.get('llm')).toBeDefined()
    expect(ctx.get('fs')).toBeDefined()
    expect(ctx.get('approval')).toBeDefined()
  })
  return { ctx, backend }
}

/** Commit one complete turn and return the call id under review. */
function commitTurn(session: Session, callId: ToolCallId, command = 'pnpm test'): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '在当前项目运行测试' }],
  }), { surfaceOp: 'append' })
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'bash',
    arguments: JSON.stringify({ command }),
  })
}

/** Ask the approval service exactly as the tool pipeline does. */
async function ask(ctx: Context, session: Session, callId: ToolCallId) {
  return ctx.approval.request({
    agent: { session } as unknown as Agent,
    toolName: 'bash',
    callId,
  })
}

describe('smart approval on a real host stack', () => {
  it('grants a bounded build command committed through the live append path', async () => {
    const { ctx } = await host()
    const session = ctx.sessions.create(SessionId('host-live'), { meta: { cwd: '/work/main' } })
    const callId = ToolCallId('call-host-live')
    commitTurn(session, callId)

    await expect(ask(ctx, session, callId)).resolves.toBe('allowed-once')
  })

  it('grants the same command in a resumed session whose seed never publishes', async () => {
    const { ctx } = await host()
    // A resumed Session is constructed from its stored log. `Session` documents
    // that seed events never publish on `session/event`, so the plugin must fold
    // the seed at announcement or this request degrades to a human handoff.
    const callId = ToolCallId('call-host-resumed')
    const seed = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: SessionSeq(1),
        time: 2,
        surfaceOp: 'append',
        data: createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: '在当前项目运行测试' }],
        }),
      },
      {
        type: 'tool/call',
        seq: SessionSeq(2),
        time: 3,
        data: {
          turn: 1,
          step: 1,
          callId,
          name: 'bash',
          arguments: JSON.stringify({ command: 'pnpm test' }),
        },
      },
    ] as unknown as SessionEvent[]
    const session = ctx.sessions.create(SessionId('host-resumed'), {
      seed,
      meta: { cwd: '/work/main' },
    })

    expect(session.firstLiveSeq).toBeGreaterThan(0)
    await expect(ask(ctx, session, callId)).resolves.toBe('allowed-once')
  })

  it('never grants when no committed call backs the request', async () => {
    const { ctx } = await host()
    const session = ctx.sessions.create(SessionId('host-empty'), { meta: { cwd: '/work/main' } })
    session.append('turn/start', { turn: 1 })

    // No `tool/call` was ever committed, so there is no action to review.
    await expect(ask(ctx, session, ToolCallId('call-missing'))).resolves.not.toBe('allowed-once')
  })
})
