import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { extname, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import type { InstalledApplication, InstalledAppsResult, InstalledAppSource } from '../shared/contracts'

const execFileAsync = promisify(execFile)

interface RawInstalledApp {
  Name?: unknown
  Publisher?: unknown
  Version?: unknown
  SizeKB?: unknown
  InstallDate?: unknown
  Source?: unknown
  IconPath?: unknown
}

interface RawInstalledAppsResult {
  Apps?: unknown
  ErrorCount?: unknown
}

interface ParsedInstalledApps {
  result: Omit<InstalledAppsResult, 'scannedAt'>
  iconCandidates: Map<string, string>
}

let installedAppIconCandidates = new Map<string, string>()
let installedAppIconCache = new Map<string, Promise<string | null>>()

const discoveryScript = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$protectedApps = @(
  'Microsoft Windows',
  'Windows Feature Experience Pack',
  'Microsoft Edge',
  'Microsoft Edge WebView2',
  'Windows Security',
  'Microsoft Visual C++ *',
  'Microsoft .NET *',
  '.NET Desktop Runtime*',
  'Microsoft Update Health Tools',
  'NVIDIA Graphics Driver*',
  'AMD Software*',
  'Intel*Driver*'
)
function Test-ProtectedApp([string]$Name) {
  foreach ($pattern in $protectedApps) {
    if ($Name -like $pattern) { return $true }
  }
  return $false
}

function Resolve-StoreLogo([string]$InstallLocation, [string]$RelativePath) {
  if ([string]::IsNullOrWhiteSpace($InstallLocation) -or [string]::IsNullOrWhiteSpace($RelativePath)) { return $null }
  try {
    $exact = Join-Path $InstallLocation $RelativePath
    if (Test-Path -LiteralPath $exact -PathType Leaf) { return $exact }
    $directory = Split-Path -Parent $exact
    $baseName = [IO.Path]::GetFileNameWithoutExtension($exact)
    $extension = [IO.Path]::GetExtension($exact)
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { return $null }
    $variant = Get-ChildItem -LiteralPath $directory -File -Filter "$baseName*$extension" |
      Sort-Object @{ Expression = { if ($_.Name -match 'targetsize-48|scale-200') { 0 } elseif ($_.Name -match 'scale-100') { 1 } else { 2 } } } |
      Select-Object -First 1
    if ($variant) { return $variant.FullName }
  } catch { }
  return $null
}

$apps = [System.Collections.Generic.List[object]]::new()
$errorCount = 0
$registryPaths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($path in $registryPaths) {
  try {
    foreach ($item in @(Get-ItemProperty -Path $path)) {
      $name = [string]$item.DisplayName
      $uninstallString = [string]$item.UninstallString
      if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($uninstallString)) { continue }
      if ($item.SystemComponent -eq 1 -or $item.ReleaseType -match 'Update|Hotfix|Security Update') { continue }
      if (Test-ProtectedApp $name) { continue }
      $sizeKB = 0
      if ($item.EstimatedSize -as [long]) { $sizeKB = [long]$item.EstimatedSize }
      $apps.Add([pscustomobject]@{
        Name = $name
        Publisher = if ($item.Publisher) { [string]$item.Publisher } else { $null }
        Version = if ($item.DisplayVersion) { [string]$item.DisplayVersion } else { $null }
        SizeKB = $sizeKB
        InstallDate = if ([string]$item.InstallDate -match '^\d{8}$') { [string]$item.InstallDate } else { $null }
        Source = 'classic'
        IconPath = if ($item.DisplayIcon) { [Environment]::ExpandEnvironmentVariables([string]$item.DisplayIcon) } else { $null }
      })
    }
  } catch { $errorCount++ }
}

try {
  foreach ($package in @(Get-AppxPackage | Where-Object { -not $_.IsFramework -and $_.SignatureKind -ne 'System' })) {
    $name = [string]$package.Name
    $logoPath = $null
    try {
      $manifest = Get-AppxPackageManifest -Package $package.PackageFullName
      $displayName = [string]$manifest.Package.Properties.DisplayName
      if ($displayName -and -not $displayName.StartsWith('ms-resource:')) { $name = $displayName }
      $application = @($manifest.Package.Applications.Application)[0]
      $logoPath = Resolve-StoreLogo ([string]$package.InstallLocation) ([string]$application.VisualElements.Square44x44Logo)
    } catch { }
    if ([string]::IsNullOrWhiteSpace($name) -or (Test-ProtectedApp $name)) { continue }
    $apps.Add([pscustomobject]@{
      Name = $name
      Publisher = if ($package.Publisher) { [string]$package.Publisher } else { $null }
      Version = if ($package.Version) { [string]$package.Version } else { $null }
      SizeKB = 0
      InstallDate = $null
      Source = 'store'
      IconPath = $logoPath
    })
  }
} catch { $errorCount++ }

[pscustomobject]@{ Apps = @($apps); ErrorCount = $errorCount } | ConvertTo-Json -Depth 4 -Compress
`

const asOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const parseInstallDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

export const parseDisplayIconPath = (value: unknown): string | null => {
  const raw = asOptionalString(value)
  if (!raw) return null
  const quoted = raw.match(/^"([^"]+)"(?:\s*,\s*-?\d+)?$/)
  if (quoted?.[1]) return quoted[1]
  return raw.replace(/\s*,\s*-?\d+\s*$/, '').trim() || null
}

const createAppId = (source: InstalledAppSource, name: string, version: string | null, publisher: string | null): string =>
  createHash('sha256').update(`${source}\u0000${name}\u0000${version ?? ''}\u0000${publisher ?? ''}`).digest('hex')

const parseInstalledApps = (payload: string): ParsedInstalledApps => {
  const parsed = JSON.parse(payload.replace(/^\uFEFF/, '').trim()) as RawInstalledAppsResult
  const rawApps = Array.isArray(parsed.Apps) ? parsed.Apps : parsed.Apps ? [parsed.Apps] : []
  const deduplicated = new Map<string, InstalledApplication>()
  const iconCandidates = new Map<string, string>()

  for (const candidate of rawApps) {
    if (!candidate || typeof candidate !== 'object') continue
    const raw = candidate as RawInstalledApp
    const name = asOptionalString(raw.Name)
    if (!name) continue
    const publisher = asOptionalString(raw.Publisher)
    const version = asOptionalString(raw.Version)
    const source: InstalledAppSource = raw.Source === 'store' ? 'store' : 'classic'
    const sizeKB = typeof raw.SizeKB === 'number' && Number.isFinite(raw.SizeKB) && raw.SizeKB > 0 ? raw.SizeKB : null
    const id = createAppId(source, name, version, publisher)
    const app: InstalledApplication = {
      id,
      name,
      publisher,
      version,
      estimatedSizeBytes: sizeKB === null ? null : Math.round(sizeKB * 1024),
      installDate: parseInstallDate(raw.InstallDate),
      source
    }
    const existing = deduplicated.get(id)
    if (!existing || (app.estimatedSizeBytes ?? 0) > (existing.estimatedSizeBytes ?? 0)) {
      deduplicated.set(id, app)
      const iconPath = parseDisplayIconPath(raw.IconPath)
      if (iconPath) iconCandidates.set(id, iconPath)
      else iconCandidates.delete(id)
    }
  }

  return {
    result: {
      apps: [...deduplicated.values()].sort((a, b) => {
        const sizeDifference = (b.estimatedSizeBytes ?? -1) - (a.estimatedSizeBytes ?? -1)
        return sizeDifference || a.name.localeCompare(b.name, 'zh-CN')
      }),
      errorCount: typeof parsed.ErrorCount === 'number' ? parsed.ErrorCount : 0
    },
    iconCandidates
  }
}

export function parseInstalledAppsPayload(payload: string): Omit<InstalledAppsResult, 'scannedAt'> {
  return parseInstalledApps(payload).result
}

export async function getInstalledApps(): Promise<InstalledAppsResult> {
  if (process.platform !== 'win32') return { scannedAt: new Date().toISOString(), apps: [], errorCount: 0 }

  const powershell = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  const { stdout } = await execFileAsync(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', discoveryScript],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 60_000, windowsHide: true }
  )
  const parsed = parseInstalledApps(String(stdout))
  installedAppIconCandidates = parsed.iconCandidates
  installedAppIconCache = new Map()
  return { scannedAt: new Date().toISOString(), ...parsed.result }
}

export async function getInstalledAppIcon(appId: string): Promise<string | null> {
  const candidate = installedAppIconCandidates.get(appId)
  if (!candidate || !isAbsolute(candidate)) return null
  const cached = installedAppIconCache.get(appId)
  if (cached) return cached

  const iconPromise = (async (): Promise<string | null> => {
    try {
      const { app, nativeImage } = await import('electron')
      const extension = extname(candidate).toLocaleLowerCase()
      const fileImage = ['.png', '.jpg', '.jpeg', '.ico'].includes(extension)
        ? nativeImage.createFromPath(candidate)
        : await app.getFileIcon(candidate, { size: 'normal' })
      if (fileImage.isEmpty()) return null
      return fileImage.resize({ width: 28, height: 28, quality: 'best' }).toDataURL()
    } catch {
      return null
    }
  })()
  installedAppIconCache.set(appId, iconPromise)
  return iconPromise
}
