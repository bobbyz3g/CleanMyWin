# CleanMyWin

CleanMyWin 是一个面向个人用户的 Windows 桌面清理工具。项目使用 Electron、React、TypeScript 和 electron-vite，界面结合 Windows 11 Fluent 的分层方式与 CleanMyMac 的单一主操作体验。

当前版本提供可运行的应用外壳、磁盘概览和只读文件扫描。扫描范围参考 Mole `clean --dry-run` 的默认逻辑，结果按类别列出每一个候选文件的路径和大小。它不会删除或修改任何文件。

## 开发

需要 Node.js 22.12 或更高版本，以及 pnpm 11。

```powershell
pnpm install
pnpm dev
```

`pnpm install` 会在首次安装时下载项目锁定版本的 Electron 运行时。该运行时仅存放在本项目的 `node_modules` 中。

## 校验与构建

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

## 目录

```text
src/main       Electron 主进程与系统 API
src/preload    安全的渲染进程桥接层
src/renderer   React 用户界面
src/shared     跨进程共享类型
```

## 安全原则

- 渲染进程不启用 Node.js 集成。
- 仅通过 `contextBridge` 暴露最小 API。
- 扫描与清理分离，默认只扫描。
- 桌面、文档、下载目录以及符号链接不会进入扫描结果。
- 当前没有清理 API 或清理按钮，所有结果仅供复核。

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)，SPDX 标识为 `GPL-3.0-only`。
