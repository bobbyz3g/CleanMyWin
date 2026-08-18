import assert from 'node:assert/strict'
import { lstat, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { CleanupRequest, ScanFileItem, ScanResult } from '../shared/contracts.ts'
import { cleanupScannedFiles } from './cleaner.ts'

const createScan = (file: ScanFileItem): ScanResult => ({
  startedAt: '2026-08-18T01:00:00.000Z',
  finishedAt: '2026-08-18T01:00:01.000Z',
  totalBytes: file.sizeBytes,
  fileCount: 1,
  groups: [{
    id: 'user-junk',
    label: '测试缓存',
    description: '测试扫描结果',
    sizeBytes: file.sizeBytes,
    fileCount: 1,
    files: [file]
  }],
  skippedPaths: 0,
  errorCount: 0
})

const selectedRequest = (scan: ScanResult, path: string): CleanupRequest => ({
  mode: 'selected',
  scanFinishedAt: scan.finishedAt,
  paths: [path]
})

test('deletes only a file that still matches the latest scan result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanmywin-clean-'))
  const path = join(root, 'cache.bin')

  try {
    await writeFile(path, 'cache data')
    const stats = await lstat(path)
    const scan = createScan({
      path,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      sourceLabel: '测试缓存'
    })

    const result = await cleanupScannedFiles(scan, selectedRequest(scan, path))

    assert.equal(result.cleanedCount, 1)
    assert.equal(result.reclaimedBytes, stats.size)
    await assert.rejects(lstat(path), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('skips a file that changed after scanning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanmywin-clean-changed-'))
  const path = join(root, 'cache.bin')

  try {
    await writeFile(path, 'before')
    const stats = await lstat(path)
    const scan = createScan({
      path,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      sourceLabel: '测试缓存'
    })
    await writeFile(path, 'changed after scan')

    const result = await cleanupScannedFiles(scan, selectedRequest(scan, path))

    assert.equal(result.cleanedCount, 0)
    assert.equal(result.skippedCount, 1)
    assert.equal((await lstat(path)).isFile(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects paths that were not returned by the latest scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanmywin-clean-invalid-'))
  const scannedPath = join(root, 'cache.bin')
  const outsidePath = join(root, 'outside.bin')

  try {
    await mkdir(root, { recursive: true })
    await writeFile(scannedPath, 'cache')
    await writeFile(outsidePath, 'keep')
    const stats = await lstat(scannedPath)
    const scan = createScan({
      path: scannedPath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      sourceLabel: '测试缓存'
    })

    await assert.rejects(
      cleanupScannedFiles(scan, selectedRequest(scan, outsidePath)),
      /不在本次扫描结果/
    )
    assert.equal((await lstat(outsidePath)).isFile(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
