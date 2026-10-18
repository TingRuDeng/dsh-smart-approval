import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Release scripts are executable .mjs modules without generated declarations.
import * as releasePreview from '../scripts/release-preview-lib.mjs'

describe('release preview SBOM manifest', () => {
  it('keeps runtime dependencies without local development links or host peers', () => {
    const createRuntimeSbomManifest = (
      releasePreview as typeof releasePreview & {
        createRuntimeSbomManifest?: (manifest: Record<string, unknown>) => unknown
      }
    ).createRuntimeSbomManifest

    expect(createRuntimeSbomManifest?.({
      name: 'dsh-smart-approval',
      version: '0.1.0-rc.10',
      dependencies: { zod: '^4.4.3' },
      optionalDependencies: { optional_runtime: '^1.0.0' },
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.2' },
      devDependencies: { '@deepseek-ai/cordis': 'link:../deepseek-harness/vendor/cordis' },
    })).toEqual({
      private: true,
      name: 'dsh-smart-approval',
      version: '0.1.0-rc.10',
      dependencies: { zod: '^4.4.3' },
      optionalDependencies: { optional_runtime: '^1.0.0' },
    })
  })
})

describe('release preview npm metadata readiness', () => {
  const fetchNpmJsonWithRetry = (
    releasePreview as typeof releasePreview & {
      fetchNpmJsonWithRetry?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>
    }
  ).fetchNpmJsonWithRetry

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries a transient registry 404 until the version is readable', async () => {
    const responses = [
      new Response('not found', { status: 404 }),
      new Response(JSON.stringify({ name: 'dsh-smart-approval' }), { status: 200 }),
    ]
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return responses.shift()
    })

    expect(fetchNpmJsonWithRetry).toBeTypeOf('function')
    await expect(fetchNpmJsonWithRetry?.({
      url: 'https://registry.npmjs.org/dsh-smart-approval/0.1.0-rc.12',
      label: 'npm version verification',
      attempts: 3,
      delayMs: 0,
    })).resolves.toMatchObject({ name: 'dsh-smart-approval' })
    expect(calls).toHaveLength(2)
  })

  it('fails bounded and names the attempt count when the version never appears', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return new Response('not found', { status: 404 })
    })

    await expect(fetchNpmJsonWithRetry?.({
      url: 'https://registry.npmjs.org/dsh-smart-approval/0.1.0-rc.12',
      label: 'npm version verification',
      attempts: 4,
      delayMs: 0,
    })).rejects.toThrow('npm version verification did not become ready after 4 attempts (last status 404)')
    expect(calls).toBe(4)
  })
})

describe('release preview npm tarball verification', () => {
  it('retries a transient registry 404 before returning the tarball bytes', async () => {
    const fetchNpmTarballWithRetry = (
      releasePreview as typeof releasePreview & {
        fetchNpmTarballWithRetry?: (options: Record<string, unknown>) => Promise<Buffer>
      }
    ).fetchNpmTarballWithRetry
    const responses = [
      new Response('not found', { status: 404 }),
      new Response(Buffer.from('verified tarball')),
    ]
    let waits = 0

    expect(fetchNpmTarballWithRetry).toBeTypeOf('function')
    await expect(fetchNpmTarballWithRetry?.({
      url: 'https://registry.npmjs.org/dsh-smart-approval/-/dsh-smart-approval-0.1.0-rc.10.tgz',
      label: 'npm tarball verification',
      fetchImpl: async () => responses.shift(),
      wait: async () => { waits += 1 },
    })).resolves.toEqual(Buffer.from('verified tarball'))
    expect(waits).toBe(1)
  })
})
