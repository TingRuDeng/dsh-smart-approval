import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

const { Config, apply, inject, name } = plugin

function smartModeRequest(): ApprovalRequest {
  const callId = CallId('call-smart-mode')
  const message: UserMessage = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '在当前项目运行测试' }],
  })
  const events = [
    { type: 'smart-approval/mode', seq: 0, time: 1, data: { mode: 'smart' } },
    { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 3, data: { turn: 1, step: 1 } },
    { type: 'user/message', seq: 3, time: 4, surfaceOp: 'append', data: message },
    {
      type: 'tool/call',
      seq: 4,
      time: 5,
      data: { turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"pnpm test"}' },
    },
  ] as unknown as SessionEvent[]
  const session = {
    events,
    header: { cwd: '/work/main' },
    deriveMessages: () => [message],
    requestContext: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
  }
  return {
    agent: { session, options: {} } as unknown as Agent,
    toolName: 'bash',
    callId,
  }
}

describe('plugin entry', () => {
  it('declares the DSH services needed by the prepended answerer', () => {
    expect(name).toBe('dsh-smart-approval')
    expect(inject).toEqual(['approval', 'permissionPresets', 'llm', 'sessions'])
    expect(Config).toBeDefined()
    expect('default' in plugin).toBe(false)
  })

  it('registers ahead of the existing human answerer without reusing permission presets as review state', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const current = vi.fn(() => 'workspace-write')
    const on = vi.fn((event: string, callback: typeof listener, options: unknown) => {
      if (event === 'session/created') return
      expect(event).toBe('approval/request')
      expect(options).toEqual({ prepend: true })
      listener = callback
    })
    const ctx = {
      on,
      inject: vi.fn(),
      sessions: { list: vi.fn(() => []) },
      permissionPresets: { current },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn() },
    } as unknown as Context

    apply(ctx, {})
    expect(on).toHaveBeenCalledTimes(2)
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = { agent: { session: { events: [] } } } as unknown as ApprovalRequest
    await expect(listener?.(request, next)).resolves.toBe('rejected')
    expect(current).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })

  it('reads smart review mode independently from the workspace-write permission preset', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const ctx = {
      on: vi.fn((event: string, callback: typeof listener) => {
        if (event === 'approval/request') listener = callback
      }),
      inject: vi.fn(),
      sessions: { list: vi.fn(() => []) },
      permissionPresets: { current: vi.fn(() => 'workspace-write') },
      llm: {
        stream: vi.fn(() => (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"decision":"allow","reasonCode":"bounded-build-test"}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()),
      },
      logger: { info: vi.fn() },
    } as unknown as Context

    apply(ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')

    await expect(listener?.(smartModeRequest(), next)).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
  })

  it('migrates existing preset modes and pins smart mode for new sessions', () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const existingEvents = [
      { type: 'permission/preset', seq: 0, time: 1, data: { preset: 'unattended' } },
    ] as unknown as SessionEvent[]
    const existing = {
      events: existingEvents,
      append: vi.fn((type: string, data: unknown) => {
        existingEvents.push({ type, seq: existingEvents.length, time: 2, data } as unknown as SessionEvent)
      }),
    }
    const ctx = {
      on: vi.fn((event: string, callback: (value: unknown) => void) => {
        listeners.set(event, callback)
      }),
      inject: vi.fn(),
      sessions: { list: vi.fn(() => [existing]) },
      permissionPresets: {
        current: vi.fn((events: readonly SessionEvent[]) => {
          const preset = events.findLast(event => event.type === 'permission/preset')
          return preset?.type === 'permission/preset' ? preset.data.preset : 'workspace-write'
        }),
      },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn() },
    } as unknown as Context

    apply(ctx, {})
    expect(existing.append).toHaveBeenCalledWith('smart-approval/mode', { mode: 'unattended' })

    const created = { events: [] as SessionEvent[], append: vi.fn() }
    listeners.get('session/created')?.(created)
    expect(created.append).toHaveBeenCalledWith('smart-approval/mode', { mode: 'smart' })
  })

  it('registers an independent mode command and projection', () => {
    let command: {
      name: string
      handler: (input: { agent: Agent; rawInput: string }) => { kind: string; text: string }
    } | undefined
    let projection: {
      init: () => unknown
      apply: (state: unknown, event: SessionEvent) => unknown
      view: (state: unknown) => unknown
    } | undefined
    const ctx = {
      on: vi.fn(),
      sessions: { list: vi.fn(() => []) },
      permissionPresets: { current: vi.fn(() => 'workspace-write') },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn() },
      inject: vi.fn((services: readonly string[], callback: (scope: unknown) => void) => {
        if (services.includes('commands')) {
          callback({ commands: { register: (value: typeof command) => { command = value } } })
        }
        if (services.includes('sessionProjections')) {
          callback({ sessionProjections: { register: (value: typeof projection) => { projection = value } } })
        }
      }),
    } as unknown as Context

    apply(ctx, {})
    expect(command?.name).toBe('approval-mode')
    expect(projection?.view(projection.init())).toEqual({ mode: 'smart' })

    const events = [
      { type: 'smart-approval/mode', seq: 0, time: 1, data: { mode: 'smart' } },
    ] as unknown as SessionEvent[]
    const session = {
      events,
      append: vi.fn((type: string, data: unknown) => {
        events.push({ type, seq: events.length, time: 2, data } as unknown as SessionEvent)
      }),
    }
    const result = command?.handler({ agent: { session } as unknown as Agent, rawInput: 'manual' })

    expect(result).toEqual({ kind: 'success', text: 'approval mode manual' })
    expect(session.append).toHaveBeenCalledWith('smart-approval/mode', { mode: 'manual' })
    expect(projection?.view(projection.apply(projection.init(), events.at(-1) as SessionEvent))).toEqual({ mode: 'manual' })
  })

  it('fails at load when only half of a dedicated reviewer route is configured', () => {
    const ctx = {
      on: vi.fn(),
      sessions: { list: vi.fn(() => []) },
      permissionPresets: { current: vi.fn() },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn() },
    } as unknown as Context

    expect(() => apply(ctx, { reviewerProvider: 'review-provider' })).toThrow(/provider and model must be configured together/)
    expect(ctx.on).not.toHaveBeenCalled()
  })

})
