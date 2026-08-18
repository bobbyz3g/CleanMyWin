import { lstat, realpath, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  CleanupProgress,
  CleanupRequest,
  CleanupResult,
  ScanFileItem,
  ScanResult
} from '../shared/contracts'

export interface CleanupOptions {
  onProgress?: (progress: CleanupProgress) => void
}

const normalizePath = (path: string): string => {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

const filesFromScan = (scan: ScanResult): ScanFileItem[] => scan.groups.flatMap((group) => group.files)

const isMissingFileError = (error: unknown): boolean => (
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
)

export async function cleanupScannedFiles(
  scan: ScanResult,
  request: CleanupRequest,
  options: CleanupOptions = {}
): Promise<CleanupResult> {
  if (request.scanFinishedAt !== scan.finishedAt) {
    throw new Error('扫描结果已过期，请重新扫描后再清理')
  }

  const scannedFiles = filesFromScan(scan)
  const scannedByPath = new Map(scannedFiles.map((file) => [normalizePath(file.path), file]))
  const candidates = request.mode === 'all'
    ? scannedFiles
    : Array.from(new Set(request.paths.map(normalizePath))).map((path) => {
        const file = scannedByPath.get(path)
        if (!file) throw new Error('清理请求包含不在本次扫描结果中的文件')
        return file
      })

  const cleanedPaths: string[] = []
  let reclaimedBytes = 0
  let skippedCount = 0
  let failedCount = 0

  for (const [index, file] of candidates.entries()) {
    try {
      const stats = await lstat(file.path)
      const expectedModifiedAt = Date.parse(file.modifiedAt)
      const unchanged = stats.size === file.sizeBytes
        && Number.isFinite(expectedModifiedAt)
        && Math.abs(stats.mtimeMs - expectedModifiedAt) < 2

      if (!stats.isFile() || stats.isSymbolicLink() || !unchanged) {
        skippedCount += 1
      } else {
        const actualPath = normalizePath(await realpath(file.path))
        if (actualPath !== normalizePath(file.path)) {
          skippedCount += 1
        } else {
          await unlink(file.path)
          cleanedPaths.push(file.path)
          reclaimedBytes += stats.size
        }
      }
    } catch (error) {
      if (isMissingFileError(error)) skippedCount += 1
      else failedCount += 1
    }

    options.onProgress?.({
      completedFiles: index + 1,
      totalFiles: candidates.length,
      cleanedFiles: cleanedPaths.length,
      reclaimedBytes
    })
  }

  return {
    requestedCount: candidates.length,
    cleanedCount: cleanedPaths.length,
    reclaimedBytes,
    skippedCount,
    failedCount,
    cleanedPaths
  }
}
