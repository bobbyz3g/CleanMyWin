export interface DiskOverview {
  drive: string
  totalBytes: number
  freeBytes: number
  usedBytes: number
}

export interface CleanMyWinApi {
  getDiskOverview: () => Promise<DiskOverview>
}
