import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReviewMode } from '../review-mode.ts'
import type { ReviewModeKey } from './locales.ts'

/** Action injected by the browser plugin for one session. */
export interface ReviewModeSelectInjected {
  readonly select: (mode: ReviewMode) => Promise<boolean>
}

/** Standard slot props plus the session-scoped mode action and locale seat. */
export type ReviewModeSelectProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<ReviewModeSelectInjected>
  & PropsLocale<'approval-review'>

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  maxWidth: 180,
  height: 28,
  padding: '0 22px 0 8px',
  border: 'none',
  borderRadius: 24,
  outline: 'none',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 500,
  cursor: 'pointer',
  appearance: 'none',
}

/** Localized label key for one closed review mode. */
function modeKey(mode: ReviewMode): ReviewModeKey {
  return `mode.${mode}`
}

/** Independent automatic-review selector shown beside the access control. */
export function ReviewModeSelect({ useProjection, select, t }: ReviewModeSelectProps) {
  const projection = useProjection('approvalReview')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (projection === undefined) return null

  const current = projection.mode
  const currentLabel = t(modeKey(current))

  const choose = (mode: ReviewMode): void => {
    if (mode === current) return
    setBusy(true)
    setFailed(false)
    void select(mode).then((accepted) => {
      setBusy(false)
      setFailed(!accepted)
    }, () => {
      setBusy(false)
      setFailed(true)
    })
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
      <select
        style={triggerStyle}
        aria-label={t('trigger.aria', { mode: currentLabel })}
        title={t('trigger.title', { mode: currentLabel })}
        value={current}
        disabled={busy}
        onChange={(event) => { choose(event.currentTarget.value as ReviewMode) }}
      >
        {(['manual', 'smart', 'unattended'] as const).map(mode => (
          <option key={mode} value={mode}>{t(modeKey(mode))}</option>
        ))}
      </select>
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden
        style={{ position: 'absolute', right: 4, pointerEvents: 'none', color: 'var(--dsw-alias-label-caption)' }}
      >
        <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {failed && (
        <span role="status" title={t('error.switch')} style={{ color: 'var(--dsw-alias-label-error)', fontSize: 12 }}>
          {t('error.switch')}
        </span>
      )}
    </span>
  )
}
