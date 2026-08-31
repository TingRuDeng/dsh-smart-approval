#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertFormalArtifactDirectoryEmpty,
  assertFormalArtifactSet,
  assertFormalReleaseContext,
  assertNpmLatestAdvances,
  assertTarballEntries,
  createRuntimeSbomManifest,
  fetchNpmJsonWithRetry,
  RELEASE_REPOSITORY,
  RELEASE_WORKFLOW,
  sha256,
  sha512Integrity,
} from './release-preview-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const formal = args.delete('--formal')
const allowDirty = args.delete('--allow-dirty')
const useExistingDeps = args.delete('--use-existing-deps')
const skipDshSmoke = args.delete('--skip-dsh-smoke')
if (args.size !== 0) throw new Error(`unknown release arguments: ${[...args].join(', ')}`)

const nodeBuiltins = new Set(builtinModules.map(name => name.replace(/^node:/u, '')))

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : ''
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}${detail}`)
  }
  return result.stdout ?? ''
}

async function assertUnpublished(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    cache: 'no-store',
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
  })
  if (response.status !== 404) throw new Error(`${name}@${version} is already published or registry returned ${response.status}`)
}

async function assertRuntimeClosure(libRoot, manifest) {
  const files = run('find', [libRoot, '-type', 'f', '-name', '*.js'], { capture: true })
    .split('\n').filter(Boolean)
  const declaredRuntimePackages = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.peerDependencies ?? {}),
  ])
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)/gu)) {
      const specifier = match[1]
      if (
        specifier.startsWith('.')
        || specifier.startsWith('node:')
        || nodeBuiltins.has(specifier)
        || declaredRuntimePackages.has(specifier)
        || declaredRuntimePackages.has(specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0])
      ) continue
      // The client bundle intentionally retains DSH host imports for the browser loader.
      if (file.endsWith('/client.js')) continue
      throw new Error(`unbundled runtime import in ${file}: ${specifier}`)
    }
  }
}

async function generateSbom(packageRoot, output) {
  const sbomRoot = await mkdtemp(join(tmpdir(), 'dsh-smart-sbom-'))
  try {
    const packedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    await writeFile(
      join(sbomRoot, 'package.json'),
      `${JSON.stringify(createRuntimeSbomManifest(packedManifest), null, 2)}\n`,
      'utf8',
    )
    run('npm', [
      'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund',
      '--omit=dev', '--omit=peer',
    ], { cwd: sbomRoot })
    const sbom = run('npm', [
      'sbom', '--package-lock-only', '--sbom-format', 'cyclonedx', '--sbom-type', 'library',
    ], { cwd: sbomRoot, capture: true })
    JSON.parse(sbom)
    await writeFile(output, sbom, 'utf8')
  } finally {
    await rm(sbomRoot, { recursive: true, force: true })
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const sourceClean = run('git', ['status', '--porcelain'], { capture: true }).trim() === ''
  const gitHead = run('git', ['rev-parse', 'HEAD'], { capture: true }).trim()
  const tag = `v${manifest.version}`
  const gitTagHead = formal ? run('git', ['rev-parse', `refs/tags/${tag}^{commit}`], { capture: true }).trim() : gitHead
  const artifacts = resolve(process.env.DSH_RELEASE_ARTIFACT_DIR ?? join(root, 'artifacts'))
  if (formal) {
    assertFormalReleaseContext({ manifest, gitHead, gitTagHead, sourceClean })
    assertFormalArtifactDirectoryEmpty(await readdir(artifacts).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)))
    await assertUnpublished(manifest.name, manifest.version)
  } else if (!sourceClean && !allowDirty) {
    throw new Error('release source is dirty; commit/stash it or use --allow-dirty for a non-publishable local preview')
  }

  if (!useExistingDeps) run('pnpm', ['install', '--frozen-lockfile'])
  await mkdir(artifacts, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'dsh-smart-release-'))
  try {
    run('pnpm', ['run', 'check'])
    await assertRuntimeClosure(join(root, 'lib'), manifest)

    const packResult = JSON.parse(run('npm', [
      'pack', '--json', '--ignore-scripts', '--pack-destination', artifacts,
    ], { capture: true }))
    if (!Array.isArray(packResult) || packResult.length !== 1) throw new Error('npm pack must produce exactly one tarball')
    const packed = packResult[0]
    const tarball = join(artifacts, packed.filename)
    const entries = run('tar', ['-tzf', tarball], { capture: true }).split('\n').filter(Boolean)
    assertTarballEntries(entries)
    if ((await stat(tarball)).size !== packed.size) throw new Error('tarball size mismatch')

    const unpacked = join(work, 'unpacked')
    await mkdir(unpacked, { recursive: true })
    run('tar', ['-xzf', tarball, '-C', unpacked])
    const packedRoot = join(unpacked, 'package')
    const packedManifest = JSON.parse(await readFile(join(packedRoot, 'package.json'), 'utf8'))
    if (packedManifest.name !== manifest.name || packedManifest.version !== manifest.version) {
      throw new Error('packed package identity mismatch')
    }
    await assertRuntimeClosure(join(packedRoot, 'lib'), packedManifest)

    const installRoot = join(work, 'install')
    await mkdir(installRoot, { recursive: true })
    await writeFile(join(installRoot, 'package.json'), '{"private":true,"type":"module"}\n', 'utf8')
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', tarball], { cwd: installRoot })
    run('node', [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(manifest.name)}); await import(${JSON.stringify(`${manifest.name}/package.json`)}, { with: { type: 'json' } })`,
    ], { cwd: installRoot })
    run('node', ['--check', join(packedRoot, 'lib/client.js')])

    if (!skipDshSmoke && process.env.DSH_RELEASE_HARNESS_ROOT !== undefined) {
      const dshHome = join(work, 'dsh-home')
      const cli = join(process.env.DSH_RELEASE_HARNESS_ROOT, 'apps/cli/src/bin.ts')
      const env = { DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' }
      run('node', ['--import', 'tsx/esm', cli, 'plugin', '--profile', 'web', 'add', tarball], {
        cwd: process.env.DSH_RELEASE_HARNESS_ROOT, env,
      })
      const dump = run('node', ['--import', 'tsx/esm', cli, '--profile', 'web', '--dump-config'], {
        cwd: process.env.DSH_RELEASE_HARNESS_ROOT, env, capture: true,
      })
      if (!dump.includes('id: smart-approval')) throw new Error('clean DSH profile is missing smart-approval')
    }

    const bytes = await readFile(tarball)
    const digest = sha256(bytes)
    const integrity = sha512Integrity(bytes)
    const sbomFilename = packed.filename.replace(/\.tgz$/u, '.cdx.json')
    await generateSbom(packedRoot, join(artifacts, sbomFilename))
    const sbomBytes = await readFile(join(artifacts, sbomFilename))
    const checksumContent = `${digest}  ${packed.filename}\n`
    await writeFile(join(artifacts, 'SHA256SUMS'), checksumContent, 'utf8')
    const descriptor = {
      schemaVersion: 1,
      publishable: formal,
      package: { name: manifest.name, version: manifest.version },
      source: {
        repository: RELEASE_REPOSITORY,
        gitSha: gitHead,
        tag,
        workflow: RELEASE_WORKFLOW,
      },
      artifacts: {
        tarball: {
          filename: packed.filename,
          size: packed.size,
          sha256: digest,
          shasum: packed.shasum,
          integrity,
        },
        checksums: { filename: 'SHA256SUMS', sha256: sha256(checksumContent) },
        sbom: { filename: sbomFilename, sha256: sha256(sbomBytes), format: 'CycloneDX', specVersion: '1.6' },
      },
    }
    await writeFile(join(artifacts, 'release.json'), `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8')
    if (formal) assertFormalArtifactSet(await readdir(artifacts), descriptor)
    if (!allowDirty && run('git', ['status', '--porcelain'], { capture: true }).trim() !== '') {
      throw new Error('release gate changed the clean source tree')
    }
    process.stdout.write(`${JSON.stringify({
      version: manifest.version,
      tarball,
      sbom: join(artifacts, sbomFilename),
      descriptor: join(artifacts, 'release.json'),
      size: packed.size,
      sha256: digest,
      sourceClean,
      dshConfigSmoke: !skipDshSmoke && process.env.DSH_RELEASE_HARNESS_ROOT !== undefined,
      publishable: formal,
    }, null, 2)}\n`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

await main()
