import {
  AppWindow,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  FileClock,
  Gauge,
  Globe2,
  HardDrive,
  Info,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DiskOverview, ScanCategoryId, ScanProgress, ScanResult } from '../../shared/contracts'
import InstalledAppsView from './InstalledAppsView'
import styles from './App.module.css'

type ScanState = 'idle' | 'scanning' | 'stopping' | 'complete' | 'error'
type ViewId = 'scan' | 'apps'

const navItems = [
  { id: 'scan' as const, label: '扫描概览', icon: Search },
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

export default function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ViewId>('scan')
  const [disk, setDisk] = useState<DiskOverview | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<ScanCategoryId>>(new Set())
  const [visibleCounts, setVisibleCounts] = useState<Partial<Record<ScanCategoryId, number>>>({})
  const apiAvailable = Boolean(window.cleanMyWin)

  useEffect(() => {
    if (!window.cleanMyWin) return
    void window.cleanMyWin.getDiskOverview().then(setDisk).catch(() => setDisk(null))
    return window.cleanMyWin.onScanProgress(setProgress)
  }, [])

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

  const statusLabel = scanState === 'scanning'
    ? progress?.currentLabel ?? '正在准备扫描'
    : scanState === 'stopping'
      ? '正在停止扫描'
    : scanState === 'complete'
      ? '扫描完成 · 仅展示结果'
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
              <strong>{activeView === 'scan' ? '仅扫描模式' : '仅展示模式'}</strong>
              <span>{activeView === 'scan' ? '当前版本无法删除文件' : '当前版本不会卸载应用'}</span>
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
                ? '下方结果只用于查看。当前版本没有清理按钮，也不会修改或删除任何文件。'
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
            <div className={styles.infoLabel}><Info size={16} aria-hidden="true" />仅展示，不执行清理</div>
          </div>

          {result && result.groups.length > 0 ? (
            <div className={styles.categories}>
              {result.groups.map((group) => {
                const Icon = categoryIcons[group.id]
                const expanded = expandedGroups.has(group.id)
                const visibleCount = visibleCounts[group.id] ?? 40
                const files = group.files.slice(0, visibleCount)
                return (
                  <div className={styles.categoryBlock} key={group.id}>
                    <button className={styles.categoryRow} type="button" onClick={() => toggleGroup(group.id)} aria-expanded={expanded}>
                      <span className={styles.categoryIcon}><Icon size={19} aria-hidden="true" /></span>
                      <span className={styles.categoryText}><strong>{group.label}</strong><small>{group.description} · {group.fileCount} 个文件</small></span>
                      <span className={styles.categoryValue}>{formatBytes(group.sizeBytes)}</span>
                      <span className={styles.categoryChevron}>
                        {expanded ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
                      </span>
                    </button>
                    {expanded && (
                      <div className={styles.fileList}>
                        {files.map((file) => (
                          <div className={styles.fileRow} key={file.path}>
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
            <div className={styles.emptyState}><ShieldCheck size={24} aria-hidden="true" /><span>没有发现符合安全规则的候选文件</span></div>
          ) : (
            <div className={styles.scopeGrid}>
              <span>用户临时内容</span><span>浏览器与应用缓存</span><span>开发工具缓存</span><span>图形着色器缓存</span>
            </div>
          )}
        </section>
        </>}
      </main>
    </div>
  )
}
