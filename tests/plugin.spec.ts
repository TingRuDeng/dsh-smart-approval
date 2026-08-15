import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

const { Config, apply, inject, name } = plugin

describe('plugin entry', () => {
  it('declares the DSH services needed by the prepended answerer', () => {
    expect(name).toBe('dsh-smart-approval')
    expect(inject).toEqual(['approval', 'permissionPresets', 'llm'])
    expect(Config).toBeDefined()
    expect('default' in plugin).toBe(false)
  })

  it('registers ahead of the existing human answerer and reads mode per request', async () => {
    let listener: ((request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const current = vi.fn(() => 'workspace-write')
    const on = vi.fn((event: string, callback: typeof listener, options: unknown) => {
      expect(event).toBe('approval/request')
      expect(options).toEqual({ prepend: true })
      listener = callback
    })
    const ctx = {
      on,
      permissionPresets: { current },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn() },
    } as unknown as Context

    apply(ctx, {})
    expect(on).toHaveBeenCalledOnce()
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const request = { agent: { session: { events: [] } } } as unknown as ApprovalRequest
    await expect(listener?.(request, next)).resolves.toBe('rejected')
    expect(current).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledOnce()
  })

  it('fails at load when only half of a dedicated reviewer route is configured', () => {
    const ctx = {
      on: vi.fn(),
      permissionPresets: { current: vi.fn() },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn() },
    } as unknown as Context

    expect(() => apply(ctx, { reviewerProvider: 'review-provider' })).toThrow(/provider and model must be configured together/)
    expect(ctx.on).not.toHaveBeenCalled()
  })

  it('rejects ambiguous automated preset configuration before registration', () => {
    const ctx = {
      on: vi.fn(),
      permissionPresets: { current: vi.fn() },
      llm: { stream: vi.fn() },
      logger: { info: vi.fn() },
    } as unknown as Context

    expect(() => apply(ctx, { preset: 'same', unattendedPreset: 'same' })).toThrow(/must be different/)
    expect(ctx.on).not.toHaveBeenCalled()
  })
})
