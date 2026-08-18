// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReviewerSettingsCard } from '../src/client/ReviewerSettingsCard.tsx'
import type { ReviewerSettingsCardProps } from '../src/client/ReviewerSettingsCard.tsx'

afterEach(cleanup)

const labels = {
  'settings.title': '智能审批模型',
  'settings.description': '为智能审批和无人值守审批选择审核 LLM。不会显示或保存 API Key。',
  'settings.manualNote': '人工审批不会调用此模型，而是始终交由用户逐次决定。',
  'settings.loading': '正在加载智能审批模型配置…',
  'settings.loadFailed': '无法加载智能审批模型配置。',
  'settings.provider': 'LLM 供应商',
  'settings.model': '模型',
  'settings.followProfile': '跟随 profile 默认模型',
  'settings.followSession': '跟随当前会话模型',
  'settings.noModels': '该供应商没有可用于文本审批的模型。',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃修改',
  'settings.saveFailed': '保存智能审批模型配置失败。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.unsaved': '有未保存修改',
} as const

const t = ((key: keyof typeof labels) => labels[key]) as ReviewerSettingsCardProps['t']

const state = {
  selection: null,
  providers: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-a', name: 'Model A' }] }],
  hasProfileRoute: false,
}

function setup(call?: (channel: string, endpoint: string) => Promise<unknown>) {
  const rpc = vi.fn(call ?? (async (_channel: string, endpoint: string) => ({
    ok: true,
    value: endpoint === 'reviewer-model' ? state : { ...state, selection: { reviewerProvider: 'provider-a', reviewerModel: 'model-a' } },
  })))
  const props = {
    connection: { rpc: { call: rpc } },
    t,
    session: {},
    input: {},
  } as unknown as ReviewerSettingsCardProps
  return { call: rpc, view: render(<ReviewerSettingsCard {...props} />) }
}

describe('ReviewerSettingsCard', () => {
  it('loads text routes, saves a selected provider/model, and states that Manual never calls it', async () => {
    const { call } = setup()
    const toggle = await screen.findByRole('button', { name: '展开设置: 智能审批模型' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('LLM 供应商')).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByText('人工审批不会调用此模型，而是始终交由用户逐次决定。')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'LLM 供应商' })).toBeTruthy()

    fireEvent.change(screen.getByRole('combobox', { name: 'LLM 供应商' }), { target: { value: 'provider-a' } })
    await screen.findByLabelText('模型')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(call).toHaveBeenLastCalledWith('/smart-approval', 'set-reviewer-model', {
      reviewerProvider: 'provider-a', reviewerModel: 'model-a',
    })
    expect(await screen.findByRole('button', { name: '收起设置: 智能审批模型' })).toBeTruthy()
  })

  it('shows an error instead of rendering an unvalidated RPC payload', async () => {
    setup(async () => ({ ok: true, value: { providers: [] } }))
    expect((await screen.findByRole('status')).textContent).toBe('无法加载智能审批模型配置。')
  })

  it('keeps the card mounted when the model select changes', async () => {
    const errors: unknown[] = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })
    try {
      setup()
      fireEvent.click(await screen.findByRole('button', { name: '展开设置: 智能审批模型' }))
      fireEvent.change(screen.getByRole('combobox', { name: 'LLM 供应商' }), { target: { value: 'provider-a' } })
      const modelSelect = await screen.findByRole('combobox', { name: '模型' })
      // The value must be captured outside the state updater: React nulls a
      // synthetic event's currentTarget after the handler returns, so reading it
      // inside the updater would crash the whole slot entry when the flush lags.
      fireEvent.change(modelSelect, { target: { value: 'model-a' } })
      expect((modelSelect as HTMLSelectElement).value).toBe('model-a')
      // Changing the model marks the card dirty, so the header advertises it.
      expect(screen.getByRole('button', { name: '收起设置: 智能审批模型, 有未保存修改' })).toBeTruthy()
    } finally {
      errSpy.mockRestore()
    }
    expect(errors).toEqual([])
  })
})
