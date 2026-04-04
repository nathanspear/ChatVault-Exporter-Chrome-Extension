// =============================================================================
// ChatVault — Popup Script  v0.9.7
// =============================================================================
// Manages the extension popup UI: platform detection, single-chat export,
// and project-batch export for ChatGPT.
//
// Settings architecture:
//   Export toggles persist in chrome.storage.sync (or local). Project name does not:
//   the field starts empty every time you open the popup (legacy stored name is removed on load).
//
//     STORAGE_KEY_INCLUDE_MARKDOWN — boolean: include .md files (default on)
//     STORAGE_KEY_INCLUDE_JSON     — boolean: include .json alongside .md (default off)
//     STORAGE_KEY_INCLUDE_SDOC     — boolean: include .sdoc (SDOC format) (default off)
//     STORAGE_KEY_CREATE_ZIP       — boolean: zip project batch export only (default off); single chat is never zipped
//     STORAGE_KEY_EXPORT_SUBFOLDER — string: optional path under the browser download dir (default "")
//
//   loadSettings() reads toggles on popup open; project name input is always cleared.
//   saveToggle() persists each checkbox independently on change.
//
// Export flow (single chat):
//   1. Read project name from the input + toggles from storage.
//   2. Send {action:'extract', options:{includeMarkdown, includeJson, includeSdoc, userProjectName}}.
//   3. content script serializes requested format(s); at least one must be selected.
//   4. content.js extracts, serializes, downloads the file(s).
//
// Export flow (project batch — ChatGPT only):
//   1. Read project name from the input + toggles from storage.
//   2. Send {action:'exportProject', ...chats, includeMarkdown, includeJson, includeSdoc, createZip} to background.js.
//   3. background.js navigates the tab to each chat URL, calls content.js with those flags, and
//      downloads all files into a flat folder (+ optional ZIP).
// =============================================================================

const statusEl = document.getElementById('status');
const exportBtn = document.getElementById('exportBtn');
const downloadChatFilesBtn = document.getElementById('downloadChatFilesBtn');
const resultsEl = document.getElementById('results');
const exportProjectBtn = document.getElementById('exportProjectBtn');
const projectInfoEl = document.getElementById('projectInfo');
const projectNameEl = document.getElementById('projectName');
const projectCountEl = document.getElementById('projectCount');
const chatListSection = document.getElementById('chatListSection');
const chatListEl = document.getElementById('chatList');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectNoneBtn = document.getElementById('selectNoneBtn');
const refreshListBtn = document.getElementById('refreshListBtn');
const exportAllBtn = document.getElementById('exportAllBtn');
const chatListHint = document.getElementById('chatListHint');
const projectNameInput = document.getElementById('projectNameInput');
const projectNameWarning = document.getElementById('projectNameWarning');
const filenamePreview = document.getElementById('filenamePreview');
const includeMarkdownToggle = document.getElementById('includeMarkdownToggle');
const includeJsonToggle = document.getElementById('includeJsonToggle');
const includeSdocToggle = document.getElementById('includeSdocToggle');
const createZipToggle = document.getElementById('createZipToggle');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const exportSubfolderInput = document.getElementById('exportSubfolderInput');

const PLATFORM_DISPLAY = {
  claude: 'Claude.ai',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
  'grok-x': 'Grok (x.com)',
  perplexity: 'Perplexity',
};

/** Content script missing or not answering: lead with the action; detail in smaller, muted text. */
const STATUS_REFRESH_FOR_CONTENT_SCRIPT =
  'Refresh the page. <span style="font-size:11px;color:#666;font-weight:400">(This often happens on tabs that were already open when the extension was last run. Reload the page and then open the extension again.)</span>';

let currentTabId = null;
let currentTabUrl = '';
let detectedPlatform = null;
let currentProject = null;
let currentChats = [];

// --- Storage: Export toggles only (project name is not persisted) ---
/** @deprecated Legacy key removed on load so old installs stop repopulating the field. */
const STORAGE_KEY_PROJECT_NAME = 'userProjectName';
const STORAGE_KEY_INCLUDE_MARKDOWN = 'exportIncludeMarkdown';
const STORAGE_KEY_INCLUDE_JSON  = 'exportIncludeJson';
const STORAGE_KEY_INCLUDE_SDOC  = 'exportIncludeSdoc';
const STORAGE_KEY_CREATE_ZIP    = 'exportCreateZip';
const STORAGE_KEY_EXPORT_SUBFOLDER = 'exportSubfolder';

/** Project name from the text field only (not persisted between popup opens). */
function getProjectNameFromInput() {
  return projectNameInput && projectNameInput.value ? projectNameInput.value.trim() : '';
}

async function loadSettings() {
  try {
    const storage = chrome.storage.sync || chrome.storage.local;
    try {
      await storage.remove(STORAGE_KEY_PROJECT_NAME);
    } catch {
      /* ignore */
    }
    const data = await storage.get([
      STORAGE_KEY_INCLUDE_MARKDOWN,
      STORAGE_KEY_INCLUDE_JSON,
      STORAGE_KEY_INCLUDE_SDOC,
      STORAGE_KEY_CREATE_ZIP,
      STORAGE_KEY_EXPORT_SUBFOLDER,
    ]);
    if (projectNameInput) {
      projectNameInput.value = '';
    }
    includeMarkdownToggle.checked = data[STORAGE_KEY_INCLUDE_MARKDOWN] !== false; // default true
    includeJsonToggle.checked = data[STORAGE_KEY_INCLUDE_JSON] === true;
    if (includeSdocToggle) {
      includeSdocToggle.checked = data[STORAGE_KEY_INCLUDE_SDOC] === true;
    }
    createZipToggle.checked   = data[STORAGE_KEY_CREATE_ZIP]   === true;
    if (exportSubfolderInput) {
      exportSubfolderInput.value = typeof data[STORAGE_KEY_EXPORT_SUBFOLDER] === 'string'
        ? data[STORAGE_KEY_EXPORT_SUBFOLDER]
        : '';
    }
    updateFilenamePreview();
    updateExportButtonLabel();
    refreshSingleChatExportEnabled();
  } catch (err) {
    console.warn('[ChatVault] Could not load settings:', err);
  }
}

async function saveToggle(key, value) {
  try {
    const storage = chrome.storage.sync || chrome.storage.local;
    await storage.set({ [key]: value });
  } catch (err) {
    console.warn('[ChatVault] Could not save toggle to storage:', err);
  }
}

includeMarkdownToggle.addEventListener('change', () => {
  saveToggle(STORAGE_KEY_INCLUDE_MARKDOWN, includeMarkdownToggle.checked);
  updateExportButtonLabel();
  refreshSingleChatExportEnabled();
});
includeJsonToggle.addEventListener('change', () => {
  saveToggle(STORAGE_KEY_INCLUDE_JSON, includeJsonToggle.checked);
  updateExportButtonLabel();
  refreshSingleChatExportEnabled();
});
if (includeSdocToggle) {
  includeSdocToggle.addEventListener('change', () => {
    saveToggle(STORAGE_KEY_INCLUDE_SDOC, includeSdocToggle.checked);
    updateExportButtonLabel();
    refreshSingleChatExportEnabled();
  });
}
createZipToggle.addEventListener('change',   () => saveToggle(STORAGE_KEY_CREATE_ZIP,   createZipToggle.checked));

async function saveExportSubfolder() {
  if (!exportSubfolderInput) return;
  try {
    const storage = chrome.storage.sync || chrome.storage.local;
    await storage.set({ [STORAGE_KEY_EXPORT_SUBFOLDER]: exportSubfolderInput.value.trim() });
  } catch (err) {
    console.warn('[ChatVault] Could not save export subfolder:', err);
  }
  updateFilenamePreview();
}

let exportSubfolderSaveTimer = null;
function scheduleSaveExportSubfolder() {
  clearTimeout(exportSubfolderSaveTimer);
  exportSubfolderSaveTimer = setTimeout(() => saveExportSubfolder(), 400);
}

if (settingsBtn && settingsPanel) {
  settingsBtn.addEventListener('click', () => {
    const open = settingsPanel.style.display !== 'block';
    settingsPanel.style.display = open ? 'block' : 'none';
    settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

if (exportSubfolderInput) {
  exportSubfolderInput.addEventListener('input', scheduleSaveExportSubfolder);
  exportSubfolderInput.addEventListener('blur', () => {
    clearTimeout(exportSubfolderSaveTimer);
    saveExportSubfolder();
  });
}

function hasAnyFormatSelected() {
  const md = includeMarkdownToggle && includeMarkdownToggle.checked;
  const json = includeJsonToggle && includeJsonToggle.checked;
  const sdoc = includeSdocToggle && includeSdocToggle.checked;
  return !!(md || json || sdoc);
}

function refreshSingleChatExportEnabled() {
  if (!exportBtn || !detectedPlatform || !currentTabUrl) return;
  if (!isOnConversationPage(currentTabUrl, detectedPlatform)) return;
  exportBtn.disabled = !hasAnyFormatSelected();
}

function getExportChatButtonLabel() {
  return 'Export one chat';
}

function updateExportButtonLabel() {
  if (exportBtn) exportBtn.textContent = getExportChatButtonLabel();
}

function updateFilenamePreview() {
  const projectVal = (projectNameInput.value || '').trim();
  if (!projectVal) {
    projectNameWarning.style.display = 'block';
  } else {
    projectNameWarning.style.display = 'none';
  }
  const dateStr = exportDateLocalYyyyMmDd();
  const pSlug = projectVal ? slugForExport(projectVal) : 'Unassigned';
  const subRaw = exportSubfolderInput && exportSubfolderInput.value ? exportSubfolderInput.value.trim() : '';
  const subPrefix = subRaw ? `${subRaw.replace(/\\/g, '/').replace(/^\/+/, '')}/` : '';
  const folderName = `ChatVault-export--${pSlug}--${dateStr}/`;
  const chatFile   = `ChatVault-export--${pSlug}--Example-Chat--Unknown--${dateStr}.md`;
  filenamePreview.textContent = 'Folder: ' + subPrefix + folderName + '  Chat: ' + chatFile;
  filenamePreview.style.display = 'block';
}

// Load filename-builder.js functions (slugForExport) for preview
function slugForExport(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .slice(0, 60)
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .map(function(word) {
      return word.length === 0 ? '' : word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('-');
}

projectNameInput.addEventListener('input', () => {
  updateFilenamePreview();
});

/**
 * Returns true if the current URL is an actual conversation page (not a home/Recents page).
 * Used to decide whether the single-chat Export button should be enabled.
 */
function isOnConversationPage(url, platform) {
  if (platform === 'claude') return /\/chat\/[a-f0-9-]+/.test(url);
  if (platform === 'chatgpt') return /\/c\/[a-zA-Z0-9_-]+/.test(url);
  // Gemini, Grok, Perplexity — always on a conversation when the platform is detected
  return true;
}

/** Sync header subtitle and format tooltips with the detected chat site (from content script `detect`). */
function updateHelpTooltipsAndHeader(platformKey) {
  const subtitleEl = document.getElementById('headerSubtitle');
  const mdEl = document.getElementById('tooltipMarkdown');
  const jsonEl = document.getElementById('tooltipJson');
  const toolLabel = platformKey ? PLATFORM_DISPLAY[platformKey] || platformKey : null;

  if (subtitleEl) {
    subtitleEl.textContent = toolLabel
      ? `Current site: ${toolLabel}`
      : 'Export AI conversations from the tab you have open';
  }

  if (mdEl) {
    if (toolLabel) {
      const upload =
        platformKey === 'claude'
          ? 'Claude Projects'
          : platformKey === 'chatgpt'
            ? 'ChatGPT Projects'
            : null;
      mdEl.textContent = upload
        ? `Markdown is the best format for reading and for uploading into ${upload}. You are on ${toolLabel}. Uncheck only if you need JSON or other formats alone.`
        : `Markdown is the best format for reading. You are on ${toolLabel}. Uncheck only if you need JSON or other formats alone.`;
    } else {
      mdEl.textContent =
        'Markdown is the best format for reading. Open this extension from a supported chat (Claude.ai, ChatGPT, Gemini, Grok, or Perplexity) so the current site is detected. Uncheck only if you need JSON or other formats alone.';
    }
  }

  if (jsonEl) {
    if (toolLabel) {
      jsonEl.textContent = `Save as JSON when you want a machine-readable copy of each chat (for example scripts or backup). Markdown is usually easier to read in ${toolLabel}; use JSON if you need the raw structure too.`;
    } else {
      jsonEl.textContent =
        'Save as JSON when you want a machine-readable copy of each chat (for example scripts or backup). Markdown is usually easier to read at a glance; use JSON if you need the raw structure too.';
    }
  }
}

// --- Initialization ---
async function init() {
  await loadSettings();
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showStatus('error', 'No active tab found.');
      return;
    }
    currentTabId = tab.id;
    currentTabUrl = tab.url || '';

    const url = currentTabUrl;
    const supportedDomains = [
      'claude.ai',
      'chat.openai.com',
      'chatgpt.com',
      'gemini.google.com',
      'x.com/i/grok',
      'grok.com',
      'perplexity.ai',
      'www.perplexity.ai',
    ];

    const isSupported = supportedDomains.some((d) => url.includes(d));
    if (!isSupported) {
      showStatus('error', 'Navigate to a supported AI chat to export.');
      return;
    }

    try {
      const response = await sendToTab(currentTabId, { action: 'detect' });
      if (response && response.supported) {
        detectedPlatform = response.platform;
        const name = PLATFORM_DISPLAY[detectedPlatform] || detectedPlatform;

        // Fix 1: only enable single-chat export when on an actual conversation page
        const conversationPage = isOnConversationPage(url, detectedPlatform);
        if (conversationPage) {
          exportBtn.disabled = !hasAnyFormatSelected();
          if (downloadChatFilesBtn) {
            if (detectedPlatform === 'chatgpt') {
              downloadChatFilesBtn.style.display = 'block';
              downloadChatFilesBtn.disabled = false;
            } else {
              downloadChatFilesBtn.style.display = 'none';
            }
          }
          showStatus(
            'info',
            `Detected: <span class="platform-name">${name}</span>. Ready to export.`
          );
        } else {
          exportBtn.disabled = true;
          exportBtn.textContent = 'No chat open';
          if (downloadChatFilesBtn) {
            downloadChatFilesBtn.style.display = 'none';
            downloadChatFilesBtn.disabled = true;
          }
          showStatus(
            'info',
            `Detected: <span class="platform-name">${name}</span>. Open a chat to export it, or use the Project Export section below.`
          );
        }

        // Fix 2: always load project/Recents info for Claude and ChatGPT
        // (previously only ran on project pages — now also runs on home/Recents)
        if (detectedPlatform === 'chatgpt' || detectedPlatform === 'claude') {
          try {
            await loadProjectInfo();
          } catch (err) {
            console.log('Could not load project/Recents info:', err);
          }
        }
      } else {
        showStatus('warning', STATUS_REFRESH_FOR_CONTENT_SCRIPT);
      }
    } catch (err) {
      showStatus('warning', STATUS_REFRESH_FOR_CONTENT_SCRIPT);
    }
  } catch (err) {
    showStatus('error', `Error: ${err.message}`);
  } finally {
    updateHelpTooltipsAndHeader(detectedPlatform);
  }
}

// --- Export ---
exportBtn.addEventListener('click', async () => {
  if (!currentTabId || !detectedPlatform) return;

  exportBtn.disabled = true;
  exportBtn.innerHTML = '<span class="spinner"></span> Extracting...';
  showStatus('info', 'Extracting conversation...');
  resultsEl.classList.remove('visible');

  try {
    const raw = getProjectNameFromInput();
    const userProjectName = raw || null;
    const includeMarkdown = includeMarkdownToggle.checked;
    const includeJson = includeJsonToggle.checked;
    const includeSdoc = includeSdocToggle ? includeSdocToggle.checked : false;

    if (!includeMarkdown && !includeJson && !includeSdoc) {
      showStatus('warning', 'Select at least one: Save as Markdown, JSON, and/or SDOC.');
      exportBtn.disabled = false;
      exportBtn.textContent = getExportChatButtonLabel();
      return;
    }

    console.log('[ChatVault] Single-chat export — project name:', userProjectName ?? '(blank → Unassigned)', '| includeMarkdown:', includeMarkdown, '| includeJson:', includeJson, '| includeSdoc:', includeSdoc);
    const response = await sendToTab(currentTabId, {
      action: 'extract',
      options: {
        includeMarkdown,
        includeJson,
        includeSdoc,
        userProjectName,
        createZip: false,
      },
    });

    if (response && response.success) {
      const meta = response.metadata || {};
      const labels = [];
      if (includeMarkdown) labels.push('Markdown');
      if (includeJson) labels.push('JSON');
      if (includeSdoc) labels.push('SDOC');
      const formatLabel = labels.join(' + ');
      const zipNote = meta.zipped && meta.zipFilename
        ? ` One ZIP: <code style="font-size:11px">${escapeHtml(meta.zipFilename)}</code>.`
        : '';
      showStatus(
        'success',
        `Exported ${meta.total_turns || '?'} turns as ${formatLabel} from ${
          PLATFORM_DISPLAY[detectedPlatform] || detectedPlatform
        }.${zipNote}`
      );
      showResults(meta, response.integrityWarnings);
    } else {
      showStatus('error', response?.error || 'Export failed.');
      if (response?.errors?.length) {
        showResults({ errors: response.errors }, []);
      }
    }
  } catch (err) {
    showStatus('error', `Export failed: ${err.message}`);
  }

  exportBtn.disabled = false;
  exportBtn.textContent = getExportChatButtonLabel();
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function sanitizeAttachmentFilename(name) {
  let s = String(name || 'file')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!s) s = 'file';
  return s.slice(0, 180);
}

function pickUniqueFilename(desired, usedSet) {
  if (!usedSet.has(desired)) return desired;
  const m = desired.match(/^(.+)(\.[^.]+)$/);
  const stem = m ? m[1] : desired;
  const ext = m ? m[2] : '';
  let n = 2;
  let candidate;
  do {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  } while (usedSet.has(candidate));
  return candidate;
}

if (downloadChatFilesBtn) {
  downloadChatFilesBtn.addEventListener('click', async () => {
    if (!currentTabId || detectedPlatform !== 'chatgpt') return;

    downloadChatFilesBtn.disabled = true;
    const prevLabel = downloadChatFilesBtn.textContent;
    downloadChatFilesBtn.textContent = 'Scanning chat…';
    showStatus('info', 'Loading the full conversation and scanning for file links…');

    try {
      const list = await sendToTab(currentTabId, { action: 'listChatGPTAttachments' });

      if (!list || !list.success) {
        showStatus('error', list?.error || 'Could not scan this chat.');
        return;
      }

      if (list.warnings && list.warnings.length) {
        console.warn('[ChatVault] Attachment scan warnings:', list.warnings);
      }

      if (!list.files || list.files.length === 0) {
        if (list.usedUiClickFallback && list.uiClickCount > 0) {
          showStatus(
            'success',
            `Triggered <strong>${list.uiClickCount}</strong> download(s) using ChatGPT’s own file controls (same as clicking each attachment). Check your Downloads folder.`
          );
          return;
        }
        const errHint = list.mainWorldError ? ` Details: ${escapeHtml(String(list.mainWorldError))}` : '';
        showStatus(
          'warning',
          'Could not download attachments automatically. ChatGPT may store files in a closed UI layer, or the tab needs a refresh. Try: reload this chat tab, open the extension from that tab, and press again. If it still fails, use ChatGPT’s file chips or Library to download.' +
            errHint
        );
        return;
      }

      const raw = getProjectNameFromInput();
      const dateStr = exportDateLocalYyyyMmDd();
      const pSlug = slugForExport(raw) || 'Unassigned';
      const chatSlug = slugForExport(list.chatTitle || list.chatId || 'chat') || 'Chat';
      const folder = `ChatVault-files--${pSlug}--${chatSlug}--${dateStr}`;

      downloadChatFilesBtn.textContent = `Downloading 0 / ${list.files.length}…`;
      const usedNames = new Set();
      let ok = 0;
      let failed = 0;

      for (let i = 0; i < list.files.length; i++) {
        const f = list.files[i];
        const baseName = sanitizeAttachmentFilename(f.filename);
        const unique = pickUniqueFilename(baseName, usedNames);
        usedNames.add(unique);
        const filename = `${folder}/${unique}`;

        downloadChatFilesBtn.textContent = `Downloading ${i + 1} / ${list.files.length}…`;

        try {
          const res = await sendRuntimeMessage({
            action: 'downloadFromUrl',
            url: f.url,
            filename,
          });
          if (res && res.success) ok += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
        await sleep(350);
      }

      let msg = `Started <strong>${ok}</strong> download(s) into folder <code style="font-size:11px">${escapeHtml(folder)}</code>.`;
      if (failed > 0) {
        msg += ` <span style="color:#c53030">${failed} failed</span> (check that you are signed in to ChatGPT).`;
      }
      if (list.skippedBlob > 0) {
        msg += ` ${list.skippedBlob} blob link(s) skipped; save those from the chat UI if needed.`;
      }
      showStatus(ok > 0 ? 'success' : 'warning', msg);
    } catch (err) {
      showStatus('error', `Attachment download failed: ${escapeHtml(err.message)}`);
    } finally {
      downloadChatFilesBtn.disabled = false;
      downloadChatFilesBtn.textContent = prevLabel;
    }
  });
}

// --- UI Helpers ---
function showStatus(type, html) {
  statusEl.className = `status ${type}`;
  statusEl.innerHTML = html;
}

function showResults(metadata, warnings) {
  let html = '';

  if (metadata.total_turns !== undefined) {
    html += `<div class="stat"><span class="stat-label">Turns</span><span class="stat-value">${metadata.total_turns}</span></div>`;
  }
  if (metadata.flagged_turns !== undefined && metadata.flagged_turns > 0) {
    html += `<div class="stat"><span class="stat-label">Flagged</span><span class="stat-value">${metadata.flagged_turns}</span></div>`;
  }
  if (metadata.extraction_time_ms !== undefined) {
    html += `<div class="stat"><span class="stat-label">Time</span><span class="stat-value">${metadata.extraction_time_ms}ms</span></div>`;
  }
  if (metadata.partial_export) {
    html += `<div class="stat"><span class="stat-label">Status</span><span class="stat-value" style="color:#b45309">Partial</span></div>`;
  }
  if (metadata.formats_exported) {
    html += `<div class="stat"><span class="stat-label">Formats</span><span class="stat-value">${metadata.formats_exported.join(', ')}</span></div>`;
  }

  if (warnings && warnings.length > 0) {
    html += '<div class="warnings">';
    warnings.forEach((w) => {
      html += `<div>⚠ ${escapeHtml(w)}</div>`;
    });
    html += '</div>';
  }

  if (metadata.errors && metadata.errors.length > 0) {
    html += '<div class="warnings">';
    metadata.errors.forEach((e) => {
      html += `<div>⚠ ${escapeHtml(e)}</div>`;
    });
    html += '</div>';
  }

  if (html) {
    resultsEl.innerHTML = html;
    resultsEl.classList.add('visible');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** Live progress for batch export (messages from background.js handleProjectExport). */
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.action !== 'exportProgress') return;

  const {
    phase,
    total,
    completed,
    remaining,
    successSoFar,
    failedSoFar,
    lastTitle,
    lastSucceeded,
  } = message;

  if (phase === 'start') {
    showStatus(
      'info',
      `Starting export of <strong>${total}</strong> chat${total !== 1 ? 's' : ''}… Keep this popup open.`
    );
    return;
  }

  if (phase === 'chatDone') {
    const remLabel = remaining > 0 ? `<strong>${remaining}</strong> left to go` : 'queue finished';
    const last = lastTitle ? escapeHtml(String(lastTitle)) : '(no title)';
    const mark = lastSucceeded ? '✓' : '✗';
    showStatus(
      'info',
      `<div style="line-height:1.45"><strong>${completed}</strong> / <strong>${total}</strong> chats processed · ${remLabel}</div>` +
        `<div style="font-size:12px;margin-top:6px"><strong>${successSoFar}</strong> exported ok` +
        (failedSoFar ? ` · <span style="color:#c0392b">${failedSoFar} failed</span>` : '') +
        `</div>` +
        `<div style="font-size:11px;color:#666;margin-top:4px">Last ${mark}: ${last}</div>`
    );
    return;
  }

  if (phase === 'finalizing') {
    showStatus('info', 'Saving index and files to Downloads…');
  }
});

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function renderChatList() {
  chatListEl.innerHTML = '';
  currentChats.forEach((chat, index) => {
    const label = document.createElement('label');
    label.className = 'chat-list-item';
    const title = chat.title || `Chat ${chat.id}`;
    label.innerHTML = `
      <input type="checkbox" data-chat-index="${index}" checked>
      <span class="chat-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
    `;
    label.addEventListener('click', (e) => {
      if (e.target.type !== 'checkbox') {
        const cb = label.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = !cb.checked;
        updateExportSelectedState();
      }
    });
    label.querySelector('input[type="checkbox"]').addEventListener('change', updateExportSelectedState);
    chatListEl.appendChild(label);
  });
  updateExportSelectedState();
}

function getSelectedChats() {
  const checkboxes = chatListEl.querySelectorAll('input[type="checkbox"]');
  const selected = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) {
      const index = parseInt(cb.dataset.chatIndex, 10);
      if (!isNaN(index) && currentChats[index]) selected.push(currentChats[index]);
    }
  });
  return selected;
}

function updateExportSelectedState() {
  const n = getSelectedChats().length;
  const fmt = hasAnyFormatSelected();
  exportProjectBtn.disabled = n === 0 || !fmt;
  exportProjectBtn.textContent = n === 0 ? 'Export selected' : `Export selected (${n})`;
}

async function loadProjectInfo() {
  currentProject = null;
  currentChats = [];
  chatListEl.innerHTML = '';
  chatListSection.style.display = 'none';
  projectInfoEl.style.display = 'none';
  exportProjectBtn.disabled = true;

  try {
    const projectResponse = await sendToTab(currentTabId, { action: 'getCurrentProject' });
    const chatsResponse = await sendToTab(currentTabId, { action: 'discoverChats' });
    const chats = chatsResponse?.chats || [];

    currentChats = chats;
    
    // Banner label: "Project export (LLM)" — must match popup.html default casing
    const projectExportTitle = document.getElementById('projectExportTitle');
    if (detectedPlatform === 'claude') {
      projectExportTitle.textContent = 'Project export (Claude)';
    } else if (detectedPlatform === 'perplexity') {
      projectExportTitle.textContent = 'Project export (Perplexity)';
    } else if (detectedPlatform === 'chatgpt') {
      projectExportTitle.textContent = 'Project export (ChatGPT)';
    } else if (detectedPlatform === 'gemini') {
      projectExportTitle.textContent = 'Project export (Gemini)';
    } else if (detectedPlatform === 'grok' || detectedPlatform === 'grok-x') {
      projectExportTitle.textContent = 'Project export (Grok)';
    } else {
      projectExportTitle.textContent = 'Project export';
    }

    if (projectResponse?.project) {
      currentProject = projectResponse.project;
      projectNameEl.textContent = currentProject.name;
      
      // Platform-specific terminology
      const itemLabel = detectedPlatform === 'perplexity' ? 'thread' : 'chat';
      const containerLabel = detectedPlatform === 'perplexity' ? 'space' : 'project';
      projectCountEl.textContent = `${chats.length} ${itemLabel}${chats.length !== 1 ? 's' : ''} in this ${containerLabel}`;
    } else {
      currentProject = { id: 'individual', name: 'Individual chats' };
      projectNameEl.textContent = 'Individual chats';
      const itemLabel = detectedPlatform === 'perplexity' ? 'thread' : 'chat';
      projectCountEl.textContent = chats.length === 0 ? `No ${itemLabel}s in left nav` : `${chats.length} ${itemLabel}${chats.length !== 1 ? 's' : ''} (left nav)`;
    }

    const isIndividual = currentProject.id === 'individual';

    // Show Refresh list button and update hint for individual (Recents) mode
    if (isIndividual) {
      refreshListBtn.style.display = '';
      const itemLabel = detectedPlatform === 'perplexity' ? 'thread' : 'chat';
      chatListHint.textContent = `Scroll to the bottom of the Recents list to expose all ${itemLabel}s, then click Refresh list. If still incomplete, reload the page and reopen the extension.`;
    } else {
      refreshListBtn.style.display = 'none';
      chatListHint.textContent = 'Scroll down in the project so all chats are visible on the page. If the list is incomplete, refresh the page and reopen the extension.';
    }

    // Show/hide Export all button (individual mode only, when chats exist)
    exportAllBtn.style.display = (isIndividual && chats.length > 0) ? '' : 'none';
    if (isIndividual && chats.length > 0) {
      exportAllBtn.textContent = `Export all (${chats.length})`;
    }

    projectInfoEl.style.display = 'block';
    if (chats.length === 0) {
      chatListSection.style.display = 'none';
      
      // Platform-specific messages
      let message;
      if (currentProject.id === 'individual') {
        message = detectedPlatform === 'perplexity' 
          ? 'No threads in left nav. Open a space or select a thread to see the list.'
          : 'No chats in left nav. Open a project or select a chat to see the list.';
      } else {
        if (detectedPlatform === 'claude') {
          message = 'Claude Project found but no conversations listed. Open the project page to see conversations, then reopen the extension.';
        } else if (detectedPlatform === 'perplexity') {
          message = 'Perplexity Space found but no threads listed. Open the space page to see threads, then reopen the extension.';
        } else {
          message = 'No chats in this project. Expand the list or reopen the extension.';
        }
      }
      // Don't overwrite the main status - show project info only
      projectInfoEl.textContent = message;
      projectInfoEl.style.color = '#b45309';
    } else {
      chatListSection.style.display = 'block';
      renderChatList();
    }
  } catch (err) {
    console.warn('Could not load project info:', err);
    // Don't let project info errors break single-chat export
  }
}

selectAllBtn.addEventListener('click', () => {
  chatListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = true; });
  updateExportSelectedState();
});

selectNoneBtn.addEventListener('click', () => {
  chatListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  updateExportSelectedState();
});

refreshListBtn.addEventListener('click', async () => {
  refreshListBtn.textContent = 'Refreshing...';
  refreshListBtn.disabled = true;
  try {
    await loadProjectInfo();
  } finally {
    refreshListBtn.textContent = 'Refresh list';
    refreshListBtn.disabled = false;
  }
});

exportAllBtn.addEventListener('click', () => {
  chatListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = true; });
  updateExportSelectedState();
  exportProjectBtn.click();
});

exportProjectBtn.addEventListener('click', async () => {
  if (!currentTabId || !currentProject) return;
  const selectedChats = getSelectedChats();
  if (selectedChats.length === 0) {
    showStatus('warning', 'Select at least one chat to export.');
    return;
  }

  exportProjectBtn.disabled = true;
  exportProjectBtn.innerHTML = '<span class="spinner"></span> Exporting...';
  showStatus('info', `Exporting ${selectedChats.length} chat${selectedChats.length !== 1 ? 's' : ''}… Keep this popup open. Files go to your browser download folder (optional subfolder in Settings).`);
  resultsEl.classList.remove('visible');

  try {
    const raw = getProjectNameFromInput();
    const userProjectName = raw || null;
    const includeMarkdown = includeMarkdownToggle.checked;
    const includeJson = includeJsonToggle.checked;
    const includeSdoc = includeSdocToggle ? includeSdocToggle.checked : false;
    const createZip   = createZipToggle.checked;
    if (!includeMarkdown && !includeJson && !includeSdoc) {
      showStatus('warning', 'Select at least one: Save as Markdown, JSON, and/or SDOC.');
      exportProjectBtn.disabled = false;
      exportProjectBtn.textContent = `Export selected (${getSelectedChats().length})`;
      return;
    }
    console.log('[ChatVault] Project export — project name:', userProjectName ?? '(blank → Unassigned)', '| includeMarkdown:', includeMarkdown, '| includeJson:', includeJson, '| includeSdoc:', includeSdoc, '| createZip:', createZip);
    const response = await chrome.runtime.sendMessage({
      action: 'exportProject',
      project: currentProject,
      userProjectName,
      chats: selectedChats,
      tabId: currentTabId,
      platform: detectedPlatform,
      includeMarkdown,
      includeJson,
      includeSdoc,
      createZip,
      zipJsZipDateMs: msForJsZipDosLocalMtime(),
    });

    if (response && response.success) {
      const failedCount = response.failedChats?.length || 0;
      const outputRows = response.downloadMode === 'zip_only'
        ? `<div class="stat"><span class="stat-label">ZIP file</span><span class="stat-value">${escapeHtml(response.zipFilename || '')}</span></div>`
        : `<div class="stat"><span class="stat-label">Folder</span><span class="stat-value">${escapeHtml(response.folderName || '')}</span></div>`;

      if (failedCount > 0) {
        // Some chats failed - show warning with details
        const failedTitles = response.failedChats
          .slice(0, 5)
          .map((c) => c.title)
          .join(', ');
        const moreText = failedCount > 5 ? ` (+${failedCount - 5} more)` : '';
        
        showStatus(
          'warning',
          `${response.chatCount} exported, ${failedCount} failed: ${failedTitles}${moreText}. Re-export failed chats individually.`
        );
        
        // Show failed chats list in results
        const failedListHtml = response.failedChats
          .map((c) => `<li>${escapeHtml(c.title)}</li>`)
          .join('');
        resultsEl.innerHTML = `
          <div class="stat"><span class="stat-label">Exported</span><span class="stat-value">${response.chatCount}</span></div>
          <div class="stat"><span class="stat-label">Failed</span><span class="stat-value" style="color: #e74c3c;">${failedCount}</span></div>
          ${outputRows}
          <div class="failed-chats-list" style="margin-top: 8px; font-size: 11px; color: #e74c3c;">
            <strong>Failed chats:</strong>
            <ul style="margin: 4px 0 0 16px; padding: 0;">${failedListHtml}</ul>
          </div>
        `;
      } else {
        // All succeeded
        showStatus(
          'success',
          response.downloadMode === 'zip_only'
            ? `Done. ${response.chatCount} chat${response.chatCount !== 1 ? 's' : ''} saved in one ZIP. Check Downloads.`
            : `Done. ${response.chatCount} chat${response.chatCount !== 1 ? 's' : ''} exported. Check your Downloads folder.`
        );
        resultsEl.innerHTML = `
          <div class="stat"><span class="stat-label">Exported</span><span class="stat-value">${response.chatCount}</span></div>
          ${outputRows}
        `;
      }
      resultsEl.classList.add('visible');
    } else {
      showStatus('error', response?.error || 'Project export failed.');
    }
  } catch (err) {
    showStatus('error', `Export failed: ${err.message}`);
  }

  updateExportSelectedState();
  exportProjectBtn.innerHTML = '';
  exportProjectBtn.textContent = `Export selected (${getSelectedChats().length})`;
});

init();
