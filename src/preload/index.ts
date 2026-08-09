import { contextBridge, ipcRenderer } from 'electron'
import type { CleanMyWinApi } from '../shared/contracts'

const api: CleanMyWinApi = {
  getDiskOverview: () => ipcRenderer.invoke('system:get-disk-overview')
}

contextBridge.exposeInMainWorld('cleanMyWin', api)
