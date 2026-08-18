/** Browser entry that contributes the independent review selector. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { ReviewMode } from '../review-mode.ts'
import { ReviewModeSelect } from './ReviewModeSelect.tsx'
import { ReviewerSettingsCard } from './ReviewerSettingsCard.tsx'
import type { ReviewModeSelectInjected } from './ReviewModeSelect.tsx'
import type { ReviewerSettingsInjected } from './ReviewerSettingsCard.tsx'
import { en, zh, type ReviewModeKey } from './locales.ts'

export { ReviewModeSelect } from './ReviewModeSelect.tsx'
export { ReviewerSettingsCard } from './ReviewerSettingsCard.tsx'
export type { ReviewModeSelectInjected, ReviewModeSelectProps } from './ReviewModeSelect.tsx'
export type { ReviewerSettingsInjected, ReviewerSettingsCardProps } from './ReviewerSettingsCard.tsx'
export type { ReviewModeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Independent automatic approval review control. */
    'approval-review': ReviewModeKey
  }
}

/** Browser services required by the composer contribution. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale', 'connection']

/** Styles for the standalone settings card; tokens mirror PluginCard.module.css. */
const SETTINGS_CARD_STYLE_ID = 'dsh-smart-approval-settings-style'
const SETTINGS_CARD_STYLE_TEXT = `
  .dsh-smart-approval-settings-card {
    list-style: none;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 12px;
    background: var(--dsw-alias-bg-layer-3);
    color: var(--dsw-alias-label-primary);
    transition: border-color .16s, background .16s;
  }
  .dsh-smart-approval-settings-card:hover,
  .dsh-smart-approval-settings-card--open {
    border-color: var(--dsw-alias-label-dimmed);
  }
  .dsh-smart-approval-settings-card--open {
    background: var(--dsw-alias-bg-layer-2);
  }
  .dsh-smart-approval-settings-header {
    width: 100%;
    appearance: none;
    border: 0;
    border-radius: 12px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
  }
  .dsh-smart-approval-settings-header:focus-visible {
    outline: 2px solid var(--dsw-alias-brand-primary);
    outline-offset: -2px;
  }
  .dsh-smart-approval-settings-head-text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 4px;
  }
  .dsh-smart-approval-settings-title {
    color: var(--dsw-alias-label-primary);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
  }
  .dsh-smart-approval-settings-description,
  .dsh-smart-approval-settings-body p {
    margin: 0;
    color: var(--dsw-alias-label-tertiary);
    font-size: 13px;
    line-height: 1.5;
  }
  .dsh-smart-approval-settings-unsaved {
    flex: none;
    border-radius: 999px;
    padding: 1px 8px;
    background: var(--dsw-alias-bg-module-platform);
    color: var(--dsw-alias-label-secondary);
    font-size: 11px;
    font-weight: 500;
    line-height: 17px;
    white-space: nowrap;
  }
  .dsh-smart-approval-settings-chevron {
    flex: none;
    color: var(--dsw-alias-label-tertiary);
    transition: transform .16s;
  }
  .dsh-smart-approval-settings-chevron--open { transform: rotate(180deg); }
  .dsh-smart-approval-settings-body {
    display: grid;
    gap: 12px;
    margin: 0 16px;
    padding: 12px 0 16px;
    border-top: 1px solid var(--dsw-alias-border-l2);
  }
  .dsh-smart-approval-settings-body label {
    display: grid;
    gap: 6px;
    font-size: 13px;
  }
  .dsh-smart-approval-settings-body select {
    width: 100%;
    min-width: 0;
    height: 34px;
    padding: 0 12px;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 8px;
    background: var(--dsw-alias-bg-layer-3);
    color: var(--dsw-alias-label-primary);
    font: inherit;
    font-size: 13px;
  }
  .dsh-smart-approval-settings-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 0 4px;
    border-top: 1px solid var(--dsw-alias-border-l2);
  }
  .dsh-smart-approval-settings-actions [role="status"] {
    flex: 1;
    margin: 0;
    color: var(--dsw-alias-label-error);
    font-size: 12px;
    text-align: left;
  }
  .dsh-smart-approval-settings-actions button {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 5px 14px;
    font: inherit;
    font-size: 13px;
    line-height: 1.5;
    cursor: pointer;
  }
  .dsh-smart-approval-settings-actions button:first-of-type {
    border-color: var(--dsw-alias-border-l2);
    background: none;
    color: var(--dsw-alias-label-secondary);
  }
  .dsh-smart-approval-settings-actions button:last-of-type {
    background: var(--dsw-alias-label-primary);
    color: var(--dsw-alias-bg-layer-3);
  }
  .dsh-smart-approval-settings-actions button:disabled {
    opacity: .4;
    cursor: default;
  }
  .dsh-smart-approval-settings-status {
    padding: 14px 16px;
    color: var(--dsw-alias-label-secondary);
    font-size: 13px;
    line-height: 20px;
  }
`

/** Register the independent selector beside the access-mode control. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as import('@deepseek-ai/dsh-client-connection/client').ConnectionHandle
  ctx.effect(() => ctx.locale.register('approval-review', { zh, en }), 'smart-approval: browser dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.id = SETTINGS_CARD_STYLE_ID
    style.textContent = SETTINGS_CARD_STYLE_TEXT
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'smart-approval: settings card style')
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'approval-review',
    order: -10,
    locale: 'approval-review',
    inject: (sessionId: SessionId): ReviewModeSelectInjected => ({
      select: async (mode: ReviewMode) => {
        const result = await ctx.remote.commands.execute(sessionId, `/approval-mode ${mode}`)
        return result.ok && result.value !== undefined && result.value.result.kind === 'success'
      },
    }),
  }, ReviewModeSelect))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'smart-approval',
    order: 40,
    locale: 'approval-review',
    inject: (): ReviewerSettingsInjected => ({ connection }),
  }, ReviewerSettingsCard))
}
