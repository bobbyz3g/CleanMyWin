import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, parse, resolve, sep } from 'node:path'
import { lstat, readFile, readdir } from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import type {
  ScanCategoryId,
  ScanFileItem,
  ScanGroup,
  ScanProgress,
  ScanResult
} from '../shared/contracts'

interface ScanTarget {
  category: ScanCategoryId
  label: string
  pattern: string
  recursive?: boolean
  minAgeDays?: number
  rootMinAgeDays?: number
  filePattern?: string
}

export interface ScannerEnvironment {
  userProfile: string
  localAppData: string
  appData: string
  temp: string
  windows: string
  programData: string
  programFiles: string
  programFilesX86: string
  goPath?: string
  miseCacheDir?: string
}

export interface ScanOptions {
  environment?: ScannerEnvironment
  now?: Date
  signal?: AbortSignal
  onProgress?: (progress: ScanProgress) => void
}

export class ScanCancelledError extends Error {
  override name = 'ScanCancelledError'

  constructor() {
    super('Scan cancelled')
  }
}

const throwIfCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new ScanCancelledError()
}

const categoryMeta: Record<ScanCategoryId, Pick<ScanGroup, 'label' | 'description'>> = {
  'user-junk': {
    label: '用户与系统痕迹',
    description: '临时文件、过期日志、缩略图和错误报告'
  },
  'browser-cache': {
    label: '浏览器缓存',
    description: '浏览器可重新生成的页面、代码与图形缓存'
  },
  'application-cache': {
    label: '应用缓存',
    description: '常用应用、办公软件、云盘与游戏平台缓存'
  },
  'developer-cache': {
    label: '开发工具缓存',
    description: '包管理器、编译器、CLI、编辑器与 IDE 缓存'
  },
  'gpu-cache': {
    label: '图形缓存',
    description: 'DirectX、Vulkan 与显卡驱动着色器缓存'
  }
}

const wildcardToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

const normalizeForComparison = (value: string): string => resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase()

const isWithin = (candidate: string, root: string): boolean => {
  const normalizedCandidate = normalizeForComparison(candidate)
  const normalizedRoot = normalizeForComparison(root)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
}

export function getScannerEnvironment(source: NodeJS.ProcessEnv = process.env): ScannerEnvironment {
  const userProfile = source.USERPROFILE || homedir()
  const localAppData = source.LOCALAPPDATA || join(userProfile, 'AppData', 'Local')
  const appData = source.APPDATA || join(userProfile, 'AppData', 'Roaming')

  return {
    userProfile,
    localAppData,
    appData,
    temp: source.TEMP || source.TMP || tmpdir(),
    windows: source.WINDIR || source.SYSTEMROOT || 'C:\\Windows',
    programData: source.PROGRAMDATA || 'C:\\ProgramData',
    programFiles: source.ProgramFiles || 'C:\\Program Files',
    programFilesX86: source['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    goPath: source.GOPATH,
    miseCacheDir: source.MISE_CACHE_DIR
  }
}

const targetsFor = (env: ScannerEnvironment): ScanTarget[] => {
  const t = (category: ScanCategoryId, label: string, pattern: string, options: Omit<ScanTarget, 'category' | 'label' | 'pattern'> = {}): ScanTarget => ({
    category,
    label,
    pattern,
    ...options
  })

  return [
    t('user-junk', '用户临时文件', env.temp, { minAgeDays: 7, filePattern: '*' }),
    t('user-junk', '最近使用记录', join(env.appData, 'Microsoft', 'Windows', 'Recent'), { minAgeDays: 30, filePattern: '*.lnk' }),
    t('user-junk', '跳转列表记录', join(env.appData, 'Microsoft', 'Windows', 'Recent', 'AutomaticDestinations'), { minAgeDays: 30 }),
    t('user-junk', '缩略图缓存', join(env.localAppData, 'Microsoft', 'Windows', 'Explorer'), { filePattern: 'thumbcache_*.db' }),
    t('user-junk', '图标缓存', join(env.localAppData, 'IconCache.db')),
    t('user-junk', 'Windows 错误报告', join(env.localAppData, 'Microsoft', 'Windows', 'WER'), { recursive: true }),
    t('user-junk', '应用崩溃转储', join(env.localAppData, 'CrashDumps'), { recursive: true }),
    t('user-junk', '用户内存转储', join(env.userProfile, '*.dmp')),
    t('user-junk', '过期临时日志', join(env.localAppData, 'Temp'), { minAgeDays: 7, filePattern: '*.log' }),
    t('user-junk', '过期应用日志', env.appData, { minAgeDays: 7, filePattern: '*.log' }),
    t('user-junk', '过期用户日志', env.userProfile, { minAgeDays: 7, filePattern: '*.log' }),

    ...[
      join(env.localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
      join(env.localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
      join(env.localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'GPUCache'),
      join(env.localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Service Worker', 'CacheStorage'),
      join(env.localAppData, 'Google', 'Chrome', 'User Data', 'ShaderCache'),
      join(env.localAppData, 'Google', 'Chrome', 'User Data', 'GrShaderCache')
    ].map((path) => t('browser-cache', 'Chrome 缓存', path, { recursive: true })),
    ...[
      join(env.localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
      join(env.localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
      join(env.localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'GPUCache'),
      join(env.localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Service Worker', 'CacheStorage'),
      join(env.localAppData, 'Microsoft', 'Edge', 'User Data', 'ShaderCache')
    ].map((path) => t('browser-cache', 'Edge 缓存', path, { recursive: true })),
    ...['cache2', 'startupCache', 'shader-cache'].map((folder) =>
      t('browser-cache', 'Firefox 缓存', join(env.appData, 'Mozilla', 'Firefox', 'Profiles', '*', folder), { recursive: true })
    ),
    t('browser-cache', 'Brave 缓存', join(env.localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache'), { recursive: true }),
    t('browser-cache', 'Opera 缓存', join(env.appData, 'Opera Software', 'Opera Stable', 'Cache'), { recursive: true }),

    ...[
      join(env.localAppData, 'NVIDIA', 'DXCache'),
      join(env.localAppData, 'NVIDIA', 'GLCache'),
      join(env.localAppData, 'NVIDIA Corporation', 'NV_Cache'),
      join(env.temp, 'NVIDIA Corporation', 'NV_Cache'),
      join(env.localAppData, 'AMD', 'DXCache'),
      join(env.localAppData, 'AMD', 'GLCache'),
      join(env.localAppData, 'AMD', 'VkCache'),
      join(env.localAppData, 'Intel', 'ShaderCache'),
      join(env.appData, 'Intel', 'ShaderCache'),
      join(env.localAppData, 'D3DSCache'),
      join(env.localAppData, 'Microsoft', 'DirectX Shader Cache'),
      join(env.localAppData, 'VulkanCache')
    ].map((path) => t('gpu-cache', '着色器缓存', path, { recursive: true })),

    ...[
      join(env.localAppData, 'Spotify', 'Data'),
      join(env.localAppData, 'Spotify', 'Storage'),
      join(env.appData, 'discord', 'Cache'),
      join(env.appData, 'discord', 'Code Cache'),
      join(env.appData, 'discord', 'GPUCache'),
      join(env.appData, 'Slack', 'Cache'),
      join(env.appData, 'Slack', 'Code Cache'),
      join(env.appData, 'Slack', 'GPUCache'),
      join(env.appData, 'Slack', 'Service Worker', 'CacheStorage'),
      join(env.appData, 'Microsoft', 'Teams', 'Cache'),
      join(env.appData, 'Microsoft', 'Teams', 'blob_storage'),
      join(env.appData, 'Microsoft', 'Teams', 'databases'),
      join(env.appData, 'Microsoft', 'Teams', 'GPUCache'),
      join(env.appData, 'Microsoft', 'Teams', 'IndexedDB'),
      join(env.appData, 'Microsoft', 'Teams', 'Local Storage'),
      join(env.appData, 'Microsoft', 'Teams', 'tmp'),
      join(env.appData, 'Code', 'Cache'),
      join(env.appData, 'Code', 'CachedData'),
      join(env.appData, 'Code', 'CachedExtensions'),
      join(env.appData, 'Code', 'CachedExtensionVSIXs'),
      join(env.appData, 'Code', 'Code Cache'),
      join(env.appData, 'Code', 'GPUCache'),
      join(env.appData, 'Zoom', 'data'),
      join(env.appData, 'Adobe', 'Common', 'Media Cache Files'),
      join(env.appData, 'Adobe', 'Common', 'Peak Files'),
      join(env.appData, 'Adobe', 'Common', 'Team Projects Cache'),
      join(env.localAppData, 'Adobe', '*', 'Cache'),
      join(env.localAppData, 'Adobe', '*', 'CameraRaw', 'Cache'),
      join(env.localAppData, 'Temp', 'Adobe'),
      join(env.localAppData, 'Autodesk', '*', 'Cache'),
      join(env.appData, 'Autodesk', '*', 'cache'),
      join(env.localAppData, 'EpicGamesLauncher', 'Saved', 'webcache'),
      join(env.localAppData, 'EpicGamesLauncher', 'Saved', 'Logs'),
      join(env.localAppData, 'Electronic Arts', 'EA Desktop', 'cache'),
      join(env.appData, 'Origin', '*', 'cache'),
      join(env.localAppData, 'GOG.com', 'Galaxy', 'webcache'),
      join(env.programData, 'GOG.com', 'Galaxy', 'logs'),
      join(env.localAppData, 'Ubisoft Game Launcher', 'cache'),
      join(env.localAppData, 'Ubisoft Game Launcher', 'logs'),
      join(env.appData, 'Battle.net', 'Cache'),
      join(env.appData, 'Battle.net', 'Logs')
    ].map((path) => t('application-cache', '应用缓存', path, { recursive: true })),
    ...[
      join(env.localAppData, 'Microsoft', 'Office', '16.0', 'OfficeFileCache'),
      join(env.localAppData, 'Microsoft', 'Office', '16.0', 'Wef'),
      join(env.localAppData, 'Microsoft', 'Outlook', 'RoamCache'),
      join(env.localAppData, 'Microsoft', 'Outlook', 'Offline Address Books'),
      join(env.localAppData, 'Microsoft', 'Office', '15.0', 'OfficeFileCache')
    ].map((path) => t('application-cache', 'Office 缓存', path, { recursive: true })),
    ...[
      join(env.appData, 'Microsoft', 'Templates'),
      join(env.appData, 'Microsoft', 'Word'),
      join(env.appData, 'Microsoft', 'Excel'),
      join(env.appData, 'Microsoft', 'PowerPoint')
    ].map((path) => t('application-cache', 'Office 临时文件', path, { filePattern: '*.tmp' })),
    t('application-cache', 'OneDrive 过期日志', join(env.localAppData, 'Microsoft', 'OneDrive', 'logs'), { minAgeDays: 7 }),
    t('application-cache', 'OneDrive 安装日志', join(env.localAppData, 'Microsoft', 'OneDrive', 'setup', 'logs'), { minAgeDays: 7 }),
    t('application-cache', 'Google Drive 过期日志', join(env.localAppData, 'Google', 'DriveFS', 'Logs'), { minAgeDays: 7 }),
    t('application-cache', 'Google Drive 临时文件', join(env.localAppData, 'Google', 'DriveFS'), { filePattern: '*.tmp' }),

    ...[
      join(env.appData, 'npm-cache'),
      join(env.localAppData, 'npm-cache'),
      join(env.localAppData, 'pnpm', 'store'),
      join(env.localAppData, 'Yarn', 'Cache'),
      join(env.userProfile, '.yarn', 'cache'),
      join(env.userProfile, '.bun', 'install', 'cache'),
      join(env.localAppData, 'node-gyp', 'Cache'),
      join(env.localAppData, 'electron', 'Cache'),
      join(env.localAppData, 'TypeScript'),
      join(env.localAppData, 'pip', 'Cache'),
      join(env.userProfile, '.pyenv', 'cache'),
      join(env.localAppData, 'pypoetry', 'Cache'),
      join(env.appData, 'jupyter', 'runtime'),
      join(env.localAppData, 'NuGet', 'v3-cache'),
      join(env.localAppData, 'NuGet', 'plugins-cache'),
      join(env.localAppData, 'go-build'),
      join(env.goPath || join(env.userProfile, 'go'), 'pkg', 'mod', 'cache'),
      ...(env.miseCacheDir ? [env.miseCacheDir] : []),
      join(env.userProfile, '.cargo', 'registry', 'cache'),
      join(env.userProfile, '.cargo', 'git', 'checkouts'),
      join(env.userProfile, '.rustup', 'downloads'),
      join(env.userProfile, '.aws', 'cli', 'cache'),
      join(env.userProfile, '.azure', 'logs'),
      join(env.appData, 'gcloud', 'logs'),
      join(env.userProfile, '.kube', 'cache'),
      join(env.appData, 'terraform.d', 'plugin-cache'),
      join(env.userProfile, '.hex', 'cache'),
      join(env.userProfile, '.opam', 'download-cache'),
      join(env.appData, 'Sublime Text', 'Cache'),
      join(env.appData, '.atom', 'compile-cache'),
      join(env.localAppData, 'Microsoft', 'vscode-cpptools')
    ].map((path) => t('developer-cache', '开发工具缓存', path, { recursive: true })),
    t('developer-cache', 'pytest 缓存', join(env.userProfile, '.pytest_cache'), { recursive: true }),
    ...[
      join(env.userProfile, '.conda', 'pkgs'),
      join(env.userProfile, 'anaconda3', 'pkgs'),
      join(env.userProfile, 'miniconda3', 'pkgs')
    ].map((path) => t('developer-cache', 'Conda 临时文件', path, { filePattern: '*.tmp' })),
    t('developer-cache', 'MSBuild 临时目录', join(env.localAppData, 'Microsoft', 'MSBuild', '*temp*'), { recursive: true }),
    t('developer-cache', 'Gradle 锁文件', join(env.userProfile, '.gradle'), { recursive: true, filePattern: '*.lock' }),
    t('developer-cache', 'Maven 更新标记', join(env.userProfile, '.m2', 'repository'), { recursive: true, filePattern: '*.lastUpdated' }),
    t('developer-cache', '过期 Hex 包', join(env.userProfile, '.hex', 'packages', '*'), { recursive: true, rootMinAgeDays: 90 }),
    t('developer-cache', '过期 Cabal 包缓存', join(env.userProfile, '.cabal', 'packages'), { recursive: true, minAgeDays: 90 }),
    t('developer-cache', '过期 Cabal store', join(env.userProfile, '.cabal', 'store', '*'), { recursive: true, rootMinAgeDays: 90 }),
    t('developer-cache', '过期 Stack 程序', join(env.userProfile, '.stack', 'programs', '*'), { recursive: true, rootMinAgeDays: 90 }),
    t('developer-cache', 'Stack 临时文件', join(env.userProfile, '.stack', 'snapshots'), { recursive: true, filePattern: '*.tmp' }),
    t('developer-cache', 'Opam 仓库缓存', join(env.userProfile, '.opam', 'repo', '*cache*'), { recursive: true }),
    ...[
      join(env.appData, 'Code', 'Cache'),
      join(env.appData, 'Code', 'CachedData'),
      join(env.appData, 'Code', 'CachedExtensions'),
      join(env.appData, 'Code', 'CachedExtensionVSIXs'),
      join(env.appData, 'Code', 'Code Cache'),
      join(env.appData, 'Code', 'GPUCache'),
      join(env.appData, 'Code - Insiders', 'Cache'),
      join(env.appData, 'Code - Insiders', 'CachedData'),
      join(env.appData, 'Code - Insiders', 'CachedExtensions'),
      join(env.appData, 'Code - Insiders', 'CachedExtensionVSIXs'),
      join(env.appData, 'Code - Insiders', 'Code Cache'),
      join(env.appData, 'Code - Insiders', 'GPUCache'),
      join(env.localAppData, 'Zed', 'cache'),
      join(env.appData, 'Zed', 'cache')
    ].map((path) => t('developer-cache', '编辑器缓存', path, { recursive: true })),
    t('developer-cache', 'Visual Studio 缓存', join(env.localAppData, 'Microsoft', 'VisualStudio', '*', 'ComponentModelCache'), { recursive: true }),
    t('developer-cache', 'Visual Studio 图像缓存', join(env.localAppData, 'Microsoft', 'VisualStudio', '*', 'ImageCache'), { recursive: true }),
    ...['caches', 'index', 'tmp'].flatMap((folder) => [
      t('developer-cache', 'JetBrains 缓存', join(env.localAppData, 'JetBrains', '*', folder), { recursive: true }),
      t('developer-cache', 'JetBrains 缓存', join(env.appData, 'JetBrains', '*', folder), { recursive: true })
    ]),
    t('developer-cache', 'Git 配置锁', join(env.userProfile, '.gitconfig.lock')),
    t('developer-cache', 'GitHub CLI 过期缓存', join(env.appData, 'GitHub CLI'), { minAgeDays: 7, filePattern: '*.json' })
  ]
}

const loadWhitelistPatterns = async (env: ScannerEnvironment): Promise<string[]> => {
  const defaults = [
    join(env.localAppData, 'Microsoft', 'Windows', 'Explorer'),
    join(env.localAppData, 'Microsoft', 'Windows', 'Fonts'),
    join(env.appData, 'Microsoft', 'Windows', 'Recent'),
    join(env.localAppData, 'Packages', '*'),
    join(env.userProfile, '.vscode', 'extensions'),
    join(env.userProfile, '.nuget'),
    join(env.userProfile, '.cargo'),
    join(env.userProfile, '.rustup'),
    join(env.userProfile, '.m2', 'repository'),
    join(env.userProfile, '.gradle', 'caches', 'modules-2', 'files-*'),
    join(env.userProfile, '.ollama', 'models'),
    join(env.localAppData, 'JetBrains')
  ]

  try {
    const userWhitelist = await readFile(join(env.userProfile, '.config', 'mole', 'whitelist.txt'), 'utf8')
    return defaults.concat(
      userWhitelist.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    )
  } catch {
    return defaults
  }
}

const getProtectedRoots = (env: ScannerEnvironment): string[] => [
  env.windows,
  env.programFiles,
  env.programFilesX86,
  join(env.programFiles, 'Windows Defender'),
  join(env.programFilesX86, 'Windows Defender'),
  join(env.programData, 'Microsoft', 'Windows Defender'),
  join(env.userProfile, 'Desktop'),
  join(env.userProfile, 'Documents'),
  join(env.userProfile, 'Downloads')
]

const matchesWhitelist = (candidate: string, patterns: string[]): boolean => {
  const normalized = resolve(candidate)
  return patterns.some((pattern) => wildcardToRegExp(resolve(pattern)).test(normalized))
}

const expandPattern = async (pattern: string, signal?: AbortSignal): Promise<string[]> => {
  throwIfCancelled(signal)
  if (!pattern.includes('*') && !pattern.includes('?')) return [pattern]
  if (!isAbsolute(pattern)) return []

  const root = parse(pattern).root
  const segments = pattern.slice(root.length).split(/[\\/]+/).filter(Boolean)
  let paths = [root]

  for (const segment of segments) {
    throwIfCancelled(signal)
    const matcher = wildcardToRegExp(segment)
    const wildcard = segment.includes('*') || segment.includes('?')
    const next: string[] = []

    for (const base of paths) {
      throwIfCancelled(signal)
      if (!wildcard) {
        next.push(join(base, segment))
        continue
      }

      try {
        const entries = await readdir(base, { withFileTypes: true })
        for (const entry of entries) {
          throwIfCancelled(signal)
          if (matcher.test(entry.name)) next.push(join(base, entry.name))
        }
      } catch (error) {
        if (error instanceof ScanCancelledError) throw error
        // Missing or inaccessible wildcard parents simply produce no targets.
      }
    }

    paths = next
    if (paths.length === 0) break
  }

  return paths
}

const shouldIncludeFile = (name: string, stats: Stats, target: ScanTarget, now: Date): boolean => {
  if (target.filePattern && !wildcardToRegExp(target.filePattern).test(name)) return false
  if (target.minAgeDays !== undefined) {
    const cutoff = now.getTime() - target.minAgeDays * 24 * 60 * 60 * 1000
    if (stats.mtimeMs >= cutoff) return false
  }
  return true
}

export async function scanCleanableFiles(options: ScanOptions = {}): Promise<ScanResult> {
  throwIfCancelled(options.signal)
  const startedAt = new Date()
  const now = options.now ?? startedAt
  const env = options.environment ?? getScannerEnvironment()
  const targets = targetsFor(env)
  const whitelistPatterns = await loadWhitelistPatterns(env)
  throwIfCancelled(options.signal)
  const protectedRoots = getProtectedRoots(env)
  const groups = new Map<ScanCategoryId, ScanGroup>()
  const seen = new Set<string>()
  let skippedPaths = 0
  let errorCount = 0
  let totalBytes = 0
  let fileCount = 0

  const addFile = (target: ScanTarget, path: string, stats: Stats): void => {
    const canonical = normalizeForComparison(path)
    if (seen.has(canonical)) return
    seen.add(canonical)

    const item: ScanFileItem = {
      path,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      sourceLabel: target.label
    }
    const meta = categoryMeta[target.category]
    const group = groups.get(target.category) ?? {
      id: target.category,
      label: meta.label,
      description: meta.description,
      sizeBytes: 0,
      fileCount: 0,
      files: []
    }
    group.files.push(item)
    group.sizeBytes += item.sizeBytes
    group.fileCount += 1
    groups.set(target.category, group)
    totalBytes += item.sizeBytes
    fileCount += 1
  }

  const pathIsAllowed = (path: string): boolean => {
    if (protectedRoots.some((root) => isWithin(path, root)) || matchesWhitelist(path, whitelistPatterns)) {
      skippedPaths += 1
      return false
    }
    return true
  }

  const isProtected = (path: string): boolean => protectedRoots.some((root) => isWithin(path, root))

  for (const [targetIndex, target] of targets.entries()) {
    throwIfCancelled(options.signal)
    const expandedRoots = await expandPattern(target.pattern, options.signal)

    for (const root of expandedRoots) {
      throwIfCancelled(options.signal)
      // Some Mole whitelist entries protect the directory itself while allowing
      // explicitly targeted cache files below it (for example Explorer thumbnails).
      if (isProtected(root)) {
        skippedPaths += 1
        continue
      }

      let rootStats: Stats
      try {
        rootStats = await lstat(root)
        throwIfCancelled(options.signal)
      } catch (error) {
        if (error instanceof ScanCancelledError) throw error
        continue
      }
      if (rootStats.isSymbolicLink()) {
        skippedPaths += 1
        continue
      }
      if (target.rootMinAgeDays !== undefined) {
        const cutoff = now.getTime() - target.rootMinAgeDays * 24 * 60 * 60 * 1000
        if (rootStats.mtimeMs >= cutoff) continue
      }
      if (rootStats.isFile()) {
        if (pathIsAllowed(root) && shouldIncludeFile(root.split(/[\\/]/).at(-1) ?? root, rootStats, target, now)) {
          addFile(target, root, rootStats)
        }
        continue
      }
      if (!rootStats.isDirectory()) continue

      const stack = [root]
      while (stack.length > 0) {
        throwIfCancelled(options.signal)
        const directory = stack.pop()
        if (!directory) break
        let entries: Dirent[]
        try {
          entries = await readdir(directory, { withFileTypes: true })
          throwIfCancelled(options.signal)
        } catch (error) {
          if (error instanceof ScanCancelledError) throw error
          errorCount += 1
          continue
        }

        for (const entry of entries) {
          throwIfCancelled(options.signal)
          const candidate = join(directory, entry.name)
          if (!isWithin(candidate, root) || !pathIsAllowed(candidate)) continue
          if (entry.isSymbolicLink()) {
            skippedPaths += 1
            continue
          }
          if (entry.isDirectory()) {
            if (target.recursive !== false) stack.push(candidate)
            continue
          }
          if (!entry.isFile()) continue

          try {
            const stats = await lstat(candidate)
            throwIfCancelled(options.signal)
            if (!stats.isSymbolicLink() && shouldIncludeFile(entry.name, stats, target, now)) addFile(target, candidate, stats)
          } catch (error) {
            if (error instanceof ScanCancelledError) throw error
            errorCount += 1
          }
        }
      }
    }

    options.onProgress?.({
      completedTargets: targetIndex + 1,
      totalTargets: targets.length,
      currentLabel: target.label,
      filesFound: fileCount,
      bytesFound: totalBytes
    })
    throwIfCancelled(options.signal)
  }

  const orderedGroups = (Object.keys(categoryMeta) as ScanCategoryId[])
    .map((category) => groups.get(category))
    .filter((group): group is ScanGroup => Boolean(group))
    .map((group) => ({ ...group, files: group.files.sort((a, b) => b.sizeBytes - a.sizeBytes) }))

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    totalBytes,
    fileCount,
    groups: orderedGroups,
    skippedPaths,
    errorCount
  }
}
