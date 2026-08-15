import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import {
  createFileTargetInspector,
  isProtectedSystemPath,
  type FileProbeInfo,
  type FileProbePathInfo,
  type FileProbeTarget,
  type FileTargetFileSystem,
} from '../src/file-target-inspector.ts'
import type { FileReviewAction } from '../src/review-context.ts'

interface Target extends FileProbeTarget {
  readonly key: string
  readonly processPath: string
}

function writeAction(filePath = '../other/report.md'): FileReviewAction {
  return {
    kind: 'file-write',
    toolName: 'write',
    arguments: {
      file_path: filePath,
      content: '# Report\n',
      sandbox_permissions: 'danger-full-access',
    },
  }
}

function setup(options: {
  pathInfo?: FileProbePathInfo
  targetInfo?: FileProbeInfo
  inside?: boolean
  processPath?: string
} = {}) {
  const workspace: Target = {
    key: 'workspace',
    displayPath: '/work/main',
    processPath: '/work/main',
  }
  const target: Target = {
    key: 'target',
    displayPath: options.processPath ?? '/work/other/report.md',
    processPath: options.processPath ?? '/work/other/report.md',
  }
  const fs: FileTargetFileSystem<Target> = {
    resolve: vi.fn(async (path: string) => path === '/work/main' ? workspace : target),
    processPath: vi.fn(value => value.processPath),
    contains: vi.fn(() => options.inside ?? false),
    stat: vi.fn(async () => options.targetInfo),
    lstat: vi.fn(async () => options.pathInfo),
  }
  return { fs, inspect: createFileTargetInspector(fs) }
}

const request = { signal: undefined } as unknown as ApprovalRequest

describe('createFileTargetInspector', () => {
  it('reports a missing cross-workspace target without reading its content', async () => {
    const { fs, inspect } = setup()

    await expect(inspect(writeAction(), '/work/main', request)).resolves.toEqual({
      kind: 'ready',
      evidence: {
        resolvedPath: '/work/other/report.md',
        workspaceRelation: 'outside',
        pathEntryType: 'missing',
        targetType: 'missing',
        systemLocation: false,
      },
    })
    expect(fs.resolve).toHaveBeenNthCalledWith(1, '/work/main', {
      cwd: '/work/main',
    })
    expect(fs.resolve).toHaveBeenNthCalledWith(2, '../other/report.md', {
      cwd: '/work/main',
    })
    expect(fs.lstat).toHaveBeenCalledWith('../other/report.md', { cwd: '/work/main' }, undefined)
  })

  it('reports existing regular-file metadata inside the workspace', async () => {
    const { inspect } = setup({
      inside: true,
      pathInfo: { type: 'file', size: 42 },
      targetInfo: { type: 'file', size: 42 },
      processPath: '/work/main/report.md',
    })

    await expect(inspect(writeAction('report.md'), '/work/main', request)).resolves.toEqual({
      kind: 'ready',
      evidence: {
        resolvedPath: '/work/main/report.md',
        workspaceRelation: 'inside',
        pathEntryType: 'file',
        targetType: 'file',
        size: 42,
        systemLocation: false,
      },
    })
  })

  it('fails closed before model review for a final symbolic link', async () => {
    const { fs, inspect } = setup({
      pathInfo: { type: 'symlink' },
      targetInfo: { type: 'file', size: 42 },
    })

    await expect(inspect(writeAction(), '/work/main', request)).resolves.toEqual({
      kind: 'human',
      reasonCode: 'file-target-symlink',
    })
    expect(fs.stat).not.toHaveBeenCalled()
  })

  it('fails closed when an intermediate filesystem alias changes the canonical target', async () => {
    const { fs, inspect } = setup({
      inside: false,
      pathInfo: { type: 'file', size: 42 },
      targetInfo: { type: 'file', size: 42 },
      processPath: '/work/outside/report.md',
    })

    await expect(inspect(writeAction('/work/main/link/report.md'), '/work/main', request)).resolves.toEqual({
      kind: 'human',
      reasonCode: 'file-target-aliased',
    })
    expect(fs.stat).not.toHaveBeenCalled()
  })

  it('marks protected system locations for deterministic rejection before model review', async () => {
    const { inspect } = setup({
      pathInfo: { type: 'file', size: 12 },
      targetInfo: { type: 'file', size: 12 },
      processPath: '/etc/hosts',
    })

    await expect(inspect(writeAction('/etc/hosts'), '/work/main', request)).resolves.toMatchObject({
      kind: 'ready',
      evidence: { systemLocation: true },
    })
  })

  it('fails closed when the session workspace is unavailable', async () => {
    const { fs, inspect } = setup()

    await expect(inspect(writeAction(), undefined, request)).resolves.toEqual({
      kind: 'human',
      reasonCode: 'file-target-unavailable',
    })
    expect(fs.resolve).not.toHaveBeenCalled()
  })
})

describe('isProtectedSystemPath', () => {
  it.each([
    '/opt/service/config.json',
    '/Users/example/.zshrc',
    '/home/example/.config/systemd/user/example.service',
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
  ])('recognizes an OS or startup configuration path: %s', (path) => {
    expect(isProtectedSystemPath(path)).toBe(true)
  })

  it.each(['/work/other/report.md', '/tmp/report.md'])('does not classify an ordinary work path as system-managed: %s', (path) => {
    expect(isProtectedSystemPath(path)).toBe(false)
  })
})
