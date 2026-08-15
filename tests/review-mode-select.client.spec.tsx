// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReviewModeSelect } from '../src/client/ReviewModeSelect.tsx'
import type { ReviewModeSelectProps } from '../src/client/ReviewModeSelect.tsx'

afterEach(cleanup)

const labels = {
  'trigger.aria': '自动审查，当前：{mode}',
  'trigger.title': '自动审查模式：{mode}',
  'mode.manual': '人工审批',
  'mode.smart': '智能审批',
  'mode.unattended': '无人值守',
  'error.switch': '切换自动审查模式失败',
} as const

const t = ((key: keyof typeof labels, params?: Record<string, string>) => {
  let text: string = labels[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, value)
  return text
}) as ReviewModeSelectProps['t']

function setup(mode: 'manual' | 'smart' | 'unattended' | undefined, select = vi.fn(async () => true)) {
  const props = {
    useProjection: () => mode === undefined ? undefined : { mode },
    select,
    t,
    session: {},
    input: {},
  } as unknown as ReviewModeSelectProps
  const view = render(<ReviewModeSelect {...props} />)
  return { select, view }
}

describe('ReviewModeSelect', () => {
  it('renders nothing until the host exposes the independent review projection', () => {
    expect(setup(undefined).view.container.innerHTML).toBe('')
  })

  it('renders an independent smart-review selector and switches only review mode', () => {
    const { select } = setup('smart')
    const trigger = screen.getByRole('combobox', { name: '自动审查，当前：智能审批' })
    expect(trigger.textContent).toContain('智能审批')

    fireEvent.change(trigger, { target: { value: 'manual' } })

    expect(select).toHaveBeenCalledWith('manual')
  })
})
