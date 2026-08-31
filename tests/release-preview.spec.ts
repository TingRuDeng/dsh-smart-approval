import { describe, expect, it } from 'vitest'
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
