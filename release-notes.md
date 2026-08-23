## v1.1.0 (2026-08-23)

### Highlights

- Introduced the new blue-purple GPT2Markdown product icon.
- Added a Batch Export entry on conversation pages while retaining the existing history-page entry.

### UI Redesign

- Redesigned the conversation and history Popup views as compact, single-surface interfaces.
- Kept the existing Batch List design and behavior inside the single top-level Popup surface.
- Unified the visual language of the Selection Dock, Batch Progress Overlay, and Settings page.
- Fixed narrow-width Settings layouts so the Save button stays on one line and aligns with the folder input.

### Behavior and Compatibility

- Remains a Manifest V3 extension built with Vanilla JavaScript and no dependencies.
- Core export, parser, Markdown, download, and prefetch chains are unchanged.
- Local processing and privacy behavior are unchanged.

### Verification

- The full Node test suite passed with `node --test`.
