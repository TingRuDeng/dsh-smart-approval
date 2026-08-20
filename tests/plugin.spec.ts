import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { applyReviewModeEvent, initialReviewModeState } from '../src/review-mode.ts'

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
    id: 'session-smart-mode',
    events,
    header: { id: 'session-smart-mode', version: 0, createdAt: 1, cwd: '/work/main' },
    deriveMessages: () => [message],
    requestContext: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
  }
  return {
    agent: { session, options: {} } as unknown as Agent,
    toolName: 'bash',
    callId,
  }
}

function smartWriteRequest(): ApprovalRequest {
  const callId = CallId('call-smart-write')
  const message: UserMessage = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '在 /work/other 创建 report.md' }],
  })
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    { type: 'user/message', seq: 2, time: 3, surfaceOp: 'append', data: message },
    {
      type: 'tool/call',
      seq: 3,
      time: 4,
      data: {
        turn: 1,
        step: 1,
        callId,
        name: 'write',
        arguments: JSON.stringify({
          file_path: '/work/other/report.md',
          content: '# Report\n',
          sandbox_permissions: 'danger-full-access',
          justification: 'Create the report requested by the user.',
        }),
      },
    },
  ] as unknown as SessionEvent[]
  const session = {
    id: 'session-smart-write',
    events,
    header: { id: 'session-smart-write', version: 0, createdAt: 1, cwd: '/work/main' },
    deriveMessages: () => [message],
    requestContext: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
  }
  return {
    agent: { session, options: {} } as unknown as Agent,
    toolName: 'write',
    callId,
  }
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

describe('plugin entry', () => {
  it('declares the DSH services needed by the prepended answerer', () => {
    expect(name).toBe('dsh-smart-approval')
    expect(inject).toEqual(['approval', 'llm', 'sessions', 'storageDomain', 'fs'])
    expect(Config).toBeDefined()
    expect('default' in plugin).toBe(false)
  })

  it('registers ahead of the existing human answerer without reusing permission presets as review state', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const current = vi.fn(() => 'workspace-write')
    const storage = storageBench()
    storage.tables.get('sessions')!.set('session-request', {
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'smart',
    })
    const on = vi.fn((event: string, callback: typeof listener, options: unknown) => {
      if (event === 'session/created') return
      expect(event).toBe('approval/request')
      expect(options).toEqual({ prepend: true })
      listener = callback
    })
    const ctx = {
      on,
      inject: vi.fn(),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      permissionPresets: { current },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Context

    await apply(ctx, {})
    expect(on).toHaveBeenCalledTimes(2)
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = { agent: { session: {
      id: 'session-request',
      header: { id: 'session-request', version: 0, createdAt: 1, cwd: '/work/main' },
      events: [],
    } } } as unknown as ApprovalRequest
    await expect(listener?.(request, next)).resolves.toBe('rejected')
    expect(current).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })

  it('reads smart review mode independently from the workspace-write permission preset', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const storage = storageBench()
    const ctx = {
      on: vi.fn((event: string, callback: typeof listener) => {
        if (event === 'approval/request') listener = callback
      }),
      inject: vi.fn(),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      permissionPresets: { current: vi.fn(() => 'workspace-write') },
      llm: {
        stream: vi.fn(() => (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"riskLevel":"low","authorization":"high","intent":"benign","reasonCode":"bounded-build-test"}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Context

    await apply(ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')

    await expect(listener?.(smartModeRequest(), next)).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
  })

  it('uses the mounted DSH filesystem to review a safe cross-workspace write', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const storage = storageBench()
    const workspace = { displayPath: '/work/main', key: 'workspace' }
    const target = { displayPath: '/work/other/report.md', key: 'target' }
    const fs = {
      resolve: vi.fn(async (path: string) => path === '/work/main' ? workspace : target),
      processPath: vi.fn(() => '/work/other/report.md'),
      contains: vi.fn(() => false),
      stat: vi.fn(async () => undefined),
      lstat: vi.fn(async () => undefined),
    }
    const ctx = {
      on: vi.fn((event: string, callback: typeof listener) => {
        if (event === 'approval/request') listener = callback
      }),
      inject: vi.fn(),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      fs,
      llm: {
        stream: vi.fn(() => (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"riskLevel":"low","authorization":"high","intent":"benign","reasonCode":"bounded-project-write"}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Context

    await apply(ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')

    await expect(listener?.(smartWriteRequest(), next)).resolves.toBe('allowed-once')
    expect(fs.lstat).toHaveBeenCalledWith('/work/other/report.md', { cwd: '/work/main' }, undefined)
    expect(next).not.toHaveBeenCalled()
  })

  it('migrates existing preset modes into sidecar storage without appending extension events', async () => {
    const listeners = new Map<string, (value: unknown) => void | Promise<void>>()
    const existingEvents = [
      { type: 'permission/preset', seq: 0, time: 1, data: { preset: 'unattended' } },
    ] as unknown as SessionEvent[]
    const existing = {
      id: 'session-existing',
      header: { id: 'session-existing', version: 0, createdAt: 1, cwd: '/work/main' },
      events: existingEvents,
      append: vi.fn(),
    }
    const commandSelected = {
      id: 'session-command-selected',
      header: { id: 'session-command-selected', version: 0, createdAt: 2, cwd: '/work/main' },
      events: [
        {
          type: 'command/run', seq: 0, time: 1,
          data: {
            commandId: 'command-migrated', name: 'approval-mode', args: ' manual', source: { kind: 'user' },
          },
        },
        {
          type: 'command/done', seq: 1, time: 2,
          data: { commandId: 'command-migrated', kind: 'success', text: 'approval mode manual' },
        },
      ] as unknown as SessionEvent[],
      append: vi.fn(),
    }
    const legacyEventSelected = {
      id: 'session-legacy-event',
      header: { id: 'session-legacy-event', version: 0, createdAt: 3, cwd: '/work/main' },
      events: [
        { type: 'smart-approval/mode', seq: 0, time: 1, data: { mode: 'manual' } },
      ] as unknown as SessionEvent[],
      append: vi.fn(),
    }
    const legacySmartPreset = {
      id: 'session-legacy-smart-preset',
      header: { id: 'session-legacy-smart-preset', version: 0, createdAt: 4, cwd: '/work/main' },
      events: [
        { type: 'permission/preset', seq: 0, time: 1, data: { preset: 'smart-approval' } },
      ] as unknown as SessionEvent[],
      append: vi.fn(),
    }
    const revertedLegacyPreset = {
      id: 'session-reverted-legacy-preset',
      header: { id: 'session-reverted-legacy-preset', version: 0, createdAt: 5, cwd: '/work/main' },
      events: [
        { type: 'permission/preset', seq: 0, time: 1, data: { preset: 'smart-approval' } },
        { type: 'permission/preset', seq: 1, time: 2, data: { preset: 'workspace-write' } },
      ] as unknown as SessionEvent[],
      append: vi.fn(),
    }
    const tables = new Map<string, Map<string, unknown>>()
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
          put: async (key: string, value: unknown) => { rows!.set(key, value) },
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
    const ctx = {
      on: vi.fn((event: string, callback: (value: unknown) => void | Promise<void>) => {
        listeners.set(event, callback)
      }),
      inject: vi.fn(),
      effect: vi.fn((factory: () => unknown) => factory()),
      storageDomain: { open: vi.fn(async () => domain) },
      sessions: {
        list: vi.fn(() => [
          existing, commandSelected, legacyEventSelected, legacySmartPreset, revertedLegacyPreset,
        ]),
      },
      permissionPresets: {
        current: vi.fn((events: readonly SessionEvent[]) => {
          const preset = events.findLast(event => event.type === 'permission/preset')
          return preset?.type === 'permission/preset' ? preset.data.preset : 'workspace-write'
        }),
      },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Context

    await apply(ctx, {})
    const rows = tables.get('sessions')!
    expect(rows.get('session-existing')).toEqual({
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'unattended',
    })
    expect(rows.get('session-command-selected')).toEqual({
      session: { createdAt: 2, cwd: '/work/main' },
      mode: 'manual',
    })
    expect(rows.get('session-legacy-event')).toEqual({
      session: { createdAt: 3, cwd: '/work/main' },
      mode: 'manual',
    })
    expect(rows.get('session-legacy-smart-preset')).toEqual({
      session: { createdAt: 4, cwd: '/work/main' },
      mode: 'smart',
    })
    expect(rows.get('session-reverted-legacy-preset')).toBeUndefined()
    expect(existing.append).not.toHaveBeenCalled()
    expect(commandSelected.append).not.toHaveBeenCalled()
    expect(legacyEventSelected.append).not.toHaveBeenCalled()
    expect(legacySmartPreset.append).not.toHaveBeenCalled()
    expect(revertedLegacyPreset.append).not.toHaveBeenCalled()

    const created = {
      id: 'session-created',
      header: { id: 'session-created', version: 0, createdAt: 6, cwd: '/work/main' },
      events: [] as SessionEvent[],
      append: vi.fn(),
    }
    await listeners.get('session/created')?.(created)
    expect(rows.get('session-created')).toBeUndefined()
    expect(created.append).not.toHaveBeenCalled()
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
    const commands: {
      name: string
      handler: (input: { agent: Agent; rawInput: string }) => Promise<{ kind: string; text?: string }>
    }[] = []
    let projection: {
      init: () => unknown
      apply: (state: unknown, event: SessionEvent) => unknown
      view: (state: unknown) => unknown
    } | undefined
    const storage = storageBench()
    const ctx = {
      on: vi.fn(),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      permissionPresets: { current: vi.fn(() => 'workspace-write') },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
      inject: vi.fn((services: readonly string[], callback: (scope: unknown) => void) => {
        if (services.includes('commands')) {
          callback({ commands: { register: (value: (typeof commands)[number]) => { commands.push(value) } } })
        }
        if (services.includes('sessionProjections')) {
          callback({ sessionProjections: { register: (value: typeof projection) => { projection = value } } })
        }
      }),
    } as unknown as Context

    await apply(ctx, {})
    expect(commands.map(entry => entry.name)).toEqual(['approval-mode', 'approval-log'])
    expect(projection?.view(projection.init())).toEqual({ mode: 'smart' })
    const modeCommand = commands.find(entry => entry.name === 'approval-mode')!

    const events = [
      { type: 'smart-approval/mode', seq: 0, time: 1, data: { mode: 'smart' } },
    ] as unknown as SessionEvent[]
    const session = {
      id: 'session-command',
      header: { id: 'session-command', version: 0, createdAt: 1, cwd: '/work/main' },
      events,
      append: vi.fn(),
    }
    const result = await modeCommand.handler({ agent: { session } as unknown as Agent, rawInput: 'manual' })

    expect(result).toEqual({ kind: 'success', text: 'approval mode manual' })
    expect(storage.tables.get('sessions')?.get('session-command')).toEqual({
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'manual',
    })
    expect(session.append).not.toHaveBeenCalled()
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

  it('appends each automatic decision to the session-bound decisions table', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const storage = storageBench()
    const ctx = {
      on: vi.fn((event: string, callback: typeof listener) => {
        if (event === 'approval/request') listener = callback
      }),
      inject: vi.fn(),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      llm: {
        stream: vi.fn(() => (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"riskLevel":"low","authorization":"high","intent":"benign","reasonCode":"bounded-build-test"}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Context

    await apply(ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    await expect(listener?.(smartModeRequest(), next)).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()

    await vi.waitFor(() => {
      expect(storage.tables.get('decisions')?.get('session-smart-mode')).toMatchObject({
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
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const storage = storageBench({
      decisionsPut: async () => { throw new Error('storage offline') },
    })
    const logger = { info: vi.fn(), warn: vi.fn() }
    const ctx = {
      on: vi.fn((event: string, callback: typeof listener) => {
        if (event === 'approval/request') listener = callback
      }),
      inject: vi.fn(),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      llm: {
        stream: vi.fn(() => (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"riskLevel":"low","authorization":"high","intent":"benign","reasonCode":"bounded-build-test"}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()),
      },
      logger,
    } as unknown as Context

    await apply(ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    await expect(listener?.(smartModeRequest(), next)).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('allowed-once (bounded-build-test)'))
    expect(storage.tables.get('decisions')?.has('session-smart-mode')).toBe(false)
  })

  it('writes no decision entries while manual mode is selected', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const storage = storageBench()
    storage.tables.get('sessions')!.set('session-smart-mode', {
      session: { createdAt: 1, cwd: '/work/main' },
      mode: 'manual',
    })
    const ctx = {
      on: vi.fn((event: string, callback: typeof listener) => {
        if (event === 'approval/request') listener = callback
      }),
      inject: vi.fn(),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Context

    await apply(ctx, {})
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    await expect(listener?.(smartModeRequest(), next)).resolves.toBe('rejected')
    expect(next).toHaveBeenCalledOnce()
    expect(storage.tables.get('decisions')?.size ?? 0).toBe(0)
  })

  it('registers an approval-log command listing the newest decisions first', async () => {
    const commands: {
      name: string
      handler: (input: { agent: Agent; rawInput: string }) => Promise<{ kind: string; text?: string }>
    }[] = []
    const storage = storageBench()
    const ctx = {
      on: vi.fn(),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
      inject: vi.fn((services: readonly string[], callback: (scope: unknown) => void) => {
        if (services.includes('commands')) {
          callback({ commands: { register: (value: (typeof commands)[number]) => { commands.push(value) } } })
        }
        if (services.includes('sessionProjections')) {
          callback({ sessionProjections: { register: vi.fn() } })
        }
      }),
    } as unknown as Context

    await apply(ctx, {})
    const command = commands.find(entry => entry.name === 'approval-log')!

    storage.tables.get('decisions')!.set('session-command', {
      session: { createdAt: 1, cwd: '/work/main' },
      entries: [
        { time: 1, toolName: 'bash', outcome: 'allowed-once', reasonCode: 'a', mode: 'smart' },
        { time: 2, toolName: 'bash', outcome: 'rejected', reasonCode: 'b', mode: 'unattended' },
        { time: 3, toolName: 'write', outcome: 'human', reasonCode: 'c', mode: 'smart', callId: 'call-9' },
      ],
    })
    const session = {
      id: 'session-command',
      header: { id: 'session-command', version: 0, createdAt: 1, cwd: '/work/main' },
      events: [],
      append: vi.fn(),
    }

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

    const emptySession = {
      id: 'session-empty',
      header: { id: 'session-empty', version: 0, createdAt: 9, cwd: '/work/other' },
      events: [],
      append: vi.fn(),
    }
    const empty = await command.handler({ agent: { session: emptySession } as unknown as Agent, rawInput: '' })
    expect(empty).toEqual({ kind: 'success', text: 'no automatic decisions in this session' })
  })

  it('disables the decision audit entirely when decisionLogSize is 0', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const commands: {
      name: string
      handler: (input: { agent: Agent; rawInput: string }) => Promise<{ kind: string; text?: string }>
    }[] = []
    const storage = storageBench()
    const ctx = {
      on: vi.fn((event: string, callback: typeof listener) => {
        if (event === 'approval/request') listener = callback
      }),
      effect: storage.effect,
      storageDomain: storage.storageDomain,
      sessions: { list: vi.fn(() => []) },
      llm: {
        stream: vi.fn(() => (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"riskLevel":"low","authorization":"high","intent":"benign","reasonCode":"bounded-build-test"}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
      inject: vi.fn((services: readonly string[], callback: (scope: unknown) => void) => {
        if (services.includes('commands')) {
          callback({ commands: { register: (value: (typeof commands)[number]) => { commands.push(value) } } })
        }
        if (services.includes('sessionProjections')) {
          callback({ sessionProjections: { register: vi.fn() } })
        }
      }),
    } as unknown as Context

    await apply(ctx, { decisionLogSize: 0 })
    const request = smartModeRequest()
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    await expect(listener?.(request, next)).resolves.toBe('allowed-once')
    expect(storage.tables.get('decisions')?.size ?? 0).toBe(0)

    const command = commands.find(entry => entry.name === 'approval-log')!
    const result = await command.handler({ agent: request.agent, rawInput: '' })
    expect(result).toEqual({ kind: 'success', text: 'decision log disabled' })
  })

  it('defaults decisionLogSize to 50 and validates the disable switch', () => {
    expect(Config({})).toMatchObject({ decisionLogSize: 50 })
    expect(Config({ decisionLogSize: 0 })).toMatchObject({ decisionLogSize: 0 })
    expect(() => Config({ decisionLogSize: -1 })).toThrow()
  })

})
