import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Release scripts are executable .mjs modules without generated declarations.
import * as releasePreview from '../scripts/release-preview-lib.mjs'

describe('release preview version ordering', () => {
  const compareVersions = (releasePreview as typeof releasePreview & {
    compareVersions?: (left: string, right: string) => number
  }).compareVersions
  const assertNpmLatestAdvances = (releasePreview as typeof releasePreview & {
    assertNpmLatestAdvances?: (name: string, candidate: string, latest?: string) => void
  }).assertNpmLatestAdvances

  it('orders RC versions numerically, not lexically', () => {
    expect(compareVersions).toBeTypeOf('function')
    expect(compareVersions?.('0.1.0-rc.10', '0.1.0-rc.9')).toBeGreaterThan(0)
    expect(compareVersions?.('0.1.0-rc.2', '0.1.0-rc.2')).toBe(0)
    expect(compareVersions?.('0.1.0-rc.1', '0.1.0-rc.2')).toBeLessThan(0)
  })

  it('ranks a stable release above every prerelease of the same core', () => {
    // This is the case that used to throw and block all future RCs.
    expect(compareVersions?.('0.1.0', '0.1.0-rc.12')).toBeGreaterThan(0)
    expect(compareVersions?.('0.1.0-rc.12', '0.1.0')).toBeLessThan(0)
    expect(compareVersions?.('0.1.1', '0.1.0')).toBeGreaterThan(0)
  })

  it('refuses a candidate that does not advance beyond npm latest', () => {
    expect(assertNpmLatestAdvances).toBeTypeOf('function')
    // A stable latest makes every RC of that core stale.
    expect(() => assertNpmLatestAdvances?.('pkg', '0.1.0-rc.13', '0.1.0'))
      .toThrow('pkg@0.1.0-rc.13 is not newer than npm latest 0.1.0')
    expect(() => assertNpmLatestAdvances?.('pkg', '0.1.0-rc.13', '0.1.0-rc.13'))
      .toThrow('is not newer than npm latest')
    // Advancing is allowed, including past a stable baseline.
    expect(() => assertNpmLatestAdvances?.('pkg', '0.1.1-rc.1', '0.1.0')).not.toThrow()
    expect(() => assertNpmLatestAdvances?.('pkg', '0.2.0', '0.1.0')).not.toThrow()
    // No published latest yet is not a block.
    expect(() => assertNpmLatestAdvances?.('pkg', '0.1.0-rc.1', undefined)).not.toThrow()
  })

  it('rejects a value that is not SemVer instead of guessing', () => {
    expect(() => compareVersions?.('not-a-version', '0.1.0')).toThrow('only SemVer versions are supported')
  })
})

describe('release preview SBOM descriptor', () => {
  const readSbomSpecVersion = (releasePreview as typeof releasePreview & {
    readSbomSpecVersion?: (bytes: Buffer, filename: string) => string
  }).readSbomSpecVersion

  it('derives the declared CycloneDX version from the artifact, not a literal', () => {
    // The descriptor is attested and shipped, so a hardcoded '1.6' against a
    // 1.5 document would sign a false format claim.
    expect(readSbomSpecVersion).toBeTypeOf('function')
    expect(readSbomSpecVersion?.(Buffer.from(JSON.stringify({ specVersion: '1.5', components: [] })), 'x.cdx.json'))
      .toBe('1.5')
    expect(readSbomSpecVersion?.(Buffer.from(JSON.stringify({ specVersion: '1.6' })), 'x.cdx.json')).toBe('1.6')
  })

  it('rejects a document that declares no spec version', () => {
    expect(() => readSbomSpecVersion?.(Buffer.from('{"components":[]}'), 'x.cdx.json'))
      .toThrow('x.cdx.json does not declare a CycloneDX specVersion')
    expect(() => readSbomSpecVersion?.(Buffer.from('not json'), 'x.cdx.json'))
      .toThrow('x.cdx.json is not valid JSON')
  })
})

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

  /**
   * npm's read path sheds load with 429/503 while a release propagates. Those
   * are the same "not yet" signal as a 404, so treating them as fatal would
   * discard the whole retry budget the caller configured.
   */
  it.each([429, 500, 502, 503, 504])('retries a transient %i until the version is readable', async (status) => {
    const responses = [
      new Response('busy', { status }),
      new Response(JSON.stringify({ name: 'dsh-smart-approval' }), { status: 200 }),
    ]
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return responses.shift()
    })

    await expect(fetchNpmJsonWithRetry?.({
      url: 'https://registry.npmjs.org/dsh-smart-approval/0.1.0-rc.13',
      label: 'npm version verification',
      attempts: 3,
      delayMs: 0,
    })).resolves.toMatchObject({ name: 'dsh-smart-approval' })
    expect(calls).toBe(2)
  })

  it.each([401, 403, 410])('fails immediately on a non-transient %i', async (status) => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return new Response('nope', { status })
    })

    await expect(fetchNpmJsonWithRetry?.({
      url: 'https://registry.npmjs.org/dsh-smart-approval/0.1.0-rc.13',
      label: 'npm version verification',
      attempts: 5,
      delayMs: 0,
    })).rejects.toThrow(`npm version verification returned HTTP ${status}`)
    // A credential or permission fault cannot be fixed by waiting.
    expect(calls).toBe(1)
  })

  it('honours a numeric retry-after instead of the configured pace', async () => {
    const delays: number[] = []
    vi.useFakeTimers()
    try {
      const responses = [
        new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
        new Response(JSON.stringify({ name: 'dsh-smart-approval' }), { status: 200 }),
      ]
      vi.stubGlobal('fetch', async () => responses.shift())
      const settled = fetchNpmJsonWithRetry?.({
        url: 'https://registry.npmjs.org/dsh-smart-approval/0.1.0-rc.13',
        label: 'npm version verification',
        attempts: 2,
        delayMs: 1,
      })
      // The 2000 ms retry-after must elapse before the second attempt runs.
      await vi.advanceTimersByTimeAsync(1999)
      await expect(Promise.race([settled, Promise.resolve('pending')])).resolves.toBe('pending')
      await vi.advanceTimersByTimeAsync(2)
      await expect(settled).resolves.toMatchObject({ name: 'dsh-smart-approval' })
      delays.push(2000)
    } finally {
      vi.useRealTimers()
    }
    expect(delays).toEqual([2000])
  })

  it('names a readable-but-not-ready response instead of claiming a 404', async () => {
    // The version JSON exists, but its provenance attestation has not propagated.
    // Reporting "last status 404" here would misdescribe the failure.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      name: 'dsh-smart-approval',
      dist: { attestations: undefined },
    }), { status: 200 }))

    await expect(fetchNpmJsonWithRetry?.({
      url: 'https://registry.npmjs.org/dsh-smart-approval/0.1.0-rc.13',
      label: 'npm version verification',
      isReady: (metadata: { dist?: { attestations?: unknown } }) => metadata.dist?.attestations !== undefined,
      attempts: 2,
      delayMs: 0,
    })).rejects.toThrow(
      'npm version verification did not become ready after 2 attempts (last status 200 (readable but not ready))',
    )
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

  it('retries a transient 503 while the tarball propagates', async () => {
    const fetchNpmTarballWithRetry = (
      releasePreview as typeof releasePreview & {
        fetchNpmTarballWithRetry?: (options: Record<string, unknown>) => Promise<Buffer>
      }
    ).fetchNpmTarballWithRetry
    const responses = [
      new Response('busy', { status: 503 }),
      new Response(Buffer.from('verified tarball')),
    ]
    let waits = 0

    await expect(fetchNpmTarballWithRetry?.({
      url: 'https://registry.npmjs.org/dsh-smart-approval/-/dsh-smart-approval-0.1.0-rc.13.tgz',
      label: 'npm tarball verification',
      fetchImpl: async () => responses.shift(),
      wait: async () => { waits += 1 },
    })).resolves.toEqual(Buffer.from('verified tarball'))
    expect(waits).toBe(1)
  })

  it('fails immediately when the tarball returns a non-transient 403', async () => {
    const fetchNpmTarballWithRetry = (
      releasePreview as typeof releasePreview & {
        fetchNpmTarballWithRetry?: (options: Record<string, unknown>) => Promise<Buffer>
      }
    ).fetchNpmTarballWithRetry
    let attempts = 0
    let waits = 0

    expect(fetchNpmTarballWithRetry).toBeTypeOf('function')
    await expect(fetchNpmTarballWithRetry?.({
      url: 'https://registry.npmjs.org/dsh-smart-approval/-/dsh-smart-approval-0.1.0-rc.13.tgz',
      label: 'npm tarball verification',
      fetchImpl: async () => { attempts += 1; return new Response('forbidden', { status: 403 }) },
      wait: async () => { waits += 1 },
      attempts: 5,
    })).rejects.toThrow('npm tarball verification returned HTTP 403')
    expect(attempts).toBe(1)
    expect(waits).toBe(0)
  })
})
