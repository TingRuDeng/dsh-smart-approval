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

/** The exact action and user-owned context presented to the reviewer model. */
export interface ReviewPayload {
  /** Session workspace recorded when the session was created, when available. */
  readonly workspaceRoot?: string
  /** Tool identity plus parsed arguments from the matching durable `tool/call`. */
  readonly action: {
    readonly toolName: string
    readonly arguments: Record<string, unknown>
  }
  /** Recent direct-user text from the current tool call's turn. */
  readonly userRequests: readonly string[]
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
 * Resolve one request to its durable tool arguments and current-turn direct-user messages.
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
  const directUserMessages = request.agent.session.events
    .slice(turnStartIndex + 1, callIndex)
    .filter(event => event.type === 'user/message')
    .map(event => event.data)
    .filter(isDirectUserMessage)
  if (directUserMessages.length > limits.maxUserMessages) {
    return { kind: 'human', reasonCode: 'too-many-user-messages' }
  }
  if (directUserMessages.some(message => message.content.some(block => block.type !== 'text'))) {
    return { kind: 'human', reasonCode: 'unsupported-user-content' }
  }
  const userRequests = directUserMessages
    .map(textOf)
    .filter(text => text !== '')
  if (userRequests.length === 0) return { kind: 'human', reasonCode: 'missing-user-context' }
  const contextChars = userRequests.reduce((total, text) => total + text.length, 0)
  if (contextChars > limits.maxUserContextChars) {
    return { kind: 'human', reasonCode: 'user-context-too-large' }
  }

  const workspaceRoot = request.agent.session.header.cwd
  return {
    kind: 'ready',
    payload: {
      ...workspaceRoot === undefined ? {} : { workspaceRoot },
      action: { toolName: call.data.name, arguments: normalizedArguments.arguments },
      userRequests,
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

/** Keep only current shell execution semantics and reject unknown future fields. */
function normalizeToolArguments(
  toolName: string,
  parsedArguments: Record<string, unknown>,
):
  | { readonly kind: 'ready'; readonly arguments: Record<string, unknown> }
  | {
    readonly kind: 'human'
    readonly reasonCode: 'invalid-tool-arguments' | 'unsupported-tool' | 'unsupported-tool-arguments'
  } {
  if (toolName !== 'bash' && toolName !== 'pwsh') {
    return { kind: 'human', reasonCode: 'unsupported-tool' }
  }
  const knownArguments = new Set<string>([...SHELL_EXECUTION_ARGUMENTS, ...SHELL_MODEL_METADATA])
  if (Object.keys(parsedArguments).some(key => !knownArguments.has(key))) {
    return { kind: 'human', reasonCode: 'unsupported-tool-arguments' }
  }
  if (!validShellExecutionArguments(parsedArguments)) {
    return { kind: 'human', reasonCode: 'invalid-tool-arguments' }
  }
  const normalized: Record<string, unknown> = {}
  for (const key of SHELL_EXECUTION_ARGUMENTS) {
    if (Object.hasOwn(parsedArguments, key)) normalized[key] = parsedArguments[key]
  }
  return { kind: 'ready', arguments: normalized }
}

/** Validate fields that affect what the shell executor will actually do. */
function validShellExecutionArguments(argumentsValue: Record<string, unknown>): boolean {
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
    && (sandboxPermissions === undefined
      || (typeof sandboxPermissions === 'string' && sandboxPermissions.trim() !== ''))
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
