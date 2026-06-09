# GPT2Markdown

一键将 ChatGPT 对话导出为干净的 Markdown 文件。

## 功能

- **快捷键导出**：在 ChatGPT 对话页按 `Ctrl+Shift+E`（Mac: `MacCtrl+Shift+E`），一键导出当前对话
- **弹窗导出**：点击浏览器工具栏图标，在弹窗中点击"导出当前对话"
- **Markdown 格式化**：自动转换为标准 Markdown，支持代码块、LaTeX 公式、图片、表格
- **文件命名**：自动生成 `YYYY-MM-DD-对话标题.md` 格式的文件名
- **保存方式可选**：支持每次弹出对话框选择位置，或自动保存到下载文件夹的子目录
- **导出历史**：设置页面显示最近 10 条导出记录
- **完全本地**：所有数据在浏览器内处理，不上传任何服务器

## 安装

### 开发者模式（当前阶段）

1. 下载或克隆本仓库：
   ```bash
   git clone https://github.com/fffangzhiyi/GPT2Markdown.git
   cd GPT2Markdown/src
   ```
2. 打开 Chrome，地址栏输入 `chrome://extensions`
3. 右上角开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择 `src/` 目录
5. 扩展图标出现在浏览器工具栏，安装完成

### Chrome Web Store（后续版本）

> 尚未上架，敬请期待。

## 使用

1. 打开 [chatgpt.com](https://chatgpt.com)，进入任意对话
2. 按 `Ctrl+Shift+E`（Mac: `MacCtrl+Shift+E`），或点击工具栏图标 →「导出当前对话」
3. 选择保存位置，Markdown 文件即下载到本地

### 设置

右键扩展图标 →「选项」，或点击弹窗中的「设置」链接：
- **保存方式**：选择"每次询问"弹出对话框，或"自动保存"到指定文件夹
- **文件夹名称**：自动保存时使用的下载子文件夹名（默认 `chatgpt-inbox`）
- **快捷键**：可在 `chrome://extensions/shortcuts` 中自定义

## 技术栈

- Chrome Extension Manifest V3
- 纯 JavaScript，无框架依赖
- ChatGPT Backend API（页面内调用，不走外部服务器）

## 隐私

- 所有数据处理在浏览器本地完成
- 不收集、不上传、不存储任何用户数据
- 不读取 Cookie、Token 或任何凭据
- 仅访问 chatgpt.com 域名

## 许可

MIT
