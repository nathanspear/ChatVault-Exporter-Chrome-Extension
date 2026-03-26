# ChatVault Exporter Extension

**Version**: 0.8.6

A Chrome extension for exporting AI chat conversations to JSON and Markdown formats. Supports single-chat and full project/space exports, optimized for Claude Projects.

## Supported Platforms

### Single-Chat Export ✅
- **ChatGPT** (chat.openai.com, chatgpt.com)
- **Claude.ai**
- **Google Gemini**
- **Perplexity.ai**

### Project/Space Export ✅
- **ChatGPT Projects**
- **Claude Projects**

### Not Supported
- **Perplexity Spaces** (single-thread export works, but Space export disabled due to performance issues)
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

**Single chat** — works on all five supported platforms (ChatGPT, Claude.ai, Google Gemini, Perplexity.ai, and Grok): Open any conversation, click the ChatVault Exporter icon in your toolbar, choose your format (Markdown, JSON, or ZIP), and click Export Chat. The file saves to your Downloads folder.

**Full project export** — ChatGPT and Claude.ai only: Open a project, scroll down to load all chats in the sidebar, click the extension icon, type a project name in the field provided, and click Export Project. Allow about 4–5 seconds per chat. You'll get a flat folder (or ZIP) containing all chats plus a project index file.

### Using your exported files

- **Read or search locally:** Any .md file opens in a text editor or any Markdown viewer. The files are plain text and human-readable without any special tools.
- **Add to a project:** Open or create a project in your AI tool of choice, and add your .md files to the project knowledge or files section. The AI can reference that content across all conversations in that project. You can also paste the contents of an .md file directly into a chat if you just need quick access to one conversation.
- **JSON files:** If you exported JSON, those files contain the full structured conversation data and are useful if you want to import into another system later. For most users, Markdown is all you need.

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
- **Missing chats in project export**: Scroll through the entire project to load all items, then refresh the extension
- **Export stalls**: The extension waits between chats to avoid rate limiting. This is normal.
- **Can't find exported files**: Check your browser's default Downloads folder, or open `chrome://downloads` to see the exact save location

## Privacy

- All extraction happens locally in your browser
- No data is sent to external servers
- No analytics or telemetry
- Conversations never leave your device

## Version History

**0.8.6** - Feature: Live batch-export progress in the popup (processed / total, left to go, exported vs failed, last chat title).
**0.8.5** - Fix: "Export Chat" button now disabled on home/Recents pages (prevents "No conversation turns found" error). Recents chat list now always loads on Claude/ChatGPT home pages.
**0.8.4** - Feature: Auto-scroll Recents list before discovery to expose all lazy-loaded chats. Added "Export all", "Refresh list" button, and improved hint text for individual-chat (Recents) mode.
**0.8.3** - Removed: Perplexity Spaces support (too slow/unreliable). Single-thread export still works.

**0.8.2** - Debug: Added logging for Perplexity scroll diagnostics

**0.8.1** - Bugfix: Perplexity extraction now scrolls to load all content (fixed regression)

**0.8.0** - Feature: Platform name now included in all filenames (e.g., `ChatVault-export--ChatGPT--ProjectName--ChatName--Date.md`)

**0.7.5** - Bugfix: Perplexity Space export optimized to avoid 30s timeout (skip clipboard, longer waits)

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
