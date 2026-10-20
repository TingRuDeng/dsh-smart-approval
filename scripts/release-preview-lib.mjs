import { createHash } from 'node:crypto'

export const RELEASE_REPOSITORY = 'TingRuDeng/dsh-smart-approval'
export const RELEASE_WORKFLOW = '.github/workflows/release.yml'

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const sha512Integrity = value => `sha512-${createHash('sha512').update(value).digest('base64')}`

export function createRuntimeSbomManifest(manifest) {
  const result = {
    private: true,
    name: manifest.name,
    version: manifest.version,
  }
  if (Object.keys(manifest.dependencies ?? {}).length > 0) {
    result.dependencies = { ...manifest.dependencies }
  }
  if (Object.keys(manifest.optionalDependencies ?? {}).length > 0) {
    result.optionalDependencies = { ...manifest.optionalDependencies }
  }
  return result
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Parse a SemVer version into comparable parts.
 *
 * The release gate needs this for more than RC-to-RC ordering: once `latest`
 * points at a stable `0.1.0`, every later `0.1.0-rc.n` is a *prerelease of an
 * already-released version* and must be refused, not silently treated as
 * unparseable. A build suffix is ignored beyond the numeric `rc.N` ordering.
 * @param value - the version string.
 * @returns comparable parts, or undefined when the value is not SemVer.
 */
const parseVersion = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value ?? '')
  if (match === null) return undefined
  const prerelease = match[4] === undefined ? [] : match[4].split('.')
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease,
  }
}

/**
 * Compare two SemVer versions by the SemVer 2.0.0 precedence rules.
 * @returns negative when `left` precedes `right`, positive when it follows,
 *   and 0 when they rank equally.
 * @throws when either value is not SemVer.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) throw new Error('only SemVer versions are supported')
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  }
  // A version without a prerelease outranks any prerelease of the same core.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    // A shorter prerelease set precedes a longer one when all shared parts match.
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumeric = /^\d+$/u.test(leftPart)
    const rightNumeric = /^\d+$/u.test(rightPart)
    if (leftNumeric && rightNumeric) {
      const difference = Number(leftPart) - Number(rightPart)
      if (difference !== 0) return difference
      continue
    }
    // Numeric identifiers always rank below alphanumeric ones.
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  return 0
}

/** Kept for callers that only ever compare RC versions. */
export function compareRcVersions(left, right) {
  return compareVersions(left, right)
}

export function assertNpmLatestAdvances(packageName, candidate, currentLatest) {
  if (currentLatest === undefined || currentLatest === null || currentLatest === '') return
  if (compareVersions(candidate, currentLatest) <= 0) {
    throw new Error(`${packageName}@${candidate} is not newer than npm latest ${currentLatest}`)
  }
}

/**
 * HTTP statuses that mean "the registry has not caught up yet", not "this is
 * wrong". npm's read path answers 404 while a version propagates, and 429/5xx
 * while it is rate limited or shedding load; all three are worth another look
 * inside the same bounded budget.
 */
const TRANSIENT_REGISTRY_STATUSES = new Set([404, 429, 500, 502, 503, 504])

/**
 * Delay before the next attempt: honour a numeric `retry-after` when the
 * registry sends one, otherwise use the caller's pace. The header is capped at
 * the caller's remaining patience so a hostile or misconfigured value cannot
 * stall a release past its budget.
 * @param response - the failed or not-ready response, when there was one.
 * @param fallbackMs - the caller's configured delay.
 * @returns delay in milliseconds.
 */
function retryDelayMs(response, fallbackMs) {
  const header = response?.headers?.get?.('retry-after')
  const seconds = Number.parseInt(header ?? '', 10)
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackMs
  return Math.min(seconds * 1000, Math.max(fallbackMs, 60_000))
}

export async function fetchNpmJsonWithRetry({
  url,
  label,
  isReady = () => true,
  attempts = 8,
  delayMs = 3000,
}) {
  let lastStatus = 'no response'
  let lastDetail = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    })
    lastStatus = String(response.status)
    if (response.ok) {
      const metadata = await response.json()
      if (isReady(metadata)) return metadata
      // A 200 that is not ready is a propagation state (for example a version
      // that exists before its attestation does); naming it keeps the failure
      // message from claiming a 404 when the real gate was something else.
      lastDetail = ' (readable but not ready)'
    } else if (!TRANSIENT_REGISTRY_STATUSES.has(response.status)) {
      throw new Error(`${label} returned HTTP ${response.status}`)
    }
    if (attempt < attempts) await sleep(retryDelayMs(response, delayMs))
  }
  throw new Error(`${label} did not become ready after ${attempts} attempts (last status ${lastStatus}${lastDetail})`)
}

export async function fetchNpmTarballWithRetry({
  url,
  label,
  fetchImpl = globalThis.fetch,
  wait = () => sleep(3000),
  attempts = 8,
}) {
  if (
    typeof url !== 'string'
    || url === ''
    || typeof label !== 'string'
    || label === ''
    || typeof fetchImpl !== 'function'
    || typeof wait !== 'function'
    || !Number.isSafeInteger(attempts)
    || attempts <= 0
  ) {
    throw new Error('npm tarball retry options are invalid')
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      headers: { accept: 'application/octet-stream', 'cache-control': 'no-cache' },
    })
    if (response?.ok === true) return Buffer.from(await response.arrayBuffer())
    // Only genuinely transient statuses are retried; a 403 or 401 here means
    // the credentials or the URL are wrong and another attempt cannot help.
    if (!TRANSIENT_REGISTRY_STATUSES.has(response?.status) || attempt === attempts) {
      throw new Error(`${label} returned HTTP ${String(response?.status)}`)
    }
    await wait(retryDelayMs(response, 3000))
  }

  throw new Error(`${label} retry loop terminated unexpectedly`)
}

/**
 * Read the CycloneDX specification version from the generated document.
 *
 * The release descriptor is attested and shipped alongside the SBOM, so a
 * hardcoded value can assert a format the file does not use. npm's emitter has
 * produced both 1.5 and 1.6 across toolchain versions; deriving the value from
 * the artifact keeps the descriptor honest without pinning the npm version.
 * @param bytes - the generated SBOM document.
 * @param filename - the SBOM filename, for the error message.
 * @returns the declared `specVersion`.
 * @throws when the document is not JSON or does not declare a version.
 */
export function readSbomSpecVersion(bytes, filename) {
  let document
  try {
    document = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${filename} is not valid JSON`)
  }
  const specVersion = document?.specVersion
  if (typeof specVersion !== 'string' || specVersion === '') {
    throw new Error(`${filename} does not declare a CycloneDX specVersion`)
  }
  return specVersion
}

export function assertFormalReleaseContext({
  manifest,
  gitHead,
  gitTagHead,
  sourceClean,
  env = process.env,
}) {
  if (!sourceClean) throw new Error('formal release source must be clean')
  if (gitTagHead !== gitHead) throw new Error('formal tag does not resolve to HEAD')
  if (env.GITHUB_SHA !== undefined && env.GITHUB_SHA !== gitHead) {
    throw new Error('GITHUB_SHA does not match the checked out commit')
  }
  if (env.GITHUB_REF_NAME !== undefined && env.GITHUB_REF_NAME !== `v${manifest.version}`) {
    throw new Error('GITHUB_REF_NAME does not match package version')
  }
  if (env.GITHUB_RUN_ATTEMPT !== undefined && env.GITHUB_RUN_ATTEMPT !== '1') {
    throw new Error('release workflow reruns are not allowed; create a new RC tag')
  }
}

export function assertFormalArtifactDirectoryEmpty(entries) {
  if (entries.length !== 0) throw new Error(`formal artifact directory must start empty: ${entries.join(', ')}`)
}

export function assertFormalArtifactSet(entries, descriptor) {
  const expected = [
    descriptor?.artifacts?.tarball?.filename,
    descriptor?.artifacts?.checksums?.filename,
    descriptor?.artifacts?.sbom?.filename,
    'release.json',
  ]
  if (expected.some(name => typeof name !== 'string' || name === '')) {
    throw new Error('formal descriptor has incomplete artifact names')
  }
  const actual = [...entries].sort()
  const names = [...expected].sort()
  if (actual.length !== names.length || actual.some((name, index) => name !== names[index])) {
    throw new Error(`formal artifact set is not exact: ${actual.join(', ')}`)
  }
}

export function assertTarballEntries(entries) {
  for (const entry of entries) {
    if (
      entry === 'package/package.json'
      || entry === 'package/cordis.patch.yml'
      || entry === 'package/README.md'
      || entry === 'package/README.zh.md'
      || entry === 'package/CHANGELOG.md'
      || entry === 'package/LICENSE'
      || entry.startsWith('package/lib/')
    ) continue
    throw new Error(`unexpected tarball entry: ${entry}`)
  }
}
