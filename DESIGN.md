# CleanMyWin design direction

## 1. Visual theme and atmosphere

界面应当安静、可靠、熟悉。Windows 11 的浅色分层和系统控件负责建立信任，CleanMyMac 式的大型状态焦点负责让“扫描并释放空间”一眼可懂。

## 2. Color palette and roles

- Canvas: `oklch(96.8% 0.006 245)`, Mica 回退背景。
- Sidebar: `oklch(94.3% 0.009 245)`, 导航层。
- Surface: `oklch(99.2% 0.003 245)`, 主内容层。
- Text: `oklch(24% 0.018 245)`, 主要文字。
- Muted: `oklch(51% 0.018 245)`, 辅助文字。
- Accent: `oklch(61% 0.145 236)`, 扫描和当前状态。
- Success: `oklch(63% 0.135 151)`, 安全状态。
- Danger: `oklch(56% 0.19 28)`, 仅用于最终清理确认，不用于日常主操作。

## 3. Typography rules

使用 Windows 系统的 Segoe UI Variable，确保中文和系统控件具有原生度。标题 32px/650，区域标题 20px/650，正文 14px/400，数字采用等宽数字特性。

## 4. Component styling

主按钮使用 8px 圆角和实色强调色，按下缩放至 0.96。导航项与次要按钮使用 8px 圆角，信息面板使用 14px 圆角。扫描结果通过原生复选框语义支持文件级和分类级选择。永久删除必须使用聚焦确认窗口，确认按钮才使用危险色。所有交互目标至少 40px。

## 5. Layout principles

固定左侧导航与弹性工作区。扫描前负责说明状态、触发扫描和解释范围；扫描后切换为结果核对、选择范围和确认清理。选择容量与清理操作固定在结果区标题层，文件列表只承担逐项检查。空间刻度为 4、8、12、16、24、32、48。

## 6. Depth and elevation

主要通过背景亮度台阶区分层级，只对悬浮面板使用柔和双层阴影。Acrylic 仅保留给暂态浮层，不作为卡片效果。

## 7. Do and don't

- 保持一个明确的主操作。
- 危险操作必须二次确认。
- 扫描结束后默认不选择任何文件。
- 只允许清理最近一次扫描返回且未发生变化的文件。
- 不用红色制造焦虑。
- 不把每段内容都装进相同卡片。
- 不使用紫蓝渐变、玻璃卡片或弹跳动画。

## 8. Responsive behavior

窗口最小宽度 920px。低于 1040px 时导航缩窄并隐藏辅助说明，内容列保持可读宽度。键盘焦点始终可见。

## 9. Agent prompt guide

颜色：canvas `oklch(96.8% 0.006 245)`，sidebar `oklch(94.3% 0.009 245)`，surface `oklch(99.2% 0.003 245)`，accent `oklch(61% 0.145 236)`。创建组件时使用 Segoe UI Variable、8px 控件圆角、14px 面板圆角、160ms `cubic-bezier(0.16,1,0.3,1)` 变换，并保持 40px 最小点击区域。
