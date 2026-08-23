# Changelog

## v1.1.0 — 2026-08-23

### Added

- New blue-purple GPT2Markdown product icon for the extension and branded surfaces.
- New conversation-page Batch Export entry, alongside the existing history-page entry.

### Changed

- Redesigned the conversation and history Popup views as compact, single-surface white interfaces.
- Unified the visual language across the Batch List, Selection Dock, Batch Progress Overlay, and Settings page.
- Kept the project on Manifest V3 and Vanilla JavaScript with no new framework or dependency.
- Preserved the existing export, parser, Markdown, download, and prefetch business chains, as well as local processing and privacy behavior.

### Fixed

- Aligned the Settings folder input and Save button at narrow widths so the button stays on one line and matches the input height.

### Tested

- Verified the complete Node test suite after the release updates.

## v0.1.0 — 2026-06-09

MVP 首个版本，实现 ChatGPT 对话一键导出为 Markdown 的核心功能。

### 新增
- 快捷键 `Ctrl+Shift+E` 一键导出当前 ChatGPT 对话为 Markdown
- Popup 弹窗界面（260px），三态按钮（默认/导出中/完成）+ 错误中文提示
- 调用 ChatGPT Backend API 获取对话数据，遍历消息树生成结构化的 Markdown
- Markdown 格式化：支持文本、代码块（带语言标注）、LaTeX 公式、图片、表格
- 自动生成文件名（`YYYY-MM-DD-对话标题.md`），过滤非法字符
- 设置页面：保存方式选择（每次询问 / 自动保存到子文件夹）、文件夹名称配置、导出历史列表
- 插件品牌图标（16/48/128px）
- 语音/多模态消息占位符提示
- 79 个自动化单元测试覆盖核心模块

### 修复
- auth token 获取：通过 `/api/auth/session` 获取 accessToken，带内存缓存
- o-series 模型思考消息产生的空段落过滤
- 多模态 content.parts 中非字符串对象的 `[object Object]` 问题
- code fence 内 `$` 被数学渲染器误解析为 LaTeX 分隔符
- 语音/多模态对话导出为空的问题
- 下载文件夹配置未生效（folderName 链路 + Chrome 安全策略 `download` 属性 `/` 替换）

### 已知限制
- "每次询问"保存模式下，系统对话框不记住上次保存目录（Chrome API 限制）
