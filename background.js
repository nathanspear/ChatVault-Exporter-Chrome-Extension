// =============================================================================
// ChatVault — Background Service Worker  v0.6.10
// =============================================================================
// Handles file downloads (content scripts can't use chrome.downloads directly).
// Zero network requests. No telemetry. No phone-home.
//
// What changed in v0.6.10 vs v0.6.9:
//   • (Version bump for documentation updates)
//
// What changed in v0.6.9 vs v0.6.8:
//   • Added Perplexity.ai support (perplexity.ai, www.perplexity.ai).
//
// What changed in v0.6.8 vs v0.6.7:
//   • Rebrand: extension name "Chat Vault Exporter"; default_title for hover tooltip; CV icons.
//
// What changed in v0.6.7 vs v0.6.6:
//   • Single-chat exports now use saveAs: false (no Save As dialog).
//     Files download directly to browser's default Downloads folder, matching project export behavior.
//
// What changed in v0.6.6 vs v0.6.5:
//   • Reliable project export: wait for conversation DOM ready, retry failed chats (up to 3 attempts).
//   • Track and report failed chats in UI and 00-project-index.md.
//   • Clipboard save/restore in content.js to prevent "Failed to copy" messages.
//
// What changed in v0.6.4 vs v0.6.3:
//   • Info tooltips open below the icon so top text is not clipped; arrow points up.
//   • Tooltips use min/max width (280px–400px) for consistent height-to-width ratio.
//
// What changed in v0.6.0 vs v0.5.1:
//   • Export layout changed from ZIP-only to flat folder (browser-native).
//     Output: ChatVault-export--<ProjectSlug>--<YYYY-MM-DD>/  (one folder per export run)
//     Each chat becomes a discrete .md file inside the folder.
//   • ZIP is now optional (createZip flag, off by default).
//   • JSON output is now optional (includeJson flag, off by default).
//     Avoids cluttering Downloads when machine-readable data is not needed.
//   • handleDownload() prefers data URLs for payloads ≤ 1.5 MB.
//     Blob URLs can become invalid if the service worker is suspended between
//     the download() call and the browser actually fetching the URL.
//   • Project export now emits 00-project-index.md + 00-project-summary.md
//     as scaffolding files so the exported folder is self-documenting.
//   • triggerDownload() extracted as a shared helper (DRY).
// =============================================================================

importScripts('jszip.min.js');
importScripts('filename-builder.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'getTabInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({ url: tabs[0].url, id: tabs[0].id });
      } else {
        sendResponse({ url: null, id: null });
      }
    });
    return true;
  }

  if (message.action === 'exportProject') {
    handleProjectExport(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Data URLs work even if the service worker is killed; blob URLs can become invalid.
const DATA_URL_MAX_CHARS = 1500000; // ~1.5 MB

// handleDownload is used for single-chat exports.
// Uses saveAs: false to download directly to browser's Downloads folder (no dialog),
// matching project export behavior.
async function handleDownload({ content, filename, mimeType }) {
  try {
    const len = typeof content === 'string' ? content.length : (content && content.size) || 0;
    let url;

    if (len <= DATA_URL_MAX_CHARS && typeof content === 'string') {
      const base64 = btoa(unescape(encodeURIComponent(content)));
      url = `data:${mimeType};base64,${base64}`;
    } else {
      const blob = new Blob([content], { type: mimeType });
      url = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(url), 15_000);
    }

    const downloadId = await chrome.downloads.download({ url, filename, saveAs: false });
    return { success: true, downloadId };
  } catch (err) {
    console.error('[ChatVault] handleDownload failed:', err);
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Project Export — flat folder layout
// ---------------------------------------------------------------------------
// Output folder: ChatVault-export--<ProjectSlug>--<YYYY-MM-DD>/
// Contents:
//   00-project-index.md          — always generated
//   00-project-summary.md        — template placeholder
//   manifest.json                — lightweight index
//   ChatVault-export--P--C--date.md    — always (one per chat)
//   ChatVault-export--P--C--date.json  — only if includeJson === true
// If createZip === true, a ZIP is also created alongside the flat files.
// ---------------------------------------------------------------------------

// slugForExport and buildExportFilename are provided by filename-builder.js.
const extensionVersion = '0.7.1';

async function handleProjectExport({ project, userProjectName, chats, tabId, includeMarkdown = true, includeJson = false, createZip = false }) {
  const authorizedProjectName = (userProjectName || '').trim() || null;
  console.log('[ChatVault] Project export — project name:', authorizedProjectName ?? '(blank → Unassigned)', '| includeMarkdown:', includeMarkdown, '| includeJson:', includeJson, '| createZip:', createZip);

  const dateStr    = new Date().toISOString().slice(0, 10);
  const pSlug      = slugForExport(authorizedProjectName || '') || 'Unassigned';
  const folderName = `ChatVault-export--${pSlug}--${dateStr}`;
  const usedNames  = new Set();

  const collectedFiles = []; // { filename, content, mimeType }
  const chatIndex = [];      // { title, filename, url }
  const failedChats = [];    // { title, url, error }

  let successCount = 0;
  let errorCount   = 0;

  // Retry configuration
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 3000;
  const WAIT_AFTER_NAV_MS = 1000;

  for (let i = 0; i < chats.length; i++) {
    const chat = chats[i];
    let chatSucceeded = false;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !chatSucceeded; attempt++) {
      try {
        console.log(`[ChatVault] Chat ${i + 1}/${chats.length} "${chat.title}" — attempt ${attempt}/${MAX_ATTEMPTS}`);

        // Small delay between chats (shorter on retries)
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }

        // Navigate to chat URL if needed
        const existingTab = await chrome.tabs.get(tabId);
        if (existingTab.url !== chat.url) {
          await chrome.tabs.update(tabId, { url: chat.url });
          // Wait for tab to finish loading
          await waitForTabLoad(tabId, 10000);
          // Extra buffer after load
          await new Promise((resolve) => setTimeout(resolve, WAIT_AFTER_NAV_MS));
        }

        // Wait for conversation DOM to be ready (polls until elements appear or timeout)
        const readyResult = await sendMessageToTab(tabId, {
          action: 'waitForConversation',
          options: { timeout: 15000, pollInterval: 400 },
        });

        if (!readyResult || !readyResult.ready) {
          const waitError = readyResult?.error || 'Conversation not ready';
          console.warn(`[ChatVault] Chat "${chat.title}" not ready: ${waitError}`);
          lastError = waitError;
          continue; // Retry
        }

        // Derive format from includeMarkdown + includeJson
        let format = 'markdown';
        if (includeMarkdown && includeJson) {
          format = 'both';
        } else if (includeMarkdown) {
          format = 'markdown';
        } else if (includeJson) {
          format = 'json';
        }

        // Extract the conversation
        const response = await sendMessageToTab(tabId, {
          action: 'extract',
          options: {
            format,
            skipDownload: true,
            userProjectName: authorizedProjectName,
          },
        });

        if (response && response.success) {
          const chatName = response.chatName || chat.title || chat.id || null;
          const chatId   = response.chatId   || chat.id;

          const primaryExt = includeMarkdown ? 'md' : 'json';
          const primaryFilename = buildExportFilename({
            projectName: authorizedProjectName,
            chatName,
            ext: primaryExt,
            chatId,
            usedNames,
          });

          if (includeMarkdown && response.markdown) {
            collectedFiles.push({ filename: primaryFilename, content: response.markdown, mimeType: 'text/markdown' });
          }

          if (includeJson && response.json) {
            const jsonFilename = includeMarkdown ? primaryFilename.replace(/\.md$/, '.json') : primaryFilename;
            collectedFiles.push({ filename: jsonFilename, content: response.json, mimeType: 'application/json' });
          }

          chatIndex.push({
            title:    chatName || 'Untitled',
            filename: primaryFilename,
            url:      chat.url || response.metadata?.source_url || '',
          });

          successCount++;
          chatSucceeded = true;
          console.log(`[ChatVault] Chat "${chat.title}" exported successfully on attempt ${attempt}`);
        } else {
          lastError = response?.error || 'Extraction returned success: false';
          console.warn(`[ChatVault] Chat "${chat.title}" extraction failed: ${lastError}`);
        }
      } catch (err) {
        lastError = err.message;
        console.warn(`[ChatVault] Chat "${chat.title}" attempt ${attempt} error: ${err.message}`);
      }
    }

    // After all attempts, record failure if not successful
    if (!chatSucceeded) {
      errorCount++;
      failedChats.push({
        title: chat.title || chat.id || 'Unknown',
        url:   chat.url || '',
        error: lastError || 'Unknown error',
      });
      console.error(`[ChatVault] Chat "${chat.title}" failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
    }
  }

  // Helper: send message to tab with promise wrapper
  async function sendMessageToTab(tid, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tid, message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });
  }

  // Helper: wait for tab to finish loading
  async function waitForTabLoad(tid, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkTab = async () => {
        try {
          const tab = await chrome.tabs.get(tid);
          if (tab.status === 'complete') {
            resolve(true);
            return;
          }
        } catch {
          resolve(false);
          return;
        }
        
        if (Date.now() - startTime > timeoutMs) {
          resolve(false);
          return;
        }
        
        setTimeout(checkTab, 200);
      };
      
      checkTab();
    });
  }

  // -------------------------------------------------------------------------
  // Build index files
  // -------------------------------------------------------------------------
  const indexMd = buildProjectIndexMd({
    projectName: authorizedProjectName || 'Unassigned',
    dateStr,
    chatCount: successCount,
    chatIndex,
    failedChats,
  });

  const summaryMd = buildProjectSummaryMd({ projectName: authorizedProjectName || 'Unassigned' });

  const manifestObj = {
    schemaVersion:    '2.0',
    exportedAt:       new Date().toISOString(),
    extensionVersion,
    projectName:      authorizedProjectName || 'Unassigned',
    exportDate:       dateStr,
    chatCount:        successCount,
    errorCount,
    includeJson,
    createZip,
    chats: chatIndex.map((c) => ({ title: c.title, filename: c.filename, url: c.url })),
    failedChats: failedChats.map((c) => ({ title: c.title, url: c.url, error: c.error })),
  };

  // -------------------------------------------------------------------------
  // Download each file inside the flat folder (via chrome.downloads)
  // -------------------------------------------------------------------------
  const allFiles = [
    { filename: '00-project-index.md',   content: indexMd,                     mimeType: 'text/markdown' },
    { filename: '00-project-summary.md', content: summaryMd,                   mimeType: 'text/markdown' },
    { filename: 'manifest.json',         content: JSON.stringify(manifestObj, null, 2), mimeType: 'application/json' },
    ...collectedFiles,
  ];

  for (const file of allFiles) {
    await triggerDownload(`${folderName}/${file.filename}`, file.content, file.mimeType);
  }

  // -------------------------------------------------------------------------
  // Optional ZIP
  // -------------------------------------------------------------------------
  let zipFilename = null;
  if (createZip) {
    const zip = new JSZip();
    for (const file of allFiles) {
      zip.file(`${folderName}/${file.filename}`, file.content);
    }
    zipFilename = `${folderName}.zip`;
    const zipBase64 = await zip.generateAsync({ type: 'base64' });
    await chrome.downloads.download({
      url:      `data:application/zip;base64,${zipBase64}`,
      filename: zipFilename,
      saveAs:   false,
    });
  }

  if (chrome.notifications) {
    chrome.notifications.create({
      type:     'basic',
      iconUrl:  'icons/icon48.png',
      title:    'ChatVault export complete',
      message:  `${folderName}/ · ${successCount} chat${successCount !== 1 ? 's' : ''} exported.${createZip ? ' ZIP also created.' : ''}`,
    });
  }

  return {
    success:    true,
    chatCount:  successCount,
    errors:     errorCount,
    failedChats,
    folderName,
    zipFilename,
  };
}

// ---------------------------------------------------------------------------
// Helpers: download a single text file
// ---------------------------------------------------------------------------
async function triggerDownload(filename, content, mimeType) {
  try {
    const len = typeof content === 'string' ? content.length : 0;
    let url;
    if (len <= DATA_URL_MAX_CHARS) {
      const base64 = btoa(unescape(encodeURIComponent(content)));
      url = `data:${mimeType};base64,${base64}`;
    } else {
      const blob = new Blob([content], { type: mimeType });
      url = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(url), 15_000);
    }
    await chrome.downloads.download({ url, filename, saveAs: false });
  } catch (err) {
    console.error('[ChatVault] triggerDownload failed for', filename, err);
  }
}

// ---------------------------------------------------------------------------
// Index / summary builders
// ---------------------------------------------------------------------------
function buildProjectIndexMd({ projectName, dateStr, chatCount, chatIndex, failedChats = [] }) {
  const rows = chatIndex
    .map((c) => {
      const urlCell = c.url ? `[source](${c.url})` : '—';
      return `| ${escMdCell(c.title)} | \`${c.filename}\` | ${urlCell} |`;
    })
    .join('\n');

  let failedSection = '';
  if (failedChats.length > 0) {
    const failedRows = failedChats
      .map((c) => {
        const urlCell = c.url ? `[source](${c.url})` : '—';
        return `| ${escMdCell(c.title)} | ${escMdCell(c.error)} | ${urlCell} |`;
      })
      .join('\n');
    
    failedSection = `

## Skipped (export failed)

The following chats could not be exported. You can re-export them individually.

| Title | Error | Source |
|---|---|---|
${failedRows}
`;
  }

  return `# ${projectName} — Export Index

| Field | Value |
|---|---|
| Project | ${projectName} |
| Export date | ${dateStr} |
| Chats exported | ${chatCount} |
| Chats failed | ${failedChats.length} |

## Chats

| Title | Filename | Source |
|---|---|---|
${rows || '| — | — | — |'}
${failedSection}`;
}

function buildProjectSummaryMd({ projectName }) {
  return `# ${projectName} — Project Summary

> This file is a template. Fill in each section after reviewing the exported chats.

## Themes

_What recurring topics or goals appear across these conversations?_

## Key Decisions

_What decisions were made or conclusions reached?_

## Useful Prompts

_Which prompts produced the most valuable responses?_

## Open Questions

_What was left unresolved or needs follow-up?_
`;
}

function escMdCell(text) {
  return String(text || '').replace(/\|/g, '\\|');
}
