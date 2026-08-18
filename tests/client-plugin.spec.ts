// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { ReviewModeSelect } from '../src/client/ReviewModeSelect.tsx'
import { ReviewerSettingsCard } from '../src/client/ReviewerSettingsCard.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { ReviewModeSelectInjected } from '../src/client/index.ts'

const SESSION_ID = 'review-mode-session'

function bench() {
  const registrations: { options: { name: string; id?: string; order?: number }; component: unknown; inject?: unknown }[] = []
  const execute = vi.fn((_sessionId: string, _line: string) => Promise.resolve({
    ok: true,
    value: { commandId: 'command-1', result: { kind: 'success' as const } },
  }))
  const register = vi.fn((options: { name: string; id?: string; order?: number; inject?: unknown }, component: unknown) => {
    registrations.push({ options, component, inject: options.inject })
    return vi.fn()
  })
  const effects: Array<() => void> = []
  const ctx = {
    get: vi.fn((name: string) => name === 'connection' ? { rpc: { call: vi.fn() } } : undefined),
    remote: { commands: { execute } },
    locale: { register: vi.fn(() => vi.fn()) },
    effect: vi.fn((factory: () => unknown) => {
      const dispose = factory()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
      return dispose
    }),
    slots: {
      inject: vi.fn((_name: string, factory: () => unknown) => factory()),
      register,
    },
  }
  return { ctx, effects, execute, registrations }
}

describe('smart approval browser plugin', () => {
  it('registers an independent composer control and switches only approval mode', async () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale', 'connection'])
    const b = bench()
    apply(b.ctx as never)

    const entry = b.registrations.find(candidate => candidate.options.id === 'approval-review')
    expect(entry?.options).toMatchObject({ name: 'conversation.input.left', id: 'approval-review' })
    expect(entry?.component).toBe(ReviewModeSelect)
    expect(b.registrations.find(candidate => candidate.options.id === 'smart-approval')).toMatchObject({
      options: { name: 'settings.plugin.item', id: 'smart-approval', order: 40 },
      component: ReviewerSettingsCard,
    })
    expect(document.getElementById('dsh-smart-approval-settings-style')?.textContent)
      .toContain('border: 1px solid var(--dsw-alias-border-l2)')
    const injected = (entry?.inject as unknown as (id: string) => ReviewModeSelectInjected)(SESSION_ID)

    await expect(injected.select('unattended')).resolves.toBe(true)
    expect(b.execute).toHaveBeenCalledWith(SESSION_ID, '/approval-mode unattended')
  })
})
