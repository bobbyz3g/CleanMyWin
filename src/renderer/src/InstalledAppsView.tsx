import { AppWindow, Package, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { InstalledApplication, InstalledAppsResult } from '../../shared/contracts'
import styles from './InstalledAppsView.module.css'

type LoadState = 'loading' | 'ready' | 'error'

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return '大小未知'
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unit
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`
}

const matchesQuery = (app: InstalledApplication, query: string): boolean => {
  const searchable = [app.name, app.publisher, app.version].filter(Boolean).join(' ').toLocaleLowerCase()
  return searchable.includes(query.toLocaleLowerCase())
}

function InstalledAppIcon({ app }: { app: InstalledApplication }): React.JSX.Element {
  const containerRef = useRef<HTMLSpanElement>(null)
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !window.cleanMyWin) return
    let active = true
    const loadIcon = (): void => {
      void window.cleanMyWin.getInstalledAppIcon(app.id).then((url) => {
        if (active) setIconUrl(url)
      }).catch(() => {
        if (active) setIconUrl(null)
      })
    }

    if (!('IntersectionObserver' in window)) {
      loadIcon()
      return () => { active = false }
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      loadIcon()
    }, { rootMargin: '180px 0px' })
    observer.observe(container)

    return () => {
      active = false
      observer.disconnect()
    }
  }, [app.id])

  return (
    <span className={styles.appIcon} ref={containerRef}>
      {iconUrl
        ? <img className={styles.appIconImage} src={iconUrl} alt="" width="28" height="28" />
        : <Package size={19} aria-hidden="true" />}
    </span>
  )
}

export default function InstalledAppsView(): React.JSX.Element {
  const [result, setResult] = useState<InstalledAppsResult | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [query, setQuery] = useState('')

  const loadApps = async (): Promise<void> => {
    if (!window.cleanMyWin) {
      setErrorMessage('应用读取组件未就绪，请重新启动应用')
      setLoadState('error')
      return
    }
    setLoadState('loading')
    setErrorMessage('')
    try {
      setResult(await window.cleanMyWin.getInstalledApps())
      setLoadState('ready')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '无法读取已安装应用')
      setLoadState('error')
    }
  }

  useEffect(() => {
    void loadApps()
  }, [])

  const visibleApps = useMemo(() => {
    const normalizedQuery = query.trim()
    if (!result || !normalizedQuery) return result?.apps ?? []
    return result.apps.filter((app) => matchesQuery(app, normalizedQuery))
  }, [query, result])

  const knownSize = useMemo(
    () => visibleApps.reduce((total, app) => total + (app.estimatedSizeBytes ?? 0), 0),
    [visibleApps]
  )

  return (
    <section className={styles.page} aria-labelledby="apps-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>应用管理</p>
          <h1 id="apps-title">已安装的应用</h1>
          <p className={styles.intro}>查看传统桌面程序和 Microsoft Store 应用。当前阶段只展示信息，不会执行卸载。</p>
        </div>
        <div className={styles.readOnlyBadge}><ShieldCheck size={17} aria-hidden="true" />仅展示</div>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <Search size={17} aria-hidden="true" />
          <span className={styles.srOnly}>搜索应用</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、发布者或版本" type="search" />
        </label>
        <button className={styles.refreshButton} type="button" onClick={() => void loadApps()} disabled={loadState === 'loading'}>
          <RefreshCw size={16} aria-hidden="true" />
          {loadState === 'loading' ? '正在读取' : '重新读取'}
        </button>
      </div>

      <div className={styles.summaryLine} aria-live="polite">
        <span>{loadState === 'loading' ? '正在读取系统应用清单' : `显示 ${visibleApps.length} 个应用`}</span>
        {loadState === 'ready' && <span>已知大小合计 {formatBytes(knownSize)}</span>}
      </div>

      {loadState === 'loading' ? (
        <div className={styles.loadingState}><span className={styles.spinner} /><strong>正在读取已安装应用</strong><span>注册表与 Store 应用会合并显示</span></div>
      ) : loadState === 'error' ? (
        <div className={styles.messageState}><AppWindow size={24} aria-hidden="true" /><strong>无法读取应用清单</strong><span>{errorMessage}</span></div>
      ) : visibleApps.length === 0 ? (
        <div className={styles.messageState}><Search size={24} aria-hidden="true" /><strong>没有匹配的应用</strong><span>尝试缩短搜索内容</span></div>
      ) : (
        <div className={styles.appList} role="list" aria-label="已安装应用">
          {visibleApps.map((app) => (
            <article className={styles.appRow} role="listitem" key={app.id}>
              <InstalledAppIcon app={app} />
              <span className={styles.appIdentity}>
                <strong title={app.name}>{app.name}</strong>
                <small title={app.publisher ?? undefined}>{app.publisher ?? '未知发布者'}</small>
              </span>
              <span className={styles.appSource}>{app.source === 'store' ? 'Store' : '桌面应用'}</span>
              <span className={styles.appVersion}>{app.version ?? '版本未知'}</span>
              <span className={styles.appSize}>{formatBytes(app.estimatedSizeBytes)}</span>
              <span className={styles.appDate}>{app.installDate ?? '日期未知'}</span>
            </article>
          ))}
        </div>
      )}

      {result && result.errorCount > 0 && <p className={styles.footnote}>有 {result.errorCount} 个系统来源无法读取，其他应用已正常显示。</p>}
    </section>
  )
}
