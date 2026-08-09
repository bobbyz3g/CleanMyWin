import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ScanCancelledError, scanCleanableFiles, type ScannerEnvironment } from './scanner.ts'

const createEnvironment = (root: string): ScannerEnvironment => ({
  userProfile: join(root, 'user'),
  localAppData: join(root, 'user', 'AppData', 'Local'),
  appData: join(root, 'user', 'AppData', 'Roaming'),
  temp: join(root, 'temp'),
  windows: join(root, 'Windows'),
  programData: join(root, 'ProgramData'),
  programFiles: join(root, 'Program Files'),
  programFilesX86: join(root, 'Program Files (x86)')
})

test('scans allowlisted cache files without touching protected user folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanmywin-scan-'))
  const environment = createEnvironment(root)
  const oldDate = new Date('2025-01-01T00:00:00.000Z')
  const now = new Date('2026-08-09T00:00:00.000Z')

  try {
    await mkdir(environment.temp, { recursive: true })
    await mkdir(join(environment.userProfile, 'Documents'), { recursive: true })
    await mkdir(join(environment.localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'), { recursive: true })
    await writeFile(join(environment.temp, 'old.tmp'), 'temporary')
    await writeFile(join(environment.userProfile, 'Documents', 'keep.log'), 'protected')
    await writeFile(join(environment.localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache', 'entry.bin'), 'cache')

    const { utimes } = await import('node:fs/promises')
    await utimes(join(environment.temp, 'old.tmp'), oldDate, oldDate)

    const result = await scanCleanableFiles({ environment, now })
    const paths = result.groups.flatMap((group) => group.files.map((file) => file.path))

    assert(paths.includes(join(environment.temp, 'old.tmp')))
    assert(paths.includes(join(environment.localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache', 'entry.bin')))
    assert(!paths.includes(join(environment.userProfile, 'Documents', 'keep.log')))
    assert.equal(result.fileCount, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not follow symbolic links out of a cache target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanmywin-link-'))
  const environment = createEnvironment(root)
  const cache = join(environment.localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache')
  const outside = join(root, 'outside')

  try {
    await mkdir(cache, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'private.txt'), 'do not scan')
    await symlink(outside, join(cache, 'linked-outside'), 'junction')

    const result = await scanCleanableFiles({ environment, now: new Date('2026-08-09T00:00:00.000Z') })
    assert.equal(result.fileCount, 0)
    assert(result.skippedPaths > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('stops scanning after the abort signal is triggered', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanmywin-cancel-'))
  const environment = createEnvironment(root)
  const controller = new AbortController()

  try {
    await mkdir(environment.temp, { recursive: true })
    await writeFile(join(environment.temp, 'old.tmp'), 'temporary')

    await assert.rejects(
      scanCleanableFiles({
        environment,
        signal: controller.signal,
        onProgress: () => controller.abort()
      }),
      (error: unknown) => error instanceof ScanCancelledError
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
