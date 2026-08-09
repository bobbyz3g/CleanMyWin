/// <reference types="vite/client" />

import type { CleanMyWinApi } from '../../shared/contracts'

declare global {
  interface Window {
    cleanMyWin: CleanMyWinApi
  }
}

export {}
