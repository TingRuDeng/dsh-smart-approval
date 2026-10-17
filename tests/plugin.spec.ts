/**
 * Plugin-level fixtures. The answerer reads context folded from committed
 * events, so a fixture must commit its events through the same host listener
 * the plugin registers — a request alone carries no log to rescan.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {
  Session, SessionEvent, SessionEventMap, SessionEventType,
} from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { applyReviewModeEvent, initialReviewModeState } from '../src/review-mode.ts'

const { Config, apply, inject, name } = plugin

/** Event types that are written on the model-visible surface. */
const SURFACE_TYPES: ReadonlySet<SessionEventType> = new Set<SessionEventType>([
  'system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result',
])

let logSeq = 0

/** Build one committed event in the shape the host pushes to `session/event`. */
function committed<T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent {
  logSeq += 1
  return {
    type,
    seq: SessionSeq(logSeq),
    time: logSeq,
    data,
    ...SURFACE_TYPES.has(type) ? { surfaceOp: 'append' as const } : {},
  } as unknown as SessionEvent
}

function directUser(text: string): UserMessage {
  return createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  })
}

/** Answerer signature as registered on the approval waterfall. */
type Answerer = (request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>

/** One reviewer output that claims a bounded build/test action. */
function reviewerStream(text: string) {
  return vi.fn(() => (async function* () {
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())
}

const BENIGN_BUILD = '{"riskLevel":"low","authorization":"high","intent":"benign","reasonCode":"bounded-build-test"}'
const BENIGN_WRITE = '{"riskLevel":"low","authorization":"high","intent":"benign","reasonCode":"bounded-project-write"}'

function sessionOf(id: string, cwd = '/work/main'): Session {
  return {
    id,
    header: { id, version: 0, createdAt: 1, cwd },
    deriveMessages: () => [],
    requestContext: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    append: vi.fn(),
  } as unknown as Session
}

function storageBench(options: { decisionsPut?: (key: string, value: unknown) => Promise<void> } = {}) {
  const tables = new Map<string, Map<string, unknown>>([
    ['sessions', new Map<string, unknown>()],
    ['decisions', new Map<string, unknown>()],
  ])
  const domain = {
    close: vi.fn(async () => {}),
    table: (name: string) => {
      let rows = tables.get(name)
      if (rows === undefined) {
        rows = new Map<string, unknown>()
        tables.set(name, rows)
      }
      return {
        get: (key: string) => rows!.get(key),
        put: name === 'decisions' && options.decisionsPut !== undefined
          ? options.decisionsPut
          : async (key: string, value: unknown) => { rows!.set(key, value) },
        update: async (key: string, fn: (current: unknown) => unknown) => {
          const current = rows!.get(key)
          if (current === undefined) throw new Error('missing-key')
          const next = fn(current)
          rows!.set(key, next)
          return next
        },
      }
    },
  }
  return {
    tables,
    effect: vi.fn((factory: () => unknown) => factory()),
    storageDomain: { open: vi.fn(async () => domain) },
  }
}

interface Registered {
  readonly event: string
  readonly options: unknown
}

interface Bench {
  readonly ctx: Context
  readonly storage: ReturnType<typeof storageBench>
  readonly registered: readonly Registered[]
  readonly commands: {
    name: string
    handler: (input: { agent: Agent; rawInput: string }) => Promise<{ kind: string; text?: string }>
  }[]
  readonly projection: {
    stateSchema: { parse: (value: unknown) => unknown }
    init: () => unknown
    apply: (state: unknown, event: SessionEvent) => unknown
    wire: {
      viewSchema: { parse: (value: unknown) => unknown }
      view: (state: unknown) => unknown
    }
  } | undefined
  /** Push one committed event to every `session/event` listener. */
  emit<T extends SessionEventType>(session: Session, type: T, data: SessionEventMap[T]): void
  /** Announce a created session whose seed prefix the host never publishes. */
  announce(session: Session): void
  /** Deliver the authoritative termination signal for one session. */
  dispose(session: Session): void
  /** Dispatch one approval request through the registered answerer. */
  answer(request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
}

/** A host-scope stand-in that records listener registrations like Cordis does. */
function bench(options: {
  fs?: unknown
  llm?: unknown
  decisionsPut?: (key: string, value: unknown) => Promise<void>
} = {}): Bench {
  const storage = storageBench(options.decisionsPut === undefined ? {} : { decisionsPut: options.decisionsPut })
  const listeners = new Map<string, (first: never, second?: never) => void>()
  const registered: Registered[] = []
  const commands: Bench['commands'] = []
  let projection: Bench['projection']
  const ctx = {
    on: vi.fn((event: string, callback: never, listenerOptions?: unknown) => {
      registered.push({ event, options: listenerOptions })
      listeners.set(event, callback)
    }),
    inject: vi.fn((services: readonly string[], callback: (scope: unknown) => void) => {
      if (services.includes('commands')) {
        callback({ commands: { register: (value: Bench['commands'][number]) => { commands.push(value) } } })
      }
      if (services.includes('sessionProjections')) {
        callback({ sessionProjections: { register: (value: Bench['projection']) => { projection = value } } })
      }
    }),
    effect: storage.effect,
    storageDomain: storage.storageDomain,
    fs: options.fs,
    llm: options.llm ?? { stream: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn() },
  } as unknown as Context
  return {
    ctx,
    storage,
    registered,
    commands,
    get projection() { return projection },
    emit: (session, type, data) => {
      const listener = listeners.get('session/event')
      if (listener === undefined) throw new Error('no session/event listener registered')
      listener(session as never, committed(type, data) as never)
    },
    announce: (session) => {
      const listener = listeners.get('session/created')
      if (listener === undefined) throw new Error('no session/created listener registered')
      listener(session as never)
    },
    dispose: (session) => {
      const listener = listeners.get('session/disposed')
      if (listener === undefined) throw new Error('no session/disposed listener registered')
      listener(session as never)
    },
    answer: (request, next) => {
      const listener = listeners.get('approval/request') as unknown as Answerer | undefined
      if (listener === undefined) throw new Error('no approval/request listener registered')
      return listener(request, next)
    },
  }
}

/**
 * Commit one complete turn — `turn/start`, the direct user request, and the
 * tool call under review — and return the request that answers it.
 */
function flow(options: {
  sessionId?: string
  cwd?: string
  toolName?: string
  arguments: string
  userText?: string
  callId?: string
  bench: Bench
}): ApprovalRequest {
  const sessionId = options.sessionId ?? 'session-flow'
  const callId = ToolCallId(options.callId ?? 'call-flow')
  const toolName = options.toolName ?? 'bash'
  const session = sessionOf(sessionId, options.cwd ?? '/work/main')
  options.bench.emit(session, 'turn/start', { turn: 1 })
  options.bench.emit(session, 'step/start', { turn: 1, step: 1 })
  options.bench.emit(session, 'user/message', directUser(options.userText ?? '在当前项目运行测试'))
  options.bench.emit(session, 'tool/call', {
    turn: 1, step: 1, callId, name: toolName, arguments: options.arguments,
  })
  return {
    agent: { session, options: {} } as unknown as Agent,
    toolName,
    callId,
  }
}

describe('plugin entry', () => {
  it('declares only the DSH services the prepended answerer needs', () => {
    expect(name).toBe('dsh-smart-approval')
    expect(inject).toEqual(['approval', 'llm', 'storageDomain', 'fs'])
    expect(inject).not.toContain('sessions')
    expect(Config).toBeDefined()
    expect('default' in plugin).toBe(false)
  })

  it('registers the context folds ahead of the existing human answerer', async () => {
    const b = bench()
    b.storage.tables.get('sessions')!.set('session-request', {
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'smart',
    })

    await apply(b.ctx, {})

    expect(b.registered).toEqual([
      { event: 'session/event', options: undefined },
      { event: 'session/created', options: undefined },
      { event: 'session/disposed', options: undefined },
      { event: 'approval/request', options: { prepend: true } },
    ])
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = { agent: { session: sessionOf('session-request') } } as unknown as ApprovalRequest
    // No committed events were delivered for this session, so the answerer must
    // fall back to the human chain instead of guessing an action.
    await expect(b.answer(request, next)).resolves.toBe('rejected')
    expect(next).toHaveBeenCalledOnce()
  })

  it('recovers context from a seed that the host never publishes', async () => {
    const b = bench({ llm: { stream: reviewerStream(BENIGN_BUILD) } })
    await apply(b.ctx, {})
    const callId = ToolCallId('call-resumed')
    // A resumed Session installs this history before any observer attaches and
    // dispatches no `session/event` for it, so only the seed read can supply it.
    const seed: SessionEvent[] = [
      committed('turn/start', { turn: 1 }),
      committed('step/start', { turn: 1, step: 1 }),
      committed('user/message', directUser('在当前项目运行测试')),
      committed('tool/call', {
        turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"pnpm test"}',
      }),
    ]
    const snapshotEvents = vi.fn(() => seed)
    const session = {
      ...sessionOf('session-resumed') as unknown as Record<string, unknown>,
      firstLiveSeq: seed.length,
      inheritedEventCount: 0,
      snapshotEvents,
    } as unknown as Session

    b.announce(session)

    expect(snapshotEvents).toHaveBeenCalledOnce()
    expect(snapshotEvents).toHaveBeenCalledWith(0, seed.length)
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = { agent: { session, options: {} } as unknown as Agent, toolName: 'bash', callId }
    await expect(b.answer(request, next)).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
  })

  it('reads no log for a fresh session that has no seed', async () => {
    const b = bench()
    await apply(b.ctx, {})
    const snapshotEvents = vi.fn(() => [])
    const session = {
      ...sessionOf('session-fresh') as unknown as Record<string, unknown>,
      firstLiveSeq: 0,
      snapshotEvents,
    } as unknown as Session

    b.announce(session)

    expect(snapshotEvents).not.toHaveBeenCalled()
  })

  it('reads smart review mode independently from the workspace-write permission preset', async () => {
    const b = bench({ llm: { stream: reviewerStream(BENIGN_BUILD) } })
    await apply(b.ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = flow({
      bench: b,
      sessionId: 'session-smart-mode',
      callId: 'call-smart-mode',
      arguments: '{"command":"pnpm test"}',
    })

    await expect(b.answer(request, next)).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
  })

  it('uses the mounted DSH filesystem to review a safe cross-workspace write', async () => {
    const workspace = { displayPath: '/work/main', key: 'workspace' }
    const target = { displayPath: '/work/other/report.md', key: 'target' }
    const fs = {
      resolve: vi.fn(async (path: string) => path === '/work/main' ? workspace : target),
      processPath: vi.fn(() => '/work/other/report.md'),
      contains: vi.fn(() => false),
      stat: vi.fn(async () => undefined),
      lstat: vi.fn(async () => undefined),
    }
    const b = bench({ fs, llm: { stream: reviewerStream(BENIGN_WRITE) } })
    await apply(b.ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = flow({
      bench: b,
      sessionId: 'session-smart-write',
      callId: 'call-smart-write',
      toolName: 'write',
      userText: '在 /work/other 创建 report.md',
      arguments: JSON.stringify({
        file_path: '/work/other/report.md',
        content: '# Report\n',
        sandbox_permissions: 'danger-full-access',
        justification: 'Create the report requested by the user.',
      }),
    })

    await expect(b.answer(request, next)).resolves.toBe('allowed-once')
    expect(fs.lstat).toHaveBeenCalledWith('/work/other/report.md', { cwd: '/work/main' }, undefined)
    expect(next).not.toHaveBeenCalled()
  })

  it('fails closed once a disposed session drops its folded context', async () => {
    const b = bench({ llm: { stream: reviewerStream(BENIGN_BUILD) } })
    await apply(b.ctx, {})
    const request = flow({ bench: b, sessionId: 'session-disposed', arguments: '{"command":"pnpm test"}' })

    const granted = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    await expect(b.answer(request, granted)).resolves.toBe('allowed-once')
    expect(granted).not.toHaveBeenCalled()

    b.dispose(request.agent.session)

    const afterDisposal = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    await expect(b.answer(request, afterDisposal)).resolves.toBe('rejected')
    expect(afterDisposal).toHaveBeenCalledOnce()
  })

  it('projects a successful approval-mode command using only harness-known lifecycle events', () => {
    const running = applyReviewModeEvent(
      initialReviewModeState('smart'),
      {
        type: 'command/run', seq: 0, time: 1,
        data: { commandId: 'command-mode', name: 'approval-mode', args: ' unattended', source: { kind: 'user' } },
      } as unknown as SessionEvent,
    )
    const done = applyReviewModeEvent(
      running,
      {
        type: 'command/done', seq: 1, time: 2,
        data: { commandId: 'command-mode', kind: 'success', text: 'approval mode unattended' },
      } as unknown as SessionEvent,
    )

    expect(done.mode).toBe('unattended')
  })

  it('does not project an approval-mode command whose sidecar write failed', () => {
    const running = applyReviewModeEvent(
      initialReviewModeState('smart'),
      {
        type: 'command/run', seq: 0, time: 1,
        data: { commandId: 'command-failed', name: 'approval-mode', args: ' unattended', source: { kind: 'user' } },
      } as unknown as SessionEvent,
    )
    const done = applyReviewModeEvent(
      running,
      {
        type: 'command/done', seq: 1, time: 2,
        data: { commandId: 'command-failed', kind: 'error', text: 'storage failed' },
      } as unknown as SessionEvent,
    )

    expect(done.mode).toBe('smart')
  })

  it('registers an independent mode command and projection', async () => {
    const b = bench()
    await apply(b.ctx, {})

    expect(b.commands.map(entry => entry.name)).toEqual(['approval-mode', 'approval-log'])
    const initialState = b.projection?.stateSchema.parse(b.projection.init())
    expect(initialState).toEqual({ mode: 'smart' })
    expect(b.projection?.wire.viewSchema.parse(b.projection.wire.view(initialState))).toEqual({ mode: 'smart' })
    const modeCommand = b.commands.find(entry => entry.name === 'approval-mode')!

    const session = sessionOf('session-command')
    const result = await modeCommand.handler({ agent: { session } as unknown as Agent, rawInput: 'manual' })

    expect(result).toEqual({ kind: 'success', text: 'approval mode manual' })
    expect(b.storage.tables.get('sessions')?.get('session-command')).toEqual({
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'manual',
    })
    // The sidecar is the only writer of review mode: no extension events are
    // appended to the Session log.
    expect(session.append).not.toHaveBeenCalled()
  })

  it('fails at load when only half of a dedicated reviewer route is configured', () => {
    const ctx = {
      on: vi.fn(),
      llm: { stream: vi.fn() },
      logger: { info: vi.fn() },
    } as unknown as Context

    expect(() => apply(ctx, { reviewerProvider: 'review-provider' })).toThrow(/provider and model must be configured together/)
    expect(ctx.on).not.toHaveBeenCalled()
  })

  it('appends each automatic decision to the session-bound decisions table', async () => {
    const b = bench({ llm: { stream: reviewerStream(BENIGN_BUILD) } })
    await apply(b.ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = flow({
      bench: b,
      sessionId: 'session-smart-mode',
      callId: 'call-smart-mode',
      arguments: '{"command":"pnpm test"}',
    })
    await expect(b.answer(request, next)).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()

    await vi.waitFor(() => {
      expect(b.storage.tables.get('decisions')?.get('session-smart-mode')).toMatchObject({
        session: { createdAt: 1, cwd: '/work/main' },
        entries: [expect.objectContaining({
          toolName: 'bash',
          outcome: 'allowed-once',
          reasonCode: 'bounded-build-test',
          mode: 'smart',
          callId: 'call-smart-mode',
          time: expect.any(Number),
        })],
      })
    })
  })

  it('keeps the approval outcome when the decision audit write fails', async () => {
    const b = bench({
      llm: { stream: reviewerStream(BENIGN_BUILD) },
      decisionsPut: async () => { throw new Error('storage offline') },
    })
    await apply(b.ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = flow({
      bench: b,
      sessionId: 'session-smart-mode',
      callId: 'call-smart-mode',
      arguments: '{"command":"pnpm test"}',
    })

    await expect(b.answer(request, next)).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
    expect(b.ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('allowed-once (bounded-build-test)'))
    expect(b.storage.tables.get('decisions')?.has('session-smart-mode')).toBe(false)
  })

  it('writes no decision entries while manual mode is selected', async () => {
    const b = bench()
    b.storage.tables.get('sessions')!.set('session-smart-mode', {
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'manual',
    })
    await apply(b.ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = flow({
      bench: b,
      sessionId: 'session-smart-mode',
      callId: 'call-smart-mode',
      arguments: '{"command":"pnpm test"}',
    })

    await expect(b.answer(request, next)).resolves.toBe('rejected')
    expect(next).toHaveBeenCalledOnce()
    expect(b.storage.tables.get('decisions')?.size ?? 0).toBe(0)
  })

  it('registers an approval-log command listing the newest decisions first', async () => {
    const b = bench()
    await apply(b.ctx, {})
    const command = b.commands.find(entry => entry.name === 'approval-log')!

    b.storage.tables.get('decisions')!.set('session-command', {
      session: { createdAt: 1, cwd: '/work/main' },
      entries: [
        { time: 1, toolName: 'bash', outcome: 'allowed-once', reasonCode: 'a', mode: 'smart' },
        { time: 2, toolName: 'bash', outcome: 'rejected', reasonCode: 'b', mode: 'unattended' },
        { time: 3, toolName: 'write', outcome: 'human', reasonCode: 'c', mode: 'smart', callId: 'call-9' },
      ],
    })
    const session = sessionOf('session-command')

    const listing = await command.handler({ agent: { session } as unknown as Agent, rawInput: '' })
    expect(listing).toEqual({
      kind: 'success',
      text: [
        `${new Date(3).toISOString()} write human (c) [smart]`,
        `${new Date(2).toISOString()} bash rejected (b) [unattended]`,
        `${new Date(1).toISOString()} bash allowed-once (a) [smart]`,
      ].join('\n'),
    })

    const limited = await command.handler({ agent: { session } as unknown as Agent, rawInput: ' 1 ' })
    expect(limited).toEqual({ kind: 'success', text: `${new Date(3).toISOString()} write human (c) [smart]` })

    const invalid = await command.handler({ agent: { session } as unknown as Agent, rawInput: 'many' })
    expect(invalid).toEqual({ kind: 'error', text: 'invalid approval-log count "many"' })

    const empty = await command.handler({
      agent: { session: sessionOf('session-empty', '/work/other') } as unknown as Agent,
      rawInput: '',
    })
    expect(empty).toEqual({ kind: 'success', text: 'no automatic decisions in this session' })
  })

  it('disables the decision audit entirely when decisionLogSize is 0', async () => {
    const b = bench({ llm: { stream: reviewerStream(BENIGN_BUILD) } })
    await apply(b.ctx, { decisionLogSize: 0 })
    const request = flow({ bench: b, sessionId: 'session-smart-mode', callId: 'call-smart-mode', arguments: '{"command":"pnpm test"}' })
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    await expect(b.answer(request, next)).resolves.toBe('allowed-once')
    expect(b.storage.tables.get('decisions')?.size ?? 0).toBe(0)

    const command = b.commands.find(entry => entry.name === 'approval-log')!
    const result = await command.handler({ agent: request.agent, rawInput: '' })
    expect(result).toEqual({ kind: 'success', text: 'decision log disabled' })
  })

  it('defaults the bounded context and audit settings, and validates the disable switch', () => {
    expect(Config({})).toMatchObject({
      decisionLogSize: 50,
      maxUserMessages: 4,
      maxTrackedToolCalls: 32,
    })
    expect(Config({ decisionLogSize: 0, maxTrackedToolCalls: 8 })).toMatchObject({
      decisionLogSize: 0,
      maxTrackedToolCalls: 8,
    })
    expect(() => Config({ decisionLogSize: -1 })).toThrow()
    expect(() => Config({ maxTrackedToolCalls: 0 })).toThrow()
  })
})
