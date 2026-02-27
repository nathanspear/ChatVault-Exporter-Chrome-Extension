# ChatVault Exporter Extension

**Version**: 0.7.4

A Chrome extension for exporting AI chat conversations to JSON and Markdown formats. Supports single-chat and full project/space exports, optimized for Claude Projects.

## Supported Platforms

### Single-Chat Export ✅
- **ChatGPT** (chat.openai.com, chatgpt.com)
- **Claude.ai**
- **Google Gemini**
- **Perplexity.ai**
- **Grok** (grok.com, x.com/i/grok)

### Project/Space Export ✅
- **ChatGPT Projects**
- **Claude Projects**
- **Perplexity Spaces**

### Not Yet Supported
- **Gemini Projects** (Gemini doesn't have projects yet)

## Features

- **Single Chat Export**: Export the current chat as Markdown, JSON, or both
- **Project Export (ChatGPT)**: Export an entire ChatGPT project as a flat folder structure
- **Claude-Optimized**: Flat folder structure with index and summary files, perfect for Claude Projects
- **Flexible Formats**: Toggle Markdown, JSON, and ZIP archive options independently
- **User-Controlled Project Names**: Manual project name input for consistent, predictable filenames
- **ChatVault Compatible**: Project exports are formatted for direct import into ChatVault Exporter
- **Privacy First**: Zero network requests, zero telemetry — all processing happens locally in your browser

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `chrome-extension/` folder from this repository

## Usage

### Single Chat Export

1. Navigate to any supported AI chat conversation (ChatGPT, Claude, Gemini, Perplexity, Grok)
2. Click the ChatVault Exporter extension icon
3. Configure export options:
   - **Include Markdown** (default: on) — Exports conversation as readable Markdown
   - **Include JSON** (default: off) — Exports raw conversation data as JSON
   - **Create ZIP archive** (default: off) — Packages exports into a ZIP file
4. Click "Export Chat"
5. Files are saved directly to your browser's **default Downloads folder** (no prompt)

### Project Export (ChatGPT, Claude, Perplexity)

#### ChatGPT Projects
1. Navigate to ChatGPT and select a project from the sidebar
2. **Important**: Scroll through the project to load all chats in the main pane
3. Click the ChatVault Exporter extension icon
4. Enter a **Project Name** in the text field (used in all filenames and folder names)
5. Configure export options
6. Click "Export Project"
7. Wait for the export to complete (approximately 4–5 seconds per chat)
8. All files are saved directly to your browser's **default Downloads folder**

#### Claude Projects
1. Navigate to `claude.ai/projects` or open a specific Claude Project
2. Wait for conversations to load in the main area
3. Click the ChatVault Exporter extension icon
4. Enter a **Project Name** in the text field
5. Configure export options
6. Click "Export Project"
7. Wait for the export to complete
8. All files are saved directly to your browser's **default Downloads folder**

#### Perplexity Spaces
1. Navigate to `perplexity.ai/spaces` or open a specific Perplexity Space
2. Wait for threads to load
3. Click the ChatVault Exporter extension icon
4. Enter a **Space Name** in the text field
5. Configure export options
6. Click "Export Space"
7. Wait for the export to complete
8. All files are saved directly to your browser's **default Downloads folder**

**Output Structure** (flat folder, optimized for Claude Projects):
```
ChatVault-export--<ProjectName>--<YYYY-MM-DD>/
  00-project-index.md          # Table of contents with chat list
  00-project-summary.md        # Summary template
  ChatVault-export--<ProjectName>--<ChatName>--<YYYY-MM-DD>.md
  ChatVault-export--<ProjectName>--<ChatName>--<YYYY-MM-DD>.json (if enabled)
  manifest.json                # Metadata for automation
```

If "Create ZIP archive" is enabled, all files are packaged into a single ZIP file.

### Using with ChatVault

After exporting (single chat or project):

1. If you created a ZIP, extract it first
2. Run ChatVault ingest:
   ```bash
   chatvault ingest --source extension-export --path /path/to/ChatVault-export--ProjectName--YYYY-MM-DD
   ```
3. Export to your desired format:
   ```bash
   chatvault export --format archive --out ./archive
   chatvault export --format claude-project --out ./claude
   chatvault export --format html --out ./viewer
   ```

## Filename Format

All exported files follow this strict naming convention:

```
ChatVault-export--<ProjectName>--<ChatName>--<YYYY-MM-DD>.<ext>
```

- **ProjectName**: User-supplied from the extension UI (defaults to "Unassigned" if blank)
- **ChatName**: Extracted from the conversation title
- **Date**: Export date (not chat creation date)
- **Separators**: Exactly two hyphens (`--`)

## Troubleshooting

- **"Content script not loaded"**: Refresh the page and try again
- **"No conversation turns found"**: Make sure you're on a conversation page with visible messages
- **Project export button disabled**: 
  - ChatGPT: Select a project and ensure chats are loaded in the main pane
  - Claude: Open a project page (`claude.ai/project/...`) to see conversations
  - Perplexity: Open a space page (`perplexity.ai/spaces/...`) to see threads
- **Missing chats in project export**: Scroll through the entire project/space to load all items, then refresh the extension
- **Export stalls**: The extension waits between chats to avoid rate limiting. This is normal.
- **Can't find exported files**: Check your browser's default Downloads folder, or open `chrome://downloads` to see the exact save location

## Privacy

- All extraction happens locally in your browser
- No data is sent to external servers
- No analytics or telemetry
- Conversations never leave your device

## Version History

**0.7.4** - Bugfix: Claude projects now show only chats in current project (not sidebar recents)

**0.7.3** - Bugfix: Claude project pages now recognized, Perplexity shows only threads in current space (not sidebar)

**0.7.2** - Bugfix: Perplexity Spaces export now works (fixed response format normalization)

**0.7.1** - Bugfix: Single-chat export on Claude now works correctly (loadProjectInfo no longer interferes)

**0.7.0** - Claude Projects and Perplexity Spaces support: export entire projects/spaces with all conversations/threads

0.6.10 - Single-chat exports download directly to Downloads folder (no Save As dialog)

0.6.9 - Perplexity.ai single-chat support

0.6.8 - Rebrand to ChatVault Exporter

0.6.7 - Documentation updates

0.6.6 - Reliable project export: wait for conversation DOM, retry failed chats (up to 3 attempts)

0.6.5 - Security hardening: path traversal protection, XSS prevention, improved error handling
