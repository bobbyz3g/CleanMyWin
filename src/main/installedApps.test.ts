import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDisplayIconPath, parseInstalledAppsPayload } from './installedApps.ts'

test('normalizes, deduplicates and sorts installed application data', () => {
  const result = parseInstalledAppsPayload(JSON.stringify({
    Apps: [
      { Name: 'Small App', Publisher: 'Example', Version: '1.0', SizeKB: 10, InstallDate: '20260810', Source: 'classic' },
      { Name: 'Large App', Publisher: 'Example', Version: '2.0', SizeKB: 2048, Source: 'classic' },
      { Name: 'Large App', Publisher: 'Example', Version: '2.0', SizeKB: 1024, Source: 'classic' },
      { Name: 'Store App', Source: 'store' },
      { Publisher: 'Missing name' }
    ],
    ErrorCount: 1
  }))

  assert.deepEqual(result.apps.map((app) => app.name), ['Large App', 'Small App', 'Store App'])
  assert.equal(result.apps[0]?.estimatedSizeBytes, 2 * 1024 * 1024)
  assert.equal(result.apps[1]?.installDate, '2026-08-10')
  assert.equal(result.apps[2]?.estimatedSizeBytes, null)
  assert.equal(result.errorCount, 1)
  assert.match(result.apps[0]?.id ?? '', /^[a-f0-9]{64}$/)
})

test('normalizes registry display icon paths without exposing icon indexes', () => {
  assert.equal(parseDisplayIconPath('"C:\\Program Files\\Example\\app.exe",0'), 'C:\\Program Files\\Example\\app.exe')
  assert.equal(parseDisplayIconPath('C:\\Apps\\example.dll, -12'), 'C:\\Apps\\example.dll')
  assert.equal(parseDisplayIconPath(null), null)
})
