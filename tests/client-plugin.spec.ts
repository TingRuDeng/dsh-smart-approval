import { describe, expect, it, vi } from 'vitest'
import { ReviewModeSelect } from '../src/client/ReviewModeSelect.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { ReviewModeSelectInjected } from '../src/client/index.ts'

const SESSION_ID = 'review-mode-session'

function bench() {
  let registration: { options: { name: string; id?: string; order?: number }; component: unknown; inject?: unknown } | undefined
  const execute = vi.fn((_sessionId: string, _line: string) => Promise.resolve({
    ok: true,
    value: { commandId: 'command-1', result: { kind: 'success' as const } },
  }))
  const register = vi.fn((options: { name: string; id?: string; order?: number; inject?: unknown }, component: unknown) => {
    registration = { options, component, inject: options.inject }
    return vi.fn()
  })
  const ctx = {
    remote: { commands: { execute } },
    locale: { register: vi.fn(() => vi.fn()) },
    effect: vi.fn((factory: () => unknown) => factory()),
    slots: {
      inject: vi.fn((_name: string, factory: () => unknown) => factory()),
      register,
    },
  }
  return { ctx, execute, registration: () => registration }
}

describe('smart approval browser plugin', () => {
  it('registers an independent composer control and switches only approval mode', async () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
    const b = bench()
    apply(b.ctx as never)

    const entry = b.registration()
    expect(entry?.options).toMatchObject({ name: 'conversation.input.left', id: 'approval-review' })
    expect(entry?.component).toBe(ReviewModeSelect)
    const injected = (entry?.inject as unknown as (id: string) => ReviewModeSelectInjected)(SESSION_ID)

    await expect(injected.select('unattended')).resolves.toBe(true)
    expect(b.execute).toHaveBeenCalledWith(SESSION_ID, '/approval-mode unattended')
  })
})
