/** Read-only filesystem evidence for one normalized file mutation. */

import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import type {
  FileReviewAction,
  FileTargetInspectionResult,
} from './review-context.ts'

/** Minimal target identity used by a DSH filesystem implementation. */
export interface FileProbeTarget {
  readonly displayPath: string
}

/** Minimal metadata surface required for approval target inspection. */
export interface FileProbeInfo {
  readonly type: 'file' | 'directory' | 'other'
  readonly size?: number
}

/** Minimal path metadata surface required to detect a final symlink. */
export interface FileProbePathInfo {
  readonly type: 'file' | 'directory' | 'symlink' | 'other'
  readonly size?: number
}

/** Structural subset of the DSH filesystem service used by this plugin. */
export interface FileTargetFileSystem<TTarget extends FileProbeTarget> {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<TTarget>
  processPath(target: TTarget): string
  contains(parent: TTarget, child: TTarget): boolean
  stat(target: TTarget, signal?: AbortSignal): Promise<FileProbeInfo | undefined>
  lstat(
    path: string,
    options?: { cwd?: string },
    signal?: AbortSignal,
  ): Promise<FileProbePathInfo | undefined>
}

/** Inspect one exact normalized file action without reading file content. */
export type FileTargetInspector = (
  action: FileReviewAction,
  workspaceRoot: string | undefined,
  request: ApprovalRequest,
) => Promise<FileTargetInspectionResult>

/**
 * Create a target inspector over the mounted DSH filesystem service.
 * @param fs - mounted filesystem capability.
 * @returns a fail-closed read-only target inspector.
 */
export function createFileTargetInspector<TTarget extends FileProbeTarget>(
  fs: FileTargetFileSystem<TTarget>,
): FileTargetInspector {
  return async (action, workspaceRoot, request) => {
    if (workspaceRoot === undefined || workspaceRoot.trim() === '' || !isAbsolute(workspaceRoot)) {
      return { kind: 'human', reasonCode: 'file-target-unavailable' }
    }
    const filePath = action.arguments.file_path
    const signal = request.signal
    const pathInfo = await fs.lstat(filePath, { cwd: workspaceRoot }, signal)
    if (pathInfo?.type === 'symlink') {
      return { kind: 'human', reasonCode: 'file-target-symlink' }
    }

    const resolveOptions = { cwd: workspaceRoot, ...signal === undefined ? {} : { signal } }
    const workspaceTarget = await fs.resolve(workspaceRoot, resolveOptions)
    const target = await fs.resolve(filePath, resolveOptions)
    const processPath = fs.processPath(target)
    if (processPath.trim() === '' || !isAbsolute(processPath)) {
      return { kind: 'human', reasonCode: 'file-target-invalid' }
    }
    const lexicalPath = resolvePath(workspaceRoot, filePath)
    if (comparablePath(lexicalPath) !== comparablePath(processPath)) {
      return { kind: 'human', reasonCode: 'file-target-aliased' }
    }
    const targetInfo = await fs.stat(target, signal)
    if (!validPathInfo(pathInfo) || !validTargetInfo(targetInfo) || target.displayPath.trim() === '') {
      return { kind: 'human', reasonCode: 'file-target-invalid' }
    }
    return {
      kind: 'ready',
      evidence: {
        resolvedPath: target.displayPath,
        workspaceRelation: fs.contains(workspaceTarget, target) ? 'inside' : 'outside',
        pathEntryType: pathInfo?.type ?? 'missing',
        targetType: targetInfo?.type ?? 'missing',
        ...targetInfo?.type === 'file' && targetInfo.size !== undefined
          ? { size: targetInfo.size }
          : {},
        systemLocation: isProtectedSystemPath(processPath),
      },
    }
  }
}

/** Reject malformed metadata returned by a filesystem provider. */
function validPathInfo(info: FileProbePathInfo | undefined): boolean {
  return info === undefined || validOptionalSize(info.size)
}

/** Reject malformed metadata returned by a filesystem provider. */
function validTargetInfo(info: FileProbeInfo | undefined): boolean {
  return info === undefined || validOptionalSize(info.size)
}

/** DSH file sizes, when present, are finite non-negative integers. */
function validOptionalSize(size: number | undefined): boolean {
  return size === undefined || (Number.isSafeInteger(size) && size >= 0)
}

/** Whether a canonical process path belongs to a protected OS-managed location. */
export function isProtectedSystemPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase()
  if (normalized === '') return false
  const protectedRoots = [
    '/applications',
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/library',
    '/lib',
    '/lib64',
    '/opt',
    '/private/etc',
    '/private/var',
    '/proc',
    '/root',
    '/run',
    '/sbin',
    '/srv',
    '/system',
    '/usr',
    '/var',
  ]
  if (protectedRoots.some(root => normalized === root || normalized.startsWith(`${root}/`))) return true
  if (/^[a-z]:\/(?:program files(?: \(x86\))?|programdata|windows)(?:\/|$)/.test(normalized)) return true
  return /^\/(?:users|home)\/[^/]+\/\.(?:bash_profile|bashrc|profile|zprofile|zshenv|zshrc)$/.test(normalized)
    || /^\/(?:users|home)\/[^/]+\/\.config\/(?:autostart(?:\/|$)|fish\/config\.fish$)/.test(normalized)
    || /^\/users\/[^/]+\/library\/(?:launchagents|launchdaemons)(?:\/|$)/.test(normalized)
    || /^\/home\/[^/]+\/\.config\/systemd(?:\/|$)/.test(normalized)
}

/** Normalize absolute execution paths for conservative alias comparison. */
function comparablePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}
