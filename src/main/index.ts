import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiskOverview, ScanProgress, ScanResult } from '../shared/contracts'
import { ScanCancelledError, scanCleanableFiles } from './scanner'
import { getInstalledApps } from './installedApps'

const isWindows = process.platform === 'win32'
let activeScan: Promise<ScanResult | null> | null = null
let activeScanController: AbortController | null = null

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
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f2f5f8',
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
  ipcMain.handle('scan:start', (event) => {
    if (activeScan) return activeScan

    const controller = new AbortController()
    activeScanController = controller
    const sendProgress = (progress: ScanProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send('scan:progress', progress)
    }
    activeScan = scanCleanableFiles({ signal: controller.signal, onProgress: sendProgress })
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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
