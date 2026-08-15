/** Deterministic checks and strict output parsing for approval review. */

import { isAbsolute, resolve } from 'node:path'
import type { FileReviewAction, FileTargetEvidence } from './review-context.ts'

/** Stable reasons an approval model may use when allowing one request. */
export const ALLOW_REASON_CODES = [
  'explicit-user-scope',
  'read-only',
  'bounded-build-test',
  'bounded-project-write',
] as const

/** Stable reasons an approval model may use when handing a request to a human. */
export const HUMAN_REASON_CODES = [
  'uncertain',
  'destructive',
  'credential-risk',
  'system-change',
  'network-or-install',
  'scope-not-authorized',
] as const

/** Stable reasons an approval model may use only for clearly malicious requests. */
export const REJECT_REASON_CODES = [
  'credential-exfiltration',
  'security-bypass',
  'explicit-user-boundary-violation',
  'unauthorized-remote-write',
] as const

/** A reviewer reason attached to an automatic one-shot grant. */
export type AllowReasonCode = typeof ALLOW_REASON_CODES[number]
/** A reviewer reason attached to a human handoff. */
export type HumanReasonCode = typeof HUMAN_REASON_CODES[number]
/** A reviewer reason attached to a direct rejection. */
export type RejectReasonCode = typeof REJECT_REASON_CODES[number]

/** The closed set of decisions the approval model may return. */
export type ReviewerDecision =
  | { readonly decision: 'allow'; readonly reasonCode: AllowReasonCode }
  | { readonly decision: 'human'; readonly reasonCode: HumanReasonCode }
  | { readonly decision: 'reject'; readonly reasonCode: RejectReasonCode }

/** Risk level classified by the reviewer without granting any permission. */
export type ReviewRiskLevel = 'low' | 'medium' | 'high' | 'critical'
/** Strength of direct-user authorization classified for the exact action. */
export type ReviewAuthorization = 'high' | 'medium' | 'low' | 'unknown'
/** Security intent classified by the reviewer. */
export type ReviewIntent = 'benign' | 'uncertain' | 'malicious'

/** Strict model assessment whose reason code must agree with its intent. */
export type ReviewerAssessment =
  | {
    readonly riskLevel: ReviewRiskLevel
    readonly authorization: ReviewAuthorization
    readonly intent: 'benign'
    readonly reasonCode: AllowReasonCode
  }
  | {
    readonly riskLevel: ReviewRiskLevel
    readonly authorization: ReviewAuthorization
    readonly intent: 'uncertain'
    readonly reasonCode: HumanReasonCode
  }
  | {
    readonly riskLevel: ReviewRiskLevel
    readonly authorization: ReviewAuthorization
    readonly intent: 'malicious'
    readonly reasonCode: RejectReasonCode
  }

/** Convert one model classification into the only decision used by approval modes. */
export function decisionFromAssessment(assessment: ReviewerAssessment): ReviewerDecision {
  if (assessment.intent === 'malicious') {
    return { decision: 'reject', reasonCode: assessment.reasonCode }
  }
  if (assessment.intent === 'uncertain') {
    return { decision: 'human', reasonCode: assessment.reasonCode }
  }
  if (assessment.riskLevel !== 'low') return { decision: 'human', reasonCode: 'uncertain' }
  if (assessment.authorization === 'low' || assessment.authorization === 'unknown') {
    return { decision: 'human', reasonCode: 'scope-not-authorized' }
  }
  return { decision: 'allow', reasonCode: assessment.reasonCode }
}

/** Minimal action description consumed by deterministic preflight checks. */
export interface ApprovalAction {
  /** Closed normalized action kind, when the caller has one. */
  readonly kind?: 'shell' | 'file-write' | 'file-edit'
  /** DSH tool name attached to the approval request. */
  readonly toolName: string
  /** Parsed `tool/call` arguments. */
  readonly arguments: unknown
}

const allowReasons = new Set<string>(ALLOW_REASON_CODES)
const humanReasons = new Set<string>(HUMAN_REASON_CODES)
const rejectReasons = new Set<string>(REJECT_REASON_CODES)

/** Maximum complete JSON response accepted from the approval reviewer. */
export const REVIEWER_OUTPUT_MAX_CHARS = 512

/**
 * Parse the model's complete response without accepting prose, fences, extra
 * fields, or a reason that does not belong to the selected decision.
 * @param output - complete visible text produced by the reviewer model.
 * @returns the closed decision, or `null` when the response is not exact.
 */
export function parseReviewerOutput(output: string): ReviewerAssessment | null {
  if (output.length > REVIEWER_OUTPUT_MAX_CHARS) return null
  const trimmed = output.trim()
  const match = trimmed.match(/^\{\s*"riskLevel"\s*:\s*"(low|medium|high|critical)"\s*,\s*"authorization"\s*:\s*"(high|medium|low|unknown)"\s*,\s*"intent"\s*:\s*"(benign|uncertain|malicious)"\s*,\s*"reasonCode"\s*:\s*"([a-z-]+)"\s*\}$/)
  const riskLevel = match?.[1] as ReviewRiskLevel | undefined
  const authorization = match?.[2] as ReviewAuthorization | undefined
  const intent = match?.[3] as ReviewIntent | undefined
  const reasonCode = match?.[4]
  if (riskLevel === undefined || authorization === undefined || intent === undefined || reasonCode === undefined) {
    return null
  }
  if (intent === 'benign' && allowReasons.has(reasonCode)) {
    return { riskLevel, authorization, intent, reasonCode: reasonCode as AllowReasonCode }
  }
  if (intent === 'uncertain' && humanReasons.has(reasonCode)) {
    return { riskLevel, authorization, intent, reasonCode: reasonCode as HumanReasonCode }
  }
  if (intent === 'malicious' && rejectReasons.has(reasonCode)) {
    return { riskLevel, authorization, intent, reasonCode: reasonCode as RejectReasonCode }
  }
  return null
}

const SENSITIVE_KEY = /(?:^|[_-])(?:api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?key|client[_-]?secret|(?:access|refresh|auth|session|id)[_-]?token|credentials?|token|secret|password|passwd|authorization|cookie)(?:$|[_-])/i
const SENSITIVE_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|github_pat|xox[baprs]|AKIA)[-_A-Za-z0-9]{8,}\b|authorization\s*:\s*(?:bearer|basic)\s+\S+|(?:^|[\s/\\])(?:\.ssh|\.aws|\.gnupg|\.env)(?:[\s/\\]|$)|\b(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|CLIENT_SECRET)\b)/i
const SENSITIVE_PATH = /(?:^|[\s'"=:/\\])(?:\.env(?:\.[A-Za-z0-9_-]+)*|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.docker[/\\]config\.json|\.(?:ssh|aws|gnupg)(?:[/\\]|$))(?=$|[\s'"/\\])/i
const DESTRUCTIVE_SHELL = /(?:^|[;&|]\s*|\s)(?:(?:[A-Za-z]:)?(?:[/\\][^\s;&|/\\]+)+[/\\])?(?:rm(?:\s|$)|rmdir(?:\s|$)|shred(?:\s|$)|mkfs(?:\.|\s)|Remove-Item(?:\s|$)|Clear-Content(?:\s|$)|Format-Volume(?:\s|$)|git(?:\s+(?:-C|--git-dir|--work-tree)(?:=|\s+)\S+)*\s+(?:reset(?:\s|$)|clean(?:\s|$)|restore(?:\s|$)|checkout\s+--|branch\s+-[dD](?:\s|$)|stash\s+(?:drop|clear)(?:\s|$))|truncate(?:\s|$))/i
const FIND_DELETE_SHELL = /(?:^|[;&|]\s*|\s)(?:(?:[A-Za-z]:)?(?:[/\\][^\s;&|/\\]+)+[/\\])?find(?:\s|$)[^\n;&|]*\s-delete(?:\s|$)/i
const SYSTEM_SHELL = /(?:^|[;&|]\s*|\s)(?:(?:[A-Za-z]:)?(?:[/\\][^\s;&|/\\]+)+[/\\])?(?:sudo(?:\s|$)|doas(?:\s|$)|launchctl(?:\s|$)|systemctl(?:\s|$)|crontab(?:\s|$)|dscl(?:\s|$)|chmod(?:\s|$)|chown(?:\s|$)|chgrp(?:\s|$)|kill(?:\s|$)|pkill(?:\s|$)|killall(?:\s|$)|mount(?:\s|$)|umount(?:\s|$)|shutdown(?:\s|$)|reboot(?:\s|$)|halt(?:\s|$)|diskutil(?:\s|$)|defaults\s+write(?:\s|$)|reg\s+(?:add|delete)(?:\s|$))/i
const HOST_CONTAINER_SHELL = /(?:^|[;&|]\s*|\s)(?:(?:[A-Za-z]:)?(?:[/\\][^\s;&|/\\]+)+[/\\])?(?:docker|podman)\s+run\b[^\n]*(?:--privileged(?:=true)?\b|--pid(?:=|\s+)host\b|--network(?:=|\s+)host\b|--device(?:=|\s+)|(?:-v|--volume)(?:=|\s+)\/:|docker\.sock)/i
const INSTALL_SHELL = /(?:\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|ci|i)\b|\b(?:npx|bunx)\b|\b(?:pnpm|yarn)\s+dlx\b|\bpipx\s+(?:install|run)\b|\bpip3?\s+install\b|\buv\s+(?:add|sync|tool\s+install|pip\s+install)\b|\b(?:brew|apt-get|apt|dnf|yum)\s+install\b|\bcargo\s+install\b|\bgo\s+install\b)/i
const NETWORK_TRANSFER_SHELL = /(?:\bcurl\b[^\n]*(?:--data(?:-binary)?|-d\b|--form|-F\b|--upload-file|-T\b|--request\s+(?:POST|PUT|PATCH|DELETE)|-X\s*(?:POST|PUT|PATCH|DELETE)|\|\s*(?:sh|bash|zsh|ksh)\b)|\bwget\b[^\n]*(?:--post-data|--post-file|\|\s*(?:sh|bash|zsh|ksh)\b)|(?:^|[;&|]\s*|\s)(?:(?:[A-Za-z]:)?(?:[/\\][^\s;&|/\\]+)+[/\\])?(?:ssh|scp|sftp)(?:\s|$)|\brsync\b[^\n]*\w+@)/i
const REMOTE_WRITE_SHELL = /(?:\bgit\s+push\b|\b(?:npm|pnpm)\s+publish\b|\bgh\s+(?:pr\s+(?:create|merge|close|reopen|review)|issue\s+(?:create|close|reopen|edit|delete)|release\s+(?:create|delete|edit|upload)|workflow\s+run|repo\s+(?:create|delete|archive|edit|fork|rename)|api\b[^\n]*(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE))\b)/i
const OPAQUE_SHELL = /(?:\bpython(?:3(?:\.\d+)?)?\b[^\n;&|]*\s-c(?:\s|$)|\bnode\b[^\n;&|]*\s-e(?:\s|$)|\b(?:ruby|perl)\b[^\n;&|]*\s-e(?:\s|$)|(?:^|[;&|]\s*|\s)(?:sh|bash|zsh|ksh)\s+-c(?:\s|$)|(?:^|[;&|]\s*|\s)eval(?:\s|$))/i

/**
 * Stop obvious high-risk requests before any action data is sent to a model.
 * A `null` result means only that model review may proceed; it is never a grant.
 * @param action - parsed tool action being considered.
 * @param userRequests - bounded recent direct-user text that would reach the reviewer.
 * @param workspaceRoot - session workspace used to resolve relative shell workdirs.
 * @returns a non-safe classification for mode-specific handling, or `null` for model review.
 */
export function preflightApproval(
  action: ApprovalAction,
  userRequests: readonly string[] = [],
  workspaceRoot?: string,
): ReviewerDecision | null {
  if (containsSensitiveMaterial(action.arguments)
    || containsSensitiveMaterial(userRequests)
    || containsSensitiveMaterial(workspaceRoot)) {
    return { decision: 'human', reasonCode: 'credential-risk' }
  }
  if (/^(?:delete|remove|unlink|rmdir)$/i.test(action.toolName)) {
    return { decision: 'human', reasonCode: 'destructive' }
  }
  if (action.toolName === 'write' || action.toolName === 'edit') return null
  if (action.toolName !== 'bash' && action.toolName !== 'pwsh') {
    return { decision: 'human', reasonCode: 'uncertain' }
  }
  const command = commandOf(action.arguments)
  if (command === undefined) return { decision: 'human', reasonCode: 'uncertain' }
  if (DESTRUCTIVE_SHELL.test(command) || FIND_DELETE_SHELL.test(command)) {
    return { decision: 'human', reasonCode: 'destructive' }
  }
  if (SYSTEM_SHELL.test(command) || HOST_CONTAINER_SHELL.test(command)) {
    return { decision: 'human', reasonCode: 'system-change' }
  }
  if (INSTALL_SHELL.test(command) || NETWORK_TRANSFER_SHELL.test(command) || REMOTE_WRITE_SHELL.test(command)) {
    return { decision: 'human', reasonCode: 'network-or-install' }
  }
  if (OPAQUE_SHELL.test(command)) return { decision: 'human', reasonCode: 'uncertain' }
  if (runsInBackground(action.arguments)) return { decision: 'human', reasonCode: 'uncertain' }
  const effectiveWorkdir = resolveWorkdir(action.arguments, workspaceRoot)
  if (effectiveWorkdir === undefined) return { decision: 'human', reasonCode: 'uncertain' }
  if (containsSensitiveMaterial(effectiveWorkdir)) {
    return { decision: 'human', reasonCode: 'credential-risk' }
  }
  return null
}

/**
 * Apply deterministic safety checks to read-only evidence for one file mutation.
 * A null result permits model review but never grants the action.
 */
export function preflightFileTarget(
  action: FileReviewAction,
  evidence: FileTargetEvidence,
): ReviewerDecision | null {
  if (containsSensitiveMaterial(evidence.resolvedPath)) {
    return { decision: 'human', reasonCode: 'credential-risk' }
  }
  if (evidence.systemLocation) return { decision: 'human', reasonCode: 'system-change' }
  if (evidence.pathEntryType === 'symlink') return { decision: 'human', reasonCode: 'uncertain' }
  const missingTarget = evidence.pathEntryType === 'missing' && evidence.targetType === 'missing'
  const regularTarget = evidence.pathEntryType === 'file' && evidence.targetType === 'file'
  if (!missingTarget && !regularTarget) return { decision: 'human', reasonCode: 'uncertain' }
  if (action.kind === 'file-edit' && !regularTarget) {
    return { decision: 'human', reasonCode: 'uncertain' }
  }
  return null
}

/** Return true when nested JSON-like data appears to contain credentials or credential-store paths. */
function containsSensitiveMaterial(value: unknown): boolean {
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string') {
      if (SENSITIVE_VALUE.test(current) || SENSITIVE_PATH.test(current)) return true
      continue
    }
    if (current === null || typeof current !== 'object') continue
    if (seen.has(current)) return true
    seen.add(current)
    if (Array.isArray(current)) {
      for (const nested of current) pending.push(nested)
      continue
    }
    for (const [key, nested] of Object.entries(current)) {
      if (SENSITIVE_KEY.test(key)) return true
      pending.push(nested)
    }
  }
  return false
}

/** Extract the command from one shell tool's parsed arguments. */
function commandOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const command = value['command']
  return typeof command === 'string' && command.trim() !== '' ? command : undefined
}

/** Background work outlives the one-call review boundary and requires a human. */
function runsInBackground(value: unknown): boolean {
  return isRecord(value) && value['run_in_background'] === true
}

/** Resolve the directory in which one shell command will execute. */
function resolveWorkdir(value: unknown, workspaceRoot?: string): string | undefined {
  if (!isRecord(value)) return undefined
  const rawWorkdir = value['workdir']
  if (rawWorkdir !== undefined && (typeof rawWorkdir !== 'string' || rawWorkdir.trim() === '')) {
    return undefined
  }
  const root = workspaceRoot?.trim() === '' ? undefined : workspaceRoot
  if (root !== undefined && !isAbsolute(root)) return undefined
  if (rawWorkdir === undefined) return root === undefined ? undefined : resolve(root)
  if (isAbsolute(rawWorkdir)) return resolve(rawWorkdir)
  return root === undefined ? undefined : resolve(root, rawWorkdir)
}

/** Whether an unknown JSON value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
