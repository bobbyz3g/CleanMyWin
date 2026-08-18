import {
  AppWindow,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Code2,
  Cpu,
  FileClock,
  Gauge,
  Globe2,
  HardDrive,
  Info,
  LoaderCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CleanupProgress,
  CleanupResult,
  DiskOverview,
  ScanCategoryId,
  ScanProgress,
  ScanResult
} from '../../shared/contracts'
import InstalledAppsView from './InstalledAppsView'
import styles from './App.module.css'

type ScanState = 'idle' | 'scanning' | 'stopping' | 'complete' | 'error'
type ViewId = 'scan' | 'apps'
type CleanupMode = 'all' | 'selected'

interface PendingCleanup {
  mode: CleanupMode
  count: number
  bytes: number
  paths: string[]
}

const navItems = [
  { id: 'scan' as const, label: '磁盘清理', icon: HardDrive },
  { id: 'apps' as const, label: '应用卸载', icon: AppWindow }
]

const categoryIcons: Record<ScanCategoryId, typeof FileClock> = {
  'user-junk': FileClock,
  'browser-cache': Globe2,
  'application-cache': AppWindow,
  'developer-cache': Code2,
  'gpu-cache': Cpu
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unit
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`
}

const removeCleanedFiles = (scan: ScanResult, cleanedPaths: string[]): ScanResult => {
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

function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  disabled = false,
  onChange
}: {
  checked: boolean
  indeterminate?: boolean
  label: string
  disabled?: boolean
  onChange: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label className={styles.selectionControl} aria-label={label}>
      <input ref={inputRef} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span className={styles.checkboxVisual} aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
    </label>
  )
}

function CleanupConfirmDialog({
  request,
  onCancel,
  onConfirm
}: {
  request: PendingCleanup
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  return (
    <dialog className={styles.confirmDialog} ref={dialogRef} onCancel={(event) => { event.preventDefault(); onCancel() }}>
      <div className={styles.dialogHeading}>
        <span className={styles.dialogIcon}><Trash2 size={21} aria-hidden="true" /></span>
        <div><p>确认清理</p><h2>{request.mode === 'all' ? '清理全部扫描结果' : '清理已选文件'}</h2></div>
        <button className={styles.dialogClose} type="button" onClick={onCancel} aria-label="关闭确认窗口"><X size={18} /></button>
      </div>
      <p className={styles.dialogMessage}>
        将永久删除 <strong>{request.count} 个</strong>已扫描的缓存和临时文件，预计释放 <strong>{formatBytes(request.bytes)}</strong>。
        文件如果在扫描后发生变化，将自动跳过。
      </p>
      <div className={styles.dialogSafety}><ShieldCheck size={17} aria-hidden="true" />不会处理桌面、文档、下载内容，也不会递归删除目录。</div>
      <div className={styles.dialogActions}>
        <button className={styles.dialogCancel} type="button" onClick={onCancel}>返回检查</button>
        <button className={styles.dialogConfirm} type="button" onClick={onConfirm}><Trash2 size={16} aria-hidden="true" />确认清理</button>
      </div>
    </dialog>
  )
}

export default function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ViewId>('scan')
  const [disk, setDisk] = useState<DiskOverview | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<ScanCategoryId>>(new Set())
  const [visibleCounts, setVisibleCounts] = useState<Partial<Record<ScanCategoryId, number>>>({})
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [pendingCleanup, setPendingCleanup] = useState<PendingCleanup | null>(null)
  const [cleanupProgress, setCleanupProgress] = useState<CleanupProgress | null>(null)
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null)
  const [cleanupError, setCleanupError] = useState('')
  const [isCleaning, setIsCleaning] = useState(false)
  const apiAvailable = Boolean(window.cleanMyWin)

  useEffect(() => {
    if (!window.cleanMyWin) return
    void window.cleanMyWin.getDiskOverview().then(setDisk).catch(() => setDisk(null))
    const removeScanListener = window.cleanMyWin.onScanProgress(setProgress)
    const removeCleanupListener = window.cleanMyWin.onCleanupProgress(setCleanupProgress)
    return () => {
      removeScanListener()
      removeCleanupListener()
    }
  }, [])

  const filesByPath = useMemo(() => new Map(
    (result?.groups.flatMap((group) => group.files) ?? []).map((file) => [file.path, file])
  ), [result])
  const selectedBytes = useMemo(() => Array.from(selectedPaths).reduce(
    (total, path) => total + (filesByPath.get(path)?.sizeBytes ?? 0), 0
  ), [filesByPath, selectedPaths])

  const usagePercent = useMemo(() => {
    if (!disk?.totalBytes) return 0
    return Math.round((disk.usedBytes / disk.totalBytes) * 100)
  }, [disk])

  const isScanActive = scanState === 'scanning' || scanState === 'stopping'
  const ringValue = scanState === 'complete' ? 100 : usagePercent

  const beginScan = async (): Promise<void> => {
    if (!window.cleanMyWin || isScanActive) return
    setScanState('scanning')
    setProgress(null)
    setResult(null)
    setErrorMessage('')
    setExpandedGroups(new Set())
    setVisibleCounts({})
    setSelectedPaths(new Set())
    setCleanupResult(null)
    setCleanupError('')
    setCleanupProgress(null)

    try {
      const scanResult = await window.cleanMyWin.scanCleanableFiles()
      if (!scanResult) {
        setProgress(null)
        setScanState('idle')
        return
      }
      setResult(scanResult)
      setScanState('complete')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '扫描未能完成')
      setScanState('error')
    }
  }

  const stopScan = async (): Promise<void> => {
    if (!window.cleanMyWin || scanState !== 'scanning') return
    setScanState('stopping')
    try {
      const cancellationStarted = await window.cleanMyWin.cancelScan()
      if (!cancellationStarted) setScanState('scanning')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '无法停止扫描')
      setScanState('error')
    }
  }

  const toggleGroup = (id: ScanCategoryId): void => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleFileSelection = (path: string): void => {
    if (isCleaning) return
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const toggleGroupSelection = (paths: string[]): void => {
    if (isCleaning) return
    setSelectedPaths((current) => {
      const next = new Set(current)
      const allSelected = paths.every((path) => next.has(path))
      paths.forEach((path) => allSelected ? next.delete(path) : next.add(path))
      return next
    })
  }

  const requestCleanup = (mode: CleanupMode): void => {
    if (!result || isCleaning) return
    const paths = mode === 'selected' ? Array.from(selectedPaths) : []
    const count = mode === 'selected' ? paths.length : result.fileCount
    const bytes = mode === 'selected' ? selectedBytes : result.totalBytes
    if (count === 0) return
    setPendingCleanup({ mode, count, bytes, paths })
  }

  const confirmCleanup = async (): Promise<void> => {
    if (!window.cleanMyWin || !result || !pendingCleanup) return
    const request = pendingCleanup
    setPendingCleanup(null)
    setIsCleaning(true)
    setCleanupProgress({ completedFiles: 0, totalFiles: request.count, cleanedFiles: 0, reclaimedBytes: 0 })
    setCleanupResult(null)
    setCleanupError('')

    try {
      const cleaned = await window.cleanMyWin.cleanupFiles(request.mode === 'all'
        ? { mode: 'all', scanFinishedAt: result.finishedAt }
        : { mode: 'selected', scanFinishedAt: result.finishedAt, paths: request.paths })
      setResult((current) => current ? removeCleanedFiles(current, cleaned.cleanedPaths) : current)
      setSelectedPaths(new Set())
      setCleanupResult(cleaned)
      void window.cleanMyWin.getDiskOverview().then(setDisk).catch(() => undefined)
    } catch (error) {
      setCleanupError(error instanceof Error ? error.message : '清理未能完成')
    } finally {
      setIsCleaning(false)
      setCleanupProgress(null)
    }
  }

  const statusLabel = scanState === 'scanning'
    ? progress?.currentLabel ?? '正在准备扫描'
    : scanState === 'stopping'
      ? '正在停止扫描'
    : scanState === 'complete'
      ? '扫描完成 · 等待选择'
      : scanState === 'error'
        ? '扫描遇到问题'
        : '只读扫描已就绪'

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">跳到主要内容</a>

      <aside className={styles.sidebar} aria-label="主导航">
        <div className={styles.brand}>
          <span className={styles.brandMark}><Sparkles size={19} strokeWidth={2.2} /></span>
          <span>CleanMyWin</span>
        </div>

        <nav className={styles.navigation}>
          {navItems.map(({ id, label, icon: Icon }) => {
            const active = activeView === id
            return (
            <button
              key={id}
              className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
              type="button"
              onClick={() => setActiveView(id)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {active && <span className={styles.activeDot} aria-hidden="true" />}
            </button>
            )
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.safetyNote}>
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>{activeView === 'scan' ? '安全清理' : '仅展示模式'}</strong>
              <span>{activeView === 'scan' ? '扫描后选择并确认' : '当前版本不会卸载应用'}</span>
            </div>
          </div>
          <button className={styles.navItem} type="button">
            <Settings size={18} aria-hidden="true" />
            <span>设置</span>
          </button>
        </div>
      </aside>

      <main id="main-content" className={styles.workspace}>
        {activeView === 'apps' ? <InstalledAppsView /> : <>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>安全扫描</p>
            <h1>看看哪些空间可以清理</h1>
          </div>
          <div className={styles.driveBadge}>
            <HardDrive size={17} aria-hidden="true" />
            <span>{disk?.drive ?? '系统盘'}</span>
            <strong>{disk ? `${formatBytes(disk.freeBytes)} 可用` : '正在读取'}</strong>
          </div>
        </header>

        <section className={styles.hero} aria-live="polite">
          <div
            className={`${styles.orbit} ${isScanActive ? styles.orbitScanning : ''}`}
            style={{ '--ring-progress': `${ringValue * 3.6}deg` } as React.CSSProperties}
          >
            <div className={styles.orbitInner}>
              {scanState === 'complete' ? <Check size={34} aria-hidden="true" /> : <Gauge size={34} aria-hidden="true" />}
              <strong>
                {scanState === 'scanning' ? '扫描中' : scanState === 'stopping' ? '停止中' : scanState === 'complete' ? formatBytes(result?.totalBytes ?? 0) : `${usagePercent}%`}
              </strong>
              <span>
                {scanState === 'idle' ? '磁盘已使用' : isScanActive ? `${progress?.filesFound ?? 0} 个文件` : `${result?.fileCount ?? 0} 个候选文件`}
              </span>
            </div>
          </div>

          <div className={styles.heroCopy}>
            <div className={`${styles.statusLine} ${scanState === 'error' ? styles.statusError : ''}`}>
              <span className={styles.statusPulse} />{statusLabel}
            </div>
            <h2>
              {scanState === 'complete'
                ? `发现 ${result?.groups.length ?? 0} 类可清理内容`
                : isScanActive
                  ? `已发现 ${formatBytes(progress?.bytesFound ?? 0)}`
                  : scanState === 'error'
                    ? '扫描没有完成'
                    : '先扫描，再查看每一个文件'}
            </h2>
            <p>
              {scanState === 'complete'
                ? '在下方勾选文件或分类，确认范围后再清理。扫描后发生变化的文件会自动跳过。'
                : scanState === 'error'
                  ? errorMessage
                  : '检查系统临时文件和可重新生成的缓存。桌面、文档和下载目录始终排除。'}
            </p>
            <div className={styles.scanActions}>
              {isScanActive ? (
                <button className={styles.stopButton} type="button" onClick={() => void stopScan()} disabled={scanState === 'stopping'}>
                  <Square size={14} fill="currentColor" aria-hidden="true" />
                  {scanState === 'stopping' ? '正在停止' : '停止扫描'}
                </button>
              ) : (
                <button className={styles.primaryButton} type="button" onClick={() => void beginScan()} disabled={!apiAvailable}>
                  {scanState === 'complete' ? '重新扫描' : '开始扫描'}
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              )}
            </div>
            {!apiAvailable && <small className={styles.runtimeHint}>扫描组件未就绪，请重新启动应用</small>}
          </div>
        </section>

        <section className={styles.summary} aria-labelledby="summary-title">
          <div className={styles.summaryHeading}>
            <div>
              <p className={styles.eyebrow}>{result ? `${result.fileCount} 个文件 · ${formatBytes(result.totalBytes)}` : '扫描结果'}</p>
              <h2 id="summary-title">{result ? '可清理候选内容' : '完成扫描后在这里逐项查看'}</h2>
            </div>
            {result && result.fileCount > 0 ? (
              <div className={styles.cleanupActions}>
                <button className={styles.selectedCleanupButton} type="button" onClick={() => requestCleanup('selected')} disabled={selectedPaths.size === 0 || isCleaning}>
                  {isCleaning ? <LoaderCircle className={styles.spinningIcon} size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                  <span>清理已选<strong>{selectedPaths.size > 0 ? `${formatBytes(selectedBytes)} · ${selectedPaths.size} 项` : '尚未选择'}</strong></span>
                </button>
                <button className={styles.cleanupAllButton} type="button" onClick={() => requestCleanup('all')} disabled={isCleaning}>
                  <Trash2 size={16} aria-hidden="true" /><span>清理全部<strong>{formatBytes(result.totalBytes)}</strong></span>
                </button>
              </div>
            ) : <div className={styles.infoLabel}><Info size={16} aria-hidden="true" />扫描与清理分开执行</div>}
          </div>

          {isCleaning && cleanupProgress && (
            <div className={styles.cleanupStatus} role="status">
              <LoaderCircle className={styles.spinningIcon} size={18} aria-hidden="true" />
              <span><strong>正在清理</strong>已处理 {cleanupProgress.completedFiles} / {cleanupProgress.totalFiles}，已释放 {formatBytes(cleanupProgress.reclaimedBytes)}</span>
            </div>
          )}
          {!isCleaning && cleanupResult && (
            <div className={styles.cleanupSuccess} role="status">
              <Check size={18} aria-hidden="true" />
              <span><strong>清理完成，释放 {formatBytes(cleanupResult.reclaimedBytes)}</strong>
                {cleanupResult.skippedCount + cleanupResult.failedCount > 0
                  ? `已清理 ${cleanupResult.cleanedCount} 项，跳过 ${cleanupResult.skippedCount} 项，失败 ${cleanupResult.failedCount} 项。`
                  : `已清理 ${cleanupResult.cleanedCount} 个文件。`}
              </span>
            </div>
          )}
          {!isCleaning && cleanupError && (
            <div className={styles.cleanupError} role="alert"><CircleAlert size={18} aria-hidden="true" /><span><strong>清理没有完成</strong>{cleanupError}</span></div>
          )}

          {result && result.groups.length > 0 ? (
            <div className={styles.categories}>
              {result.groups.map((group) => {
                const Icon = categoryIcons[group.id]
                const expanded = expandedGroups.has(group.id)
                const visibleCount = visibleCounts[group.id] ?? 40
                const files = group.files.slice(0, visibleCount)
                const groupPaths = group.files.map((file) => file.path)
                const selectedInGroup = groupPaths.filter((path) => selectedPaths.has(path)).length
                return (
                  <div className={styles.categoryBlock} key={group.id}>
                    <div className={`${styles.categoryRow} ${selectedInGroup === group.fileCount ? styles.rowSelected : ''}`}>
                      <SelectionCheckbox
                        checked={selectedInGroup === group.fileCount}
                        indeterminate={selectedInGroup > 0 && selectedInGroup < group.fileCount}
                        disabled={isCleaning}
                        label={`${selectedInGroup === group.fileCount ? '取消选择' : '选择'}${group.label}全部文件`}
                        onChange={() => toggleGroupSelection(groupPaths)}
                      />
                      <button className={styles.categoryToggle} type="button" onClick={() => toggleGroup(group.id)} aria-expanded={expanded}>
                        <span className={styles.categoryIcon}><Icon size={19} aria-hidden="true" /></span>
                        <span className={styles.categoryText}><strong>{group.label}</strong><small>{group.description} · {group.fileCount} 个文件{selectedInGroup > 0 ? ` · 已选 ${selectedInGroup}` : ''}</small></span>
                        <span className={styles.categoryValue}>{formatBytes(group.sizeBytes)}</span>
                        <span className={styles.categoryChevron}>
                          {expanded ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
                        </span>
                      </button>
                    </div>
                    {expanded && (
                      <div className={styles.fileList}>
                        {files.map((file) => (
                          <div className={`${styles.fileRow} ${selectedPaths.has(file.path) ? styles.fileRowSelected : ''}`} key={file.path}>
                            <SelectionCheckbox checked={selectedPaths.has(file.path)} disabled={isCleaning} label={`${selectedPaths.has(file.path) ? '取消选择' : '选择'} ${file.path}`} onChange={() => toggleFileSelection(file.path)} />
                            <span className={styles.fileMeta}><strong>{file.sourceLabel}</strong><code title={file.path}>{file.path}</code></span>
                            <span className={styles.fileSize}>{formatBytes(file.sizeBytes)}</span>
                          </div>
                        ))}
                        {visibleCount < group.files.length && (
                          <button className={styles.moreButton} type="button" onClick={() => setVisibleCounts((current) => ({ ...current, [group.id]: visibleCount + 100 }))}>
                            再显示 {Math.min(100, group.files.length - visibleCount)} 个文件
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              <p className={styles.scanFootnote}>已跳过 {result.skippedPaths} 个受保护或链接路径；读取失败 {result.errorCount} 处。</p>
            </div>
          ) : result ? (
            <div className={styles.emptyState}><ShieldCheck size={24} aria-hidden="true" /><span>{cleanupResult?.cleanedCount ? '本次扫描中可清理的文件已处理完成' : '没有发现符合安全规则的候选文件'}</span></div>
          ) : (
            <div className={styles.scopeGrid}>
              <span>用户临时内容</span><span>浏览器与应用缓存</span><span>开发工具缓存</span><span>图形着色器缓存</span>
            </div>
          )}
        </section>
        </>}
      </main>
      {pendingCleanup && <CleanupConfirmDialog request={pendingCleanup} onCancel={() => setPendingCleanup(null)} onConfirm={() => void confirmCleanup()} />}
    </div>
  )
}
