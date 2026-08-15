/** Browser entry that contributes the independent review selector. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ReviewMode } from '../review-mode.ts'
import { ReviewModeSelect } from './ReviewModeSelect.tsx'
import type { ReviewModeSelectInjected } from './ReviewModeSelect.tsx'
import { en, zh, type ReviewModeKey } from './locales.ts'

export { ReviewModeSelect } from './ReviewModeSelect.tsx'
export type { ReviewModeSelectInjected, ReviewModeSelectProps } from './ReviewModeSelect.tsx'
export type { ReviewModeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Independent automatic approval review control. */
    'approval-review': ReviewModeKey
  }
}

/** Browser services required by the composer contribution. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/** Register the independent selector beside the access-mode control. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('approval-review', { zh, en }), 'smart-approval: browser dictionaries')
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
}
