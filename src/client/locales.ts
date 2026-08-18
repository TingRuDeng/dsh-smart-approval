/** Simplified Chinese copy for the independent automatic-review selector. */
export const zh = {
  'trigger.aria': '自动审查，当前：{mode}',
  'trigger.title': '自动审查模式：{mode}',
  'mode.manual': '人工审批',
  'mode.smart': '智能审批',
  'mode.unattended': '无人值守',
  'error.switch': '切换自动审查模式失败',
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
  'settings.unsaved': '有未保存修改',} satisfies Record<string, string>

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
  'settings.title': 'Smart approval model',
  'settings.description': 'Choose the LLM that reviews Smart and Unattended approval requests. API keys are neither shown nor stored.',
  'settings.manualNote': 'Manual approval never calls this model; it always delegates each request to the user.',
  'settings.loading': 'Loading smart approval model configuration…',
  'settings.loadFailed': 'Unable to load smart approval model configuration.',
  'settings.provider': 'LLM provider',
  'settings.model': 'Model',
  'settings.followProfile': 'Follow profile default model',
  'settings.followSession': 'Follow current session model',
  'settings.noModels': 'This provider has no model available for text approval.',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard changes',
  'settings.saveFailed': 'Failed to save smart approval model configuration.',
  'settings.expand': 'Expand settings',
  'settings.collapse': 'Collapse settings',
  'settings.unsaved': 'Unsaved changes',} satisfies Record<ReviewModeKey, string>
