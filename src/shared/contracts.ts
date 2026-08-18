export interface DiskOverview {
  drive: string
  totalBytes: number
  freeBytes: number
  usedBytes: number
}

export type ScanCategoryId =
  | 'user-junk'
  | 'browser-cache'
  | 'application-cache'
  | 'developer-cache'
  | 'gpu-cache'

export interface ScanFileItem {
  path: string
  sizeBytes: number
  modifiedAt: string
  sourceLabel: string
}

export interface ScanGroup {
  id: ScanCategoryId
  label: string
  description: string
  sizeBytes: number
  fileCount: number
  files: ScanFileItem[]
}

export interface ScanResult {
  startedAt: string
  finishedAt: string
  totalBytes: number
  fileCount: number
  groups: ScanGroup[]
  skippedPaths: number
  errorCount: number
}

export interface ScanProgress {
  completedTargets: number
  totalTargets: number
  currentLabel: string
  filesFound: number
  bytesFound: number
}

export type CleanupRequest =
  | { mode: 'all'; scanFinishedAt: string }
  | { mode: 'selected'; scanFinishedAt: string; paths: string[] }

export interface CleanupProgress {
  completedFiles: number
  totalFiles: number
  cleanedFiles: number
  reclaimedBytes: number
}

export interface CleanupResult {
  requestedCount: number
  cleanedCount: number
  reclaimedBytes: number
  skippedCount: number
  failedCount: number
  cleanedPaths: string[]
}

export type InstalledAppSource = 'classic' | 'store'

export interface InstalledApplication {
  id: string
  name: string
  publisher: string | null
  version: string | null
  estimatedSizeBytes: number | null
  installDate: string | null
  source: InstalledAppSource
}

export interface InstalledAppsResult {
  scannedAt: string
  apps: InstalledApplication[]
  errorCount: number
}

export interface CleanMyWinApi {
  getDiskOverview: () => Promise<DiskOverview>
  getInstalledApps: () => Promise<InstalledAppsResult>
  getInstalledAppIcon: (appId: string) => Promise<string | null>
  scanCleanableFiles: () => Promise<ScanResult | null>
  cancelScan: () => Promise<boolean>
  cleanupFiles: (request: CleanupRequest) => Promise<CleanupResult>
  onScanProgress: (listener: (progress: ScanProgress) => void) => () => void
  onCleanupProgress: (listener: (progress: CleanupProgress) => void) => () => void
}
