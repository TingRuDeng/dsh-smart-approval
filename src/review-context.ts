/** Trusted-context extraction for one DSH approval request. */

import type { Message } from '@deepseek-ai/dsh-llm'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

/** Input limits that prevent partial authorization context from reaching a reviewer. */
export interface ReviewContextLimits {
  /** Maximum raw character count of one tool's JSON arguments. */
  readonly maxToolArgumentChars: number
  /** Maximum number of recent direct-user messages sent to the reviewer. */
  readonly maxUserMessages: number
  /** Maximum combined character count of those user messages. */
  readonly maxUserContextChars: number
}

/** Sandbox escalation targets currently advertised by DSH mutating tools. */
export type SandboxPermission = 'workspace-write' | 'danger-full-access'

/** Exact shell execution semantics presented to the reviewer model. */
export interface ShellReviewAction {
  readonly kind: 'shell'
  readonly toolName: 'bash' | 'pwsh'
  readonly arguments: {
    readonly command: string
    readonly timeoutMs?: number
    readonly workdir?: string
    readonly run_in_background?: boolean
    readonly sandbox_permissions?: SandboxPermission
  }
}

/** Exact full-file write semantics presented to the reviewer model. */
export interface FileWriteReviewAction {
  readonly kind: 'file-write'
  readonly toolName: 'write'
  readonly arguments: {
    readonly file_path: string
    readonly content: string
    readonly sandbox_permissions?: SandboxPermission
  }
}

/** Exact literal replacement semantics presented to the reviewer model. */
export interface FileEditReviewAction {
  readonly kind: 'file-edit'
  readonly toolName: 'edit'
  readonly arguments: {
    readonly file_path: string
    readonly old_string: string
    readonly new_string: string
    readonly replace_all?: boolean
    readonly sandbox_permissions?: SandboxPermission
  }
}

/** Closed set of approval actions whose execution semantics are understood. */
export type ReviewAction = ShellReviewAction | FileWriteReviewAction | FileEditReviewAction
/** Closed set of file mutation actions that require target inspection. */
export type FileReviewAction = FileWriteReviewAction | FileEditReviewAction

/** Read-only filesystem facts attached to one exact file mutation. */
export interface FileTargetEvidence {
  /** Backend-owned display path of the resolved target. */
  readonly resolvedPath: string
  /** Whether the canonical target is within the session workspace. */
  readonly workspaceRelation: 'inside' | 'outside'
  /** Type of the requested final path component without following a symlink. */
  readonly pathEntryType: 'missing' | 'file' | 'directory' | 'symlink' | 'other'
  /** Type of the canonical resolved target after following filesystem aliases. */
  readonly targetType: 'missing' | 'file' | 'directory' | 'other'
  /** Byte size of an existing regular target, when available. */
  readonly size?: number
  /** Whether the canonical execution path is a protected system location. */
  readonly systemLocation: boolean
}

/** Result of inspecting one exact file mutation target without reading content. */
export type FileTargetInspectionResult =
  | { readonly kind: 'ready'; readonly evidence: FileTargetEvidence }
  | { readonly kind: 'human'; readonly reasonCode: string }

/** The exact action and user-owned context presented to the reviewer model. */
export interface ReviewPayload {
  /** Version of the reviewer-facing payload contract. */
  readonly schemaVersion: 2
  /** Session workspace recorded when the session was created, when available. */
  readonly workspaceRoot?: string
  /** Tool identity plus parsed arguments from the matching durable `tool/call`. */
  readonly action: ReviewAction
  /** Read-only target facts for file mutations; absent for shell actions. */
  readonly fileTarget?: FileTargetEvidence
  /** Bounded direct-user messages, with explicit disclosure when older history was omitted. */
  readonly trustedUserContext: {
    readonly messages: readonly string[]
    readonly historyOmitted: boolean
  }
}

/** Stable context failures that always delegate to a human answerer. */
export type ContextFailureReason =
  | 'missing-tool-call'
  | 'tool-mismatch'
  | 'tool-arguments-too-large'
  | 'invalid-tool-arguments'
  | 'unsupported-tool'
  | 'unsupported-tool-arguments'
  | 'missing-user-context'
  | 'too-many-user-messages'
  | 'unsupported-user-content'
  | 'user-context-too-large'

/** Result of extracting the bounded trusted context for one request. */
export type ReviewPayloadResult =
  | { readonly kind: 'ready'; readonly payload: ReviewPayload }
  | { readonly kind: 'human'; readonly reasonCode: ContextFailureReason }

/**
 * Resolve one request to its durable tool arguments and bounded recent direct-user messages.
 * The request's free-form `reason` is intentionally excluded: the model that
 * requested escalation authored it, so it cannot establish user consent.
 * @param request - DSH approval request being dispatched.
 * @param limits - complete context limits.
 * @returns a review payload, or a mandatory human handoff.
 */
export function buildReviewPayload(
  request: ApprovalRequest,
  limits: ReviewContextLimits,
): ReviewPayloadResult {
  if (request.callId === undefined) return { kind: 'human', reasonCode: 'missing-tool-call' }
  const matchingCalls = request.agent.session.events.filter(event =>
    event.type === 'tool/call' && event.data.callId === request.callId,
  )
  if (matchingCalls.length !== 1) return { kind: 'human', reasonCode: 'missing-tool-call' }
  const call = matchingCalls[0]
  if (call === undefined || call.type !== 'tool/call') {
    return { kind: 'human', reasonCode: 'missing-tool-call' }
  }
  if (call.data.name !== request.toolName) return { kind: 'human', reasonCode: 'tool-mismatch' }
  if (call.data.arguments.length > limits.maxToolArgumentChars) {
    return { kind: 'human', reasonCode: 'tool-arguments-too-large' }
  }

  let parsedArguments: unknown
  try {
    parsedArguments = JSON.parse(call.data.arguments)
  } catch {
    return { kind: 'human', reasonCode: 'invalid-tool-arguments' }
  }
  if (!isRecord(parsedArguments)) {
    return { kind: 'human', reasonCode: 'invalid-tool-arguments' }
  }
  const normalizedArguments = normalizeToolArguments(call.data.name, parsedArguments)
  if (normalizedArguments.kind === 'human') return normalizedArguments

  const callIndex = request.agent.session.events.indexOf(call)
  const turnStartIndex = findTurnStart(request.agent.session.events, callIndex, call.data.turn)
  if (turnStartIndex === undefined) return { kind: 'human', reasonCode: 'missing-user-context' }
  const currentDirectUserMessages = request.agent.session.events
    .slice(turnStartIndex + 1, callIndex)
    .filter(event => event.type === 'user/message')
    .map(event => event.data)
    .filter(isDirectUserMessage)
  if (currentDirectUserMessages.length > limits.maxUserMessages) {
    return { kind: 'human', reasonCode: 'too-many-user-messages' }
  }
  if (currentDirectUserMessages.some(message => message.content.some(block => block.type !== 'text'))) {
    return { kind: 'human', reasonCode: 'unsupported-user-content' }
  }
  const currentUserRequests = currentDirectUserMessages
    .map(textOf)
    .filter(text => text !== '')
  if (currentUserRequests.length === 0) return { kind: 'human', reasonCode: 'missing-user-context' }
  let contextChars = currentUserRequests.reduce((total, text) => total + text.length, 0)
  if (contextChars > limits.maxUserContextChars) {
    return { kind: 'human', reasonCode: 'user-context-too-large' }
  }

  const userRequests = [...currentUserRequests]
  let historyOmitted = false
  const previousDirectUserMessages = request.agent.session.events
    .slice(0, turnStartIndex)
    .filter(event => event.type === 'user/message')
    .map(event => event.data)
    .filter(isDirectUserMessage)
  for (let index = previousDirectUserMessages.length - 1; index >= 0; index -= 1) {
    const message = previousDirectUserMessages[index]
    if (message === undefined) continue
    if (message.content.some(block => block.type !== 'text')) {
      historyOmitted = true
      break
    }
    const text = textOf(message)
    if (text === '') continue
    if (userRequests.length >= limits.maxUserMessages
      || contextChars + text.length > limits.maxUserContextChars) {
      historyOmitted = true
      break
    }
    userRequests.unshift(text)
    contextChars += text.length
  }

  const workspaceRoot = request.agent.session.header.cwd
  return {
    kind: 'ready',
    payload: {
      schemaVersion: 2,
      ...workspaceRoot === undefined ? {} : { workspaceRoot },
      action: normalizedArguments.action,
      trustedUserContext: { messages: userRequests, historyOmitted },
    },
  }
}

const SHELL_EXECUTION_ARGUMENTS = [
  'command',
  'timeoutMs',
  'workdir',
  'run_in_background',
  'sandbox_permissions',
] as const
const SHELL_MODEL_METADATA = new Set(['description', 'justification'])
const WRITE_EXECUTION_ARGUMENTS = ['file_path', 'content', 'sandbox_permissions'] as const
const EDIT_EXECUTION_ARGUMENTS = [
  'file_path',
  'old_string',
  'new_string',
  'replace_all',
  'sandbox_permissions',
] as const
const FILE_MODEL_METADATA = new Set(['justification'])

/** Keep only current shell execution semantics and reject unknown future fields. */
function normalizeToolArguments(
  toolName: string,
  parsedArguments: Record<string, unknown>,
):
  | { readonly kind: 'ready'; readonly action: ReviewAction }
  | {
    readonly kind: 'human'
    readonly reasonCode: 'invalid-tool-arguments' | 'unsupported-tool' | 'unsupported-tool-arguments'
  } {
  if (toolName === 'bash' || toolName === 'pwsh') {
    const knownArguments = new Set<string>([...SHELL_EXECUTION_ARGUMENTS, ...SHELL_MODEL_METADATA])
    if (Object.keys(parsedArguments).some(key => !knownArguments.has(key))) {
      return { kind: 'human', reasonCode: 'unsupported-tool-arguments' }
    }
    if (!validShellExecutionArguments(parsedArguments)) {
      return { kind: 'human', reasonCode: 'invalid-tool-arguments' }
    }
    return {
      kind: 'ready',
      action: {
        kind: 'shell',
        toolName,
        arguments: {
          command: parsedArguments['command'],
          ...typeof parsedArguments['timeoutMs'] === 'number'
            ? { timeoutMs: parsedArguments['timeoutMs'] }
            : {},
          ...typeof parsedArguments['workdir'] === 'string'
            ? { workdir: parsedArguments['workdir'] }
            : {},
          ...typeof parsedArguments['run_in_background'] === 'boolean'
            ? { run_in_background: parsedArguments['run_in_background'] }
            : {},
          ...isSandboxPermission(parsedArguments['sandbox_permissions'])
            ? { sandbox_permissions: parsedArguments['sandbox_permissions'] }
            : {},
        },
      },
    }
  }

  if (toolName === 'write') {
    const knownArguments = new Set<string>([...WRITE_EXECUTION_ARGUMENTS, ...FILE_MODEL_METADATA])
    if (Object.keys(parsedArguments).some(key => !knownArguments.has(key))) {
      return { kind: 'human', reasonCode: 'unsupported-tool-arguments' }
    }
    if (!validWriteExecutionArguments(parsedArguments)) {
      return { kind: 'human', reasonCode: 'invalid-tool-arguments' }
    }
    return {
      kind: 'ready',
      action: {
        kind: 'file-write',
        toolName,
        arguments: {
          file_path: parsedArguments['file_path'],
          content: parsedArguments['content'],
          ...isSandboxPermission(parsedArguments['sandbox_permissions'])
            ? { sandbox_permissions: parsedArguments['sandbox_permissions'] }
            : {},
        },
      },
    }
  }

  if (toolName === 'edit') {
    const knownArguments = new Set<string>([...EDIT_EXECUTION_ARGUMENTS, ...FILE_MODEL_METADATA])
    if (Object.keys(parsedArguments).some(key => !knownArguments.has(key))) {
      return { kind: 'human', reasonCode: 'unsupported-tool-arguments' }
    }
    if (!validEditExecutionArguments(parsedArguments)) {
      return { kind: 'human', reasonCode: 'invalid-tool-arguments' }
    }
    return {
      kind: 'ready',
      action: {
        kind: 'file-edit',
        toolName,
        arguments: {
          file_path: parsedArguments['file_path'],
          old_string: parsedArguments['old_string'],
          new_string: parsedArguments['new_string'],
          ...typeof parsedArguments['replace_all'] === 'boolean'
            ? { replace_all: parsedArguments['replace_all'] }
            : {},
          ...isSandboxPermission(parsedArguments['sandbox_permissions'])
            ? { sandbox_permissions: parsedArguments['sandbox_permissions'] }
            : {},
        },
      },
    }
  }

  return { kind: 'human', reasonCode: 'unsupported-tool' }
}

/** Validate fields that affect what the shell executor will actually do. */
function validShellExecutionArguments(argumentsValue: Record<string, unknown>): argumentsValue is {
  command: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
  sandbox_permissions?: SandboxPermission
} {
  const command = argumentsValue['command']
  const timeoutMs = argumentsValue['timeoutMs']
  const workdir = argumentsValue['workdir']
  const runInBackground = argumentsValue['run_in_background']
  const sandboxPermissions = argumentsValue['sandbox_permissions']
  return typeof command === 'string'
    && command.trim() !== ''
    && (timeoutMs === undefined || (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0))
    && (workdir === undefined || (typeof workdir === 'string' && workdir.trim() !== ''))
    && (runInBackground === undefined || typeof runInBackground === 'boolean')
    && (sandboxPermissions === undefined || isSandboxPermission(sandboxPermissions))
}

/** Validate fields that affect a full-file write. */
function validWriteExecutionArguments(argumentsValue: Record<string, unknown>): argumentsValue is {
  file_path: string
  content: string
  sandbox_permissions?: SandboxPermission
} {
  return typeof argumentsValue['file_path'] === 'string'
    && argumentsValue['file_path'].trim() !== ''
    && typeof argumentsValue['content'] === 'string'
    && (argumentsValue['sandbox_permissions'] === undefined
      || isSandboxPermission(argumentsValue['sandbox_permissions']))
}

/** Validate fields that affect a literal file replacement. */
function validEditExecutionArguments(argumentsValue: Record<string, unknown>): argumentsValue is {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
  sandbox_permissions?: SandboxPermission
} {
  return typeof argumentsValue['file_path'] === 'string'
    && argumentsValue['file_path'].trim() !== ''
    && typeof argumentsValue['old_string'] === 'string'
    && argumentsValue['old_string'] !== ''
    && typeof argumentsValue['new_string'] === 'string'
    && argumentsValue['old_string'] !== argumentsValue['new_string']
    && (argumentsValue['replace_all'] === undefined || typeof argumentsValue['replace_all'] === 'boolean')
    && (argumentsValue['sandbox_permissions'] === undefined
      || isSandboxPermission(argumentsValue['sandbox_permissions']))
}

/** Whether a parsed escalation target belongs to DSH's closed vocabulary. */
function isSandboxPermission(value: unknown): value is SandboxPermission {
  return value === 'workspace-write' || value === 'danger-full-access'
}

/** Locate the current call's turn boundary without accepting messages from an earlier turn. */
function findTurnStart(
  events: ApprovalRequest['agent']['session']['events'],
  callIndex: number,
  turn: number,
): number | undefined {
  for (let index = callIndex - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'turn/start') continue
    return event.data.turn === turn ? index : undefined
  }
  return undefined
}

/** Whether a model-history row is direct human input rather than injected context or a tool result. */
function isDirectUserMessage(message: Message): boolean {
  return message.role === 'user' && message.source.kind === 'user'
}

/** Concatenate visible text blocks from one direct-user message. */
function textOf(message: Message): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/** Whether an unknown JSON value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
