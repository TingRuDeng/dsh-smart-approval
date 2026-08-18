import { useEffect, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

interface ModelOption {
  readonly id: string
  readonly name: string
}

interface ProviderOption extends ModelOption {
  readonly models: readonly ModelOption[]
}

interface ReviewerModelState {
  readonly selection: { readonly reviewerProvider: string; readonly reviewerModel: string } | null
  readonly providers: readonly ProviderOption[]
  readonly hasProfileRoute: boolean
}

interface CardState extends ReviewerModelState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly reviewerProvider: string
  readonly reviewerModel: string
  readonly failed: boolean
}

/** Browser action face for the Smart Approval reviewer settings card. */
export interface ReviewerSettingsInjected {
  readonly connection: ConnectionHandle
}

/** Props bound by the plugin configuration slot. */
export type ReviewerSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<ReviewerSettingsInjected>
  & PropsLocale<'approval-review'>

/** Validate the narrow non-secret model-directory payload returned by the plugin RPC. */
function isReviewerModelState(value: unknown): value is ReviewerModelState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const selection = candidate.selection
  const providers = candidate.providers
  if (selection !== null && (!isRoute(selection))) return false
  return typeof candidate.hasProfileRoute === 'boolean' && Array.isArray(providers)
    && providers.every(isProvider)
}

function isRoute(value: unknown): value is { readonly reviewerProvider: string; readonly reviewerModel: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.reviewerProvider === 'string' && typeof candidate.reviewerModel === 'string'
}

function isProvider(value: unknown): value is ProviderOption {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string'
    && Array.isArray(candidate.models) && candidate.models.every(isModel)
}

function isModel(value: unknown): value is ModelOption {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).id === 'string'
    && typeof (value as Record<string, unknown>).name === 'string'
}

function initialState(): CardState {
  return {
    status: 'loading', selection: null, providers: [], hasProfileRoute: false,
    reviewerProvider: '', reviewerModel: '', failed: false,
  }
}

function readyState(value: ReviewerModelState): CardState {
  return {
    status: 'ready',
    ...value,
    reviewerProvider: value.selection?.reviewerProvider ?? '',
    reviewerModel: value.selection?.reviewerModel ?? '',
    failed: false,
  }
}

/** Configure the LLM route used only by Smart and Unattended approval requests. */
export function ReviewerSettingsCard({ connection, t }: ReviewerSettingsCardProps) {
  const [state, setState] = useState<CardState>(initialState)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    void connection.rpc.call('/smart-approval', 'reviewer-model', {}).then((result) => {
      if (!live) return
      if (!result.ok || !isReviewerModelState(result.value)) {
        setState(current => ({ ...current, status: 'error' }))
        return
      }
      setState(readyState(result.value))
    }, () => {
      if (live) setState(current => ({ ...current, status: 'error' }))
    })
    return () => { live = false }
  }, [connection])

  if (state.status === 'loading') {
    return <li className="dsh-smart-approval-settings-card dsh-smart-approval-settings-status">{t('settings.loading')}</li>
  }
  if (state.status === 'error') {
    return <li className="dsh-smart-approval-settings-card dsh-smart-approval-settings-status" role="status">{t('settings.loadFailed')}</li>
  }

  const provider = state.providers.find(entry => entry.id === state.reviewerProvider)
  const models = provider?.models ?? []
  const savedProvider = state.selection?.reviewerProvider ?? ''
  const savedModel = state.selection?.reviewerModel ?? ''
  const dirty = state.reviewerProvider !== savedProvider || state.reviewerModel !== savedModel
  const canSave = !saving && (state.reviewerProvider === '' || state.reviewerModel !== '')

  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    const payload = state.reviewerProvider === '' ? {} : {
      reviewerProvider: state.reviewerProvider,
      reviewerModel: state.reviewerModel,
    }
    try {
      const result = await connection.rpc.call('/smart-approval', 'set-reviewer-model', payload)
      if (!result.ok || !isReviewerModelState(result.value)) {
        setState(current => ({ ...current, failed: true }))
        return
      }
      setState(readyState(result.value))
    } catch {
      setState(current => ({ ...current, failed: true }))
    } finally {
      setSaving(false)
    }
  }

  const reset = (): void => {
    setState(current => ({
      ...current,
      reviewerProvider: current.selection?.reviewerProvider ?? '',
      reviewerModel: current.selection?.reviewerModel ?? '',
      failed: false,
    }))
  }

  return (
    <li className={`dsh-smart-approval-settings-card${open ? ' dsh-smart-approval-settings-card--open' : ''}`}>
      <button
        type="button"
        className="dsh-smart-approval-settings-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${t('settings.title')}${dirty ? `, ${t('settings.unsaved')}` : ''}`}
        onClick={() => { setOpen(current => !current) }}
      >
        <span className="dsh-smart-approval-settings-head-text">
          <span className="dsh-smart-approval-settings-title">{t('settings.title')}</span>
          <span className="dsh-smart-approval-settings-description">
            {t('settings.description')}
          </span>
        </span>
        {dirty ? <span className="dsh-smart-approval-settings-unsaved">{t('settings.unsaved')}</span> : null}
        <span aria-hidden className={`dsh-smart-approval-settings-chevron${open ? ' dsh-smart-approval-settings-chevron--open' : ''}`}>⌄</span>
      </button>
      {open ? (
        <div className="dsh-smart-approval-settings-body">
          <p className="dsh-smart-approval-settings-note">{t('settings.manualNote')}</p>
          <label>
            <span>{t('settings.provider')}</span>
            <select
              value={state.reviewerProvider}
              disabled={saving}
              onChange={(event) => {
                const reviewerProvider = event.currentTarget.value
                const nextModels = state.providers.find(entry => entry.id === reviewerProvider)?.models ?? []
                setState(current => ({
                  ...current,
                  reviewerProvider,
                  reviewerModel: reviewerProvider === '' ? ''
                    : nextModels.some(model => model.id === current.reviewerModel)
                      ? current.reviewerModel
                      : (nextModels[0]?.id ?? ''),
                  failed: false,
                }))
              }}
            >
              <option value="">{t(state.hasProfileRoute ? 'settings.followProfile' : 'settings.followSession')}</option>
              {state.providers.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          {state.reviewerProvider !== '' ? (
            <label>
              <span>{t('settings.model')}</span>
              <select
                value={state.reviewerModel}
                disabled={saving || models.length === 0}
                onChange={(event) => {
                  const reviewerModel = event.currentTarget.value
                  setState(current => ({ ...current, reviewerModel, failed: false }))
                }}
              >
                {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            </label>
          ) : null}
          {state.reviewerProvider !== '' && models.length === 0 ? <p role="status">{t('settings.noModels')}</p> : null}
          <div className="dsh-smart-approval-settings-actions">
            {state.failed ? <span role="status">{t('settings.saveFailed')}</span> : null}
            <button type="button" disabled={!dirty || saving} onClick={reset}>{t('settings.discard')}</button>
            <button type="button" disabled={!dirty || !canSave} onClick={() => { void save() }}>{saving ? t('settings.saving') : t('settings.save')}</button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
