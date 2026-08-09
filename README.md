# CleanMyWin

CleanMyWin 是一个面向个人用户的 Windows 桌面清理工具。项目使用 Electron、React、TypeScript 和 electron-vite，界面结合 Windows 11 Fluent 的分层方式与 CleanMyMac 的单一主操作体验。

当前版本提供可运行的应用外壳、磁盘概览、安全的扫描交互演示和受限的 preload IPC。它不会删除任何文件，后续实现真实清理前必须加入白名单、预览、确认和可恢复机制。

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
- 清理结果必须可复核，高风险位置永不默认选择。
