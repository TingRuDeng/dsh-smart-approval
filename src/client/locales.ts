/** Simplified Chinese copy for the independent automatic-review selector. */
export const zh = {
  'trigger.aria': '自动审查，当前：{mode}',
  'trigger.title': '自动审查模式：{mode}',
  'mode.manual': '人工审批',
  'mode.smart': '智能审批',
  'mode.unattended': '无人值守',
  'error.switch': '切换自动审查模式失败',
} satisfies Record<string, string>

/** Locale key union owned by the browser plugin. */
export type ReviewModeKey = keyof typeof zh

/** English copy checked against the Chinese key set. */
export const en = {
  'trigger.aria': 'Automatic review, current: {mode}',
  'trigger.title': 'Automatic review mode: {mode}',
  'mode.manual': 'Manual approval',
  'mode.smart': 'Smart approval',
  'mode.unattended': 'Unattended',
  'error.switch': 'Failed to switch automatic review mode',
} satisfies Record<ReviewModeKey, string>
