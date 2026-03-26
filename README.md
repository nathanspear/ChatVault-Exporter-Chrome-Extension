# ChatVault Exporter — Chrome extension

**Version:** 0.9.3 (see `manifest.json`)

Export AI chat conversations to **Markdown** and/or **JSON** from the browser. Supports single-chat export on several platforms and **project batch export** on ChatGPT and Claude. On **ChatGPT**, you can also download **file attachments** from the open conversation.

Full project documentation (CLI, archive formats, ingest): [repository root README](../README.md).

**Standalone repo:** This folder is mirrored as its own GitHub repo for extension-only users:  
[github.com/nathanspear/ChatVault-Exporter-Chrome-Extension](https://github.com/nathanspear/ChatVault-Exporter-Chrome-Extension)

---

## Supported platforms

### Single-chat export

| Platform | Export chat | Download attachments |
|----------|-------------|------------------------|
| **ChatGPT** (`chatgpt.com`, `chat.openai.com`) | Yes | Yes (this chat only) |
| **Claude.ai** | Yes | No |
| **Google Gemini** | Yes | No |
| **Perplexity** | Yes | No |
| **Grok** (`grok.com`, `x.com/i/grok`) | Yes | No |

### Project / batch export

- **ChatGPT Projects** — select chats, export to a flat folder (+ optional ZIP).
- **Claude Projects** — same pattern for Claude project pages.

**Not supported:** Perplexity Spaces batch export (disabled for reliability). Gemini has no project export in this extension.

---

## Features

- **Single chat** — Markdown, JSON, or both; optional project name for filenames.
- **Project export** — ChatGPT/Claude: batch export with `00-project-index.md`, `manifest.json`, optional ZIP.
- **ChatGPT attachments** — **Download chat attachments** button (on a `/c/...` chat): discovers file URLs (DOM + shadow roots + in-page React props when needed), filters out common UI CDN noise, resolves filenames/extensions (URL hints + `Content-Disposition` / `Content-Type` via `HEAD`/`Range` requests in the background worker), falls back to clicking native file controls when URLs are not exposed.
- **Privacy-first** — No telemetry. Extraction runs in your browser; downloads use your normal browser session cookies for the same origins you are already logged into.

---

## Permissions (Manifest V3)

| Permission | Why |
|------------|-----|
| `activeTab` | Interact with the current tab when you use the popup. |
| `downloads` | Save exports and attachment files to your Downloads folder. |
| `scripting` | Run a **page-context** script on ChatGPT to read file URLs held in React (not visible in plain HTML). Used only for attachment discovery when you click **Download chat attachments**. |
| `storage` | Remember your project name and export toggles. |
| `clipboardRead` | Optional copy-based extraction on some sites (where enabled). |
| `tabs` | Project export navigates between chat URLs. |
| `notifications` | Optional completion notices for batch export. |

**Host permissions** include `chatgpt.com`, `chat.openai.com`, `*.oaiusercontent.com` (ChatGPT file CDN), and other supported chat hosts. Attachment downloads and filename resolution issue **HTTPS requests only to those origins** (same as the open tab).

---

## Installation

1. Open Chrome → `chrome://extensions/`
2. Turn on **Developer mode**
3. **Load unpacked** → select this **`chrome-extension`** folder (or the repo root if you cloned [ChatVault-Exporter-Chrome-Extension](https://github.com/nathanspear/ChatVault-Exporter-Chrome-Extension) alone).

---

## Usage

### Export the conversation

1. Open a conversation on a supported site.
2. Click the **ChatVault Exporter** icon.
3. Choose **Include Markdown** / **Include JSON** (and project name for filenames).
4. Click **Export Chat**.

### Export a project (ChatGPT or Claude)

1. Open the project and load the chat list (scroll if needed).
2. Open the extension, set **Project name**, select chats, export.

### Download ChatGPT attachments (files in this chat)

1. Stay on the conversation page (`…/c/<chat-id>`).
2. Open the extension → **Download chat attachments**.
3. Files go under `Downloads/ChatVault-files--<ProjectSlug>--<ChatSlug>--YYYY-MM-DD/`.

If nothing is found, refresh the tab, ensure file chips are visible, and try again. Pure `blob:` URLs cannot be read by extensions; use ChatGPT’s UI for those.

### Using exports with the ChatVault CLI

After exporting a project folder:

```bash
chatvault ingest --source extension-export --path ./ChatVault-export--ProjectName--YYYY-MM-DD
chatvault export --format archive --out ./archive
```

See [EXTENSION_INTEGRATION.md](../EXTENSION_INTEGRATION.md) in the repo.

---

## Filename patterns

**Chat export:**

`ChatVault-export--<Platform>--<ProjectSlug>--<ChatSlug>--YYYY-MM-DD.md` (and `.json` if enabled)

**Attachment folder:**

`ChatVault-files--<ProjectSlug>--<ChatSlug>--YYYY-MM-DD/<filename>`

Project slug defaults to **Unassigned** if the field is blank.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| **Content script not loaded** | Refresh the page; ensure the site URL is allowed. |
| **No conversation turns found** | Be on an actual chat URL with messages visible; hard-refresh. |
| **Export Chat disabled** | Open a conversation (not only home/Recents). |
| **Attachments: nothing downloaded** | Reload the chat tab; open the extension from that tab; ensure files appear in the UI. |
| **Attachments: wrong/extra files** | Update to the latest extension; older builds could pick up UI CDN assets. Current builds filter `oaiusercontent.com` links to real attachment signals. |
| **Project export incomplete** | Scroll the sidebar to load all chats before exporting. |

---

## Privacy

- Conversation text extraction runs locally in the page.
- No third-party analytics or telemetry.
- Attachment handling uses **your browser’s cookies** for `chatgpt.com` / OpenAI CDNs only, same as normal downloads.

---

## Version history (recent)

| Version | Notes |
|---------|--------|
| **0.9.3** | Stricter `oaiusercontent.com` filtering (fewer UI false positives); docs aligned. |
| **0.9.2** | Server-assisted filenames (`Content-Disposition`, MIME) for attachments. |
| **0.9.1** | MAIN-world React harvest + `scripting` permission for attachment URLs. |
| **0.9.0** | Deep DOM/shadow scan; click fallback; embedded URL extraction. |
| **0.8.x** | ChatGPT turn extraction fallbacks (`data-message-author-role`); attachment MVP. |

Older entries are listed in git history and prior releases.
