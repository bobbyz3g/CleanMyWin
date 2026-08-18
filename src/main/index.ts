import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { CleanupRequest, DiskOverview, ScanProgress, ScanResult } from '../shared/contracts'
import { cleanupScannedFiles } from './cleaner'
import { ScanCancelledError, scanCleanableFiles } from './scanner'
import { getInstalledAppIcon, getInstalledApps } from './installedApps'

const isWindows = process.platform === 'win32'
let activeScan: Promise<ScanResult | null> | null = null
let activeScanController: AbortController | null = null
let activeCleanup: Promise<Awaited<ReturnType<typeof cleanupScannedFiles>>> | null = null
let latestScanResult: ScanResult | null = null

const isCleanupRequest = (value: unknown): value is CleanupRequest => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CleanupRequest>
  if (typeof candidate.scanFinishedAt !== 'string') return false
  if (candidate.mode === 'all') return true
  return candidate.mode === 'selected'
    && Array.isArray(candidate.paths)
    && candidate.paths.every((path) => typeof path === 'string' && path.length > 0)
}

const withoutCleanedFiles = (scan: ScanResult, cleanedPaths: string[]): ScanResult => {
  const cleaned = new Set(cleanedPaths.map((path) => path.toLocaleLowerCase()))
  const groups = scan.groups
    .map((group) => {
      const files = group.files.filter((file) => !cleaned.has(file.path.toLocaleLowerCase()))
      return {
        ...group,
        files,
        fileCount: files.length,
        sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0)
      }
    })
    .filter((group) => group.fileCount > 0)

  return {
    ...scan,
    groups,
    fileCount: groups.reduce((total, group) => total + group.fileCount, 0),
    totalBytes: groups.reduce((total, group) => total + group.sizeBytes, 0)
  }
}

async function getDiskOverview(): Promise<DiskOverview> {
  const drive = isWindows ? `${process.env.SystemDrive ?? 'C:'}\\` : '/'
  const stats = await statfs(drive)
  const totalBytes = stats.blocks * stats.bsize
  const freeBytes = stats.bavail * stats.bsize

  return {
    drive,
    totalBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes)
  }
}

function createWindow(): void {
  const icon = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(process.cwd(), 'resources', 'icon.ico')
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f2f5f8',
    icon,
    ...(isWindows ? { backgroundMaterial: 'mica' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())


  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('dev.cleanmywin.app')
  ipcMain.handle('system:get-disk-overview', getDiskOverview)
  ipcMain.handle('apps:list-installed', getInstalledApps)
  ipcMain.handle('apps:get-icon', (_event, appId: unknown) => {
    if (typeof appId !== 'string' || appId.length !== 64) return null
    return getInstalledAppIcon(appId)
  })
  ipcMain.handle('scan:start', (event) => {
    if (activeScan) return activeScan
    if (activeCleanup) throw new Error('清理进行中，请等待清理完成')

    const controller = new AbortController()
    activeScanController = controller
    latestScanResult = null
    const sendProgress = (progress: ScanProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send('scan:progress', progress)
    }
    activeScan = scanCleanableFiles({ signal: controller.signal, onProgress: sendProgress })
      .then((result) => {
        latestScanResult = result
        return result
      })
      .catch((error: unknown) => {
        if (error instanceof ScanCancelledError) return null
        throw error
      })
      .finally(() => {
        if (activeScanController === controller) {
          activeScan = null
          activeScanController = null
        }
      })
    return activeScan
  })
  ipcMain.handle('scan:cancel', () => {
    if (!activeScanController || activeScanController.signal.aborted) return false
    activeScanController.abort()
    return true
  })
  ipcMain.handle('cleanup:start', (event, request: unknown) => {
    if (activeCleanup) return activeCleanup
    if (activeScan) throw new Error('扫描进行中，请等待扫描完成')
    if (!isCleanupRequest(request)) throw new Error('清理请求格式无效')
    if (!latestScanResult) throw new Error('没有可用的扫描结果，请先重新扫描')
    if (request.mode === 'selected' && request.paths.length > latestScanResult.fileCount) {
      throw new Error('选择的文件数量超过本次扫描结果')
    }

    const scan = latestScanResult
    activeCleanup = cleanupScannedFiles(scan, request, {
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('cleanup:progress', progress)
      }
    })
      .then((result) => {
        latestScanResult = withoutCleanedFiles(scan, result.cleanedPaths)
        return result
      })
      .finally(() => {
        activeCleanup = null
      })
    return activeCleanup
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
