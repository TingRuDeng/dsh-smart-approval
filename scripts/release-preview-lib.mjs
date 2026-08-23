import { createHash } from 'node:crypto'

export const RELEASE_REPOSITORY = 'TingRuDeng/dsh-smart-approval'
export const RELEASE_WORKFLOW = '.github/workflows/release.yml'

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const sha512Integrity = value => `sha512-${createHash('sha512').update(value).digest('base64')}`

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const rcVersion = value => {
  const match = /^(\d+)\.(\d+)\.(\d+)-rc\.(\d+)$/u.exec(value ?? '')
  if (match === null) return undefined
  return match.slice(1).map(Number)
}

export function compareRcVersions(left, right) {
  const a = rcVersion(left)
  const b = rcVersion(right)
  if (a === undefined || b === undefined) throw new Error('only x.y.z-rc.n versions are supported')
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

export function assertNpmLatestAdvances(packageName, candidate, currentLatest) {
  if (currentLatest === undefined || currentLatest === null || currentLatest === '') return
  if (compareRcVersions(candidate, currentLatest) <= 0) {
    throw new Error(`${packageName}@${candidate} is not newer than npm latest ${currentLatest}`)
  }
}

export async function fetchNpmJsonWithRetry({
  url,
  label,
  isReady = () => true,
  attempts = 8,
  delayMs = 3000,
}) {
  let lastStatus = 'no response'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    })
    lastStatus = String(response.status)
    if (response.ok) {
      const metadata = await response.json()
      if (isReady(metadata)) return metadata
    } else if (response.status !== 404) {
      throw new Error(`${label} returned HTTP ${response.status}`)
    }
    if (attempt < attempts) await sleep(delayMs)
  }
  throw new Error(`${label} did not become ready after ${attempts} attempts (last status ${lastStatus})`)
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
