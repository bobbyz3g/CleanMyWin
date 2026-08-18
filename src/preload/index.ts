import { contextBridge, ipcRenderer } from 'electron'
import type { CleanMyWinApi } from '../shared/contracts'

const api: CleanMyWinApi = {
  getDiskOverview: () => ipcRenderer.invoke('system:get-disk-overview'),
  getInstalledApps: () => ipcRenderer.invoke('apps:list-installed'),
  getInstalledAppIcon: (appId) => ipcRenderer.invoke('apps:get-icon', appId),
  scanCleanableFiles: () => ipcRenderer.invoke('scan:start'),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  cleanupFiles: (request) => ipcRenderer.invoke('cleanup:start', request),
  onScanProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]): void => listener(progress)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
  onCleanupProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]): void => listener(progress)
    ipcRenderer.on('cleanup:progress', handler)
    return () => ipcRenderer.removeListener('cleanup:progress', handler)
  }
}

contextBridge.exposeInMainWorld('cleanMyWin', api)
