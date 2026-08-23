# GPT2Markdown

Export ChatGPT conversations to clean Markdown files — fast, private, and fully local.

## What's New in v1.1.0

- New blue-purple GPT2Markdown product icon across the extension.
- Redesigned the conversation and history Popup views as a compact, single-surface interface.
- Added a Batch Export entry on conversation pages while keeping the existing history-page entry.
- Unified the visual language for the Batch List, Selection Dock, Batch Progress Overlay, and Settings page.
- No framework or dependency changes; export, parser, Markdown, download, and prefetch behavior remains unchanged.
- Local processing and privacy guarantees remain unchanged.

## Features

### Export Modes

- **Full Export** — One-click export of the current conversation via popup button or `Ctrl+Shift+E` (Mac: `MacCtrl+Shift+E`)
- **Selective Export** — Checkboxes injected beside each message allow exporting only selected messages. Select all, deselect, or pick specific ones
- **Batch Export** — Select and export multiple conversations at once from the ChatGPT history page. Conversations are grouped by project, with progress feedback and retry on failure

### Performance

- **Smart Prefetch** — Conversation data is preloaded in the background when you enter a page. By the time you click export, the data is already in memory — perceived latency drops to zero
- **SPA-aware** — Automatically refreshes cached data when navigating between conversations within the ChatGPT single-page app

### Output

- **Markdown Formatting** — Standard Markdown with proper handling of code blocks, LaTeX math, images, and tables
- **Reference Links** — Citation links are rendered with meaningful titles, not generic domain names
- **File Naming** — Auto-generated `YYYY-MM-DD-title.md` filenames
- **Save Options** — Choose between "always ask" (save dialog) or auto-save to a configurable subdirectory

### Privacy

- All processing happens locally in the browser
- No data ever leaves your machine
- No cookies, tokens, or credentials are read or stored
- Only accesses `chatgpt.com`

## Installation

### Developer Mode

1. Clone the repository:
   ```bash
   git clone https://github.com/fffangzhiyi/GPT2Markdown.git
   cd GPT2Markdown/src
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the `src/` directory
5. The extension icon appears in your toolbar

### Chrome Web Store

> Not yet available.

## Usage

1. Open [chatgpt.com](https://chatgpt.com) and enter any conversation
2. Click the extension icon in the toolbar, or press `Ctrl+Shift+E`
3. Choose an export mode — full, selective, or batch
4. The Markdown file downloads to your configured folder

### Settings

Right-click the extension icon → "Options", or click the settings link in the popup:
- **Save mode** — "Ask every time" (system save dialog) or "Auto-save" to a folder
- **Folder name** — Subdirectory for auto-saved files (default: `chatgpt-inbox`)
- **Keyboard shortcut** — Customizable at `chrome://extensions/shortcuts`

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript, zero dependencies
- ChatGPT Backend API (called in-page, no external servers)

## Privacy

- All data processing happens locally in the browser
- No data is collected, uploaded, or stored externally
- No cookies, tokens, or credentials are accessed
- Only the `chatgpt.com` domain is accessed

## License

MIT
