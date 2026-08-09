import {
  AppWindow,
  Box,
  Check,
  ChevronRight,
  Gauge,
  HardDrive,
  Info,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DiskOverview } from '../../shared/contracts'
import styles from './App.module.css'

type ScanState = 'idle' | 'scanning' | 'complete'

const scanStages = ['检查临时文件', '分析应用缓存', '整理系统日志', '确认安全项目']

const navItems = [
  { label: '智能清理', icon: Sparkles, active: true },
  { label: '系统垃圾', icon: Trash2 },
  { label: '大型文件', icon: HardDrive },
  { label: '应用管理', icon: AppWindow }
]

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB'
  return `${(bytes / 1024 ** 3).toFixed(bytes > 1024 ** 3 * 100 ? 0 : 1)} GB`
}

export default function App(): React.JSX.Element {
  const [disk, setDisk] = useState<DiskOverview | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!window.cleanMyWin) return
    void window.cleanMyWin.getDiskOverview().then(setDisk).catch(() => setDisk(null))
  }, [])

  useEffect(() => {
    if (scanState !== 'scanning') return

    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(current + 2, 100)
        if (next === 100) {
          window.clearInterval(timer)
          setScanState('complete')
        }
        return next
      })
    }, 55)

    return () => window.clearInterval(timer)
  }, [scanState])

  const usagePercent = useMemo(() => {
    if (!disk?.totalBytes) return 0
    return Math.round((disk.usedBytes / disk.totalBytes) * 100)
  }, [disk])

  const currentStage = scanStages[Math.min(Math.floor(progress / 25), scanStages.length - 1)]
  const ringValue = scanState === 'scanning' ? progress : usagePercent

  const beginScan = (): void => {
    if (scanState === 'scanning') return
    setProgress(0)
    setScanState('scanning')
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">跳到主要内容</a>

      <aside className={styles.sidebar} aria-label="主导航">
        <div className={styles.brand}>
          <span className={styles.brandMark}><Sparkles size={19} strokeWidth={2.2} /></span>
          <span>CleanMyWin</span>
        </div>

        <nav className={styles.navigation}>
          {navItems.map(({ label, icon: Icon, active }) => (
            <button key={label} className={`${styles.navItem} ${active ? styles.navItemActive : ''}`} type="button">
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {active && <span className={styles.activeDot} aria-hidden="true" />}
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.safetyNote}>
            <ShieldCheck size={18} aria-hidden="true" />
            <div><strong>安全模式已开启</strong><span>扫描不会删除文件</span></div>
          </div>
          <button className={styles.navItem} type="button">
            <Settings size={18} aria-hidden="true" />
            <span>设置</span>
          </button>
        </div>
      </aside>

      <main id="main-content" className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>智能清理</p>
            <h1>让电脑轻松一点</h1>
          </div>
          <div className={styles.driveBadge}>
            <HardDrive size={17} aria-hidden="true" />
            <span>{disk?.drive ?? '系统盘'}</span>
            <strong>{disk ? `${formatBytes(disk.freeBytes)} 可用` : '正在读取'}</strong>
          </div>
        </header>

        <section className={styles.hero} aria-live="polite">
          <div className={styles.orbit} style={{ '--ring-progress': `${ringValue * 3.6}deg` } as React.CSSProperties}>
            <div className={styles.orbitInner}>
              {scanState === 'complete' ? <Check size={34} aria-hidden="true" /> : <Gauge size={34} aria-hidden="true" />}
              <strong>{scanState === 'scanning' ? `${progress}%` : scanState === 'complete' ? '扫描完成' : `${usagePercent}%`}</strong>
              <span>{scanState === 'idle' ? '磁盘已使用' : scanState === 'scanning' ? currentStage : '发现 3 类可清理项目'}</span>
            </div>
          </div>

          <div className={styles.heroCopy}>
            <div className={styles.statusLine}><span className={styles.statusPulse} />准备就绪</div>
            <h2>{scanState === 'complete' ? '可以安全释放 2.7 GB' : '先扫描，再决定清理什么'}</h2>
            <p>{scanState === 'complete' ? '已排除个人文件和仍在使用的应用数据，你可以在执行前复核每一项。' : '快速检查系统临时文件、应用缓存和可安全移除的日志。不会触碰文档、桌面或下载内容。'}</p>
            <button className={styles.primaryButton} type="button" onClick={beginScan} disabled={scanState === 'scanning'}>
              {scanState === 'scanning' ? '正在扫描' : scanState === 'complete' ? '重新扫描' : '开始扫描'}
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className={styles.summary} aria-labelledby="summary-title">
          <div className={styles.summaryHeading}>
            <div><p className={styles.eyebrow}>本次检查</p><h2 id="summary-title">只处理明确安全的位置</h2></div>
            <div className={styles.infoLabel}><Info size={16} aria-hidden="true" />执行清理前可逐项复核</div>
          </div>

          <div className={styles.categories}>
            {[
              { icon: Box, label: '临时文件', detail: 'Windows 与安装程序残留', value: scanState === 'complete' ? '1.8 GB' : '待扫描' },
              { icon: AppWindow, label: '应用缓存', detail: '可重新生成的缓存内容', value: scanState === 'complete' ? '742 MB' : '待扫描' },
              { icon: Gauge, label: '系统日志', detail: '过期的诊断与更新日志', value: scanState === 'complete' ? '186 MB' : '待扫描' }
            ].map(({ icon: Icon, label, detail, value }) => (
              <button className={styles.categoryRow} type="button" key={label}>
                <span className={styles.categoryIcon}><Icon size={19} aria-hidden="true" /></span>
                <span className={styles.categoryText}><strong>{label}</strong><small>{detail}</small></span>
                <span className={styles.categoryValue}>{value}</span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
