// =============================================================================
// ChatVault — Popup Script  v0.6.6
// =============================================================================
// Manages the extension popup UI: platform detection, single-chat export,
// and project-batch export for ChatGPT.
//
// Settings architecture (v0.6.4):
//   All user preferences are persisted in chrome.storage.sync (falls back to
//   chrome.storage.local if sync is unavailable).  Four keys are stored:
//     STORAGE_KEY_PROJECT_NAME     — free-text project label for exported filenames
//     STORAGE_KEY_INCLUDE_MARKDOWN — boolean: include .md files (default on)
//     STORAGE_KEY_INCLUDE_JSON     — boolean: include .json alongside .md (default off)
//     STORAGE_KEY_CREATE_ZIP       — boolean: bundle exports into a .zip (default off)
//
//   loadSettings() reads all four on popup open.
//   saveToggle() persists each checkbox independently on change.
//
// Export flow (single chat):
//   1. Read project name + includeMarkdown + includeJson from storage.
//   2. Derive format from the two checkboxes (markdown | json | both).
//   3. Send {action:'extract', options:{format, userProjectName}} to content script.
//   4. content.js extracts, serializes, downloads the file(s).
//
// Export flow (project batch — ChatGPT only):
//   1. Read project name + includeMarkdown + includeJson + createZip from storage.
//   2. Send {action:'exportProject', ...chats, includeMarkdown, includeJson, createZip} to background.js.
//   3. background.js navigates the tab to each chat URL, calls content.js with derived format, and
//      downloads all files into a flat folder (+ optional ZIP).
// =============================================================================

const statusEl = document.getElementById('status');
const exportBtn = document.getElementById('exportBtn');
const resultsEl = document.getElementById('results');
const exportProjectBtn = document.getElementById('exportProjectBtn');
const projectInfoEl = document.getElementById('projectInfo');
const projectNameEl = document.getElementById('projectName');
const projectCountEl = document.getElementById('projectCount');
const chatListSection = document.getElementById('chatListSection');
const chatListEl = document.getElementById('chatList');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectNoneBtn = document.getElementById('selectNoneBtn');
const projectNameInput = document.getElementById('projectNameInput');
const projectNameWarning = document.getElementById('projectNameWarning');
const filenamePreview = document.getElementById('filenamePreview');
const includeMarkdownToggle = document.getElementById('includeMarkdownToggle');
const includeJsonToggle = document.getElementById('includeJsonToggle');
const createZipToggle = document.getElementById('createZipToggle');

const PLATFORM_DISPLAY = {
  claude: 'Claude.ai',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
  'grok-x': 'Grok (x.com)',
  perplexity: 'Perplexity',
};

let currentTabId = null;
let detectedPlatform = null;
let currentProject = null;
let currentChats = [];

// --- Storage: Project Name + Export Toggles ---
// Single authoritative source for project name and export option toggles.
const STORAGE_KEY_PROJECT_NAME = 'userProjectName';
const STORAGE_KEY_INCLUDE_MARKDOWN = 'exportIncludeMarkdown';
const STORAGE_KEY_INCLUDE_JSON  = 'exportIncludeJson';
const STORAGE_KEY_CREATE_ZIP    = 'exportCreateZip';

/**
 * Read the user-supplied project name from storage.
 * Returns the raw string (may be empty). Never returns null.
 */
async function getProjectNameFromStorage() {
  try {
    const storage = chrome.storage.sync || chrome.storage.local;
    const data = await storage.get(STORAGE_KEY_PROJECT_NAME);
    return data[STORAGE_KEY_PROJECT_NAME] || '';
  } catch (err) {
    console.warn('[ChatVault] Could not read project name from storage:', err);
    return '';
  }
}

async function loadSettings() {
  try {
    const storage = chrome.storage.sync || chrome.storage.local;
    const data = await storage.get([STORAGE_KEY_PROJECT_NAME, STORAGE_KEY_INCLUDE_MARKDOWN, STORAGE_KEY_INCLUDE_JSON, STORAGE_KEY_CREATE_ZIP]);
    projectNameInput.value = data[STORAGE_KEY_PROJECT_NAME] || '';
    includeMarkdownToggle.checked = data[STORAGE_KEY_INCLUDE_MARKDOWN] !== false; // default true
    includeJsonToggle.checked = data[STORAGE_KEY_INCLUDE_JSON] === true;
    createZipToggle.checked   = data[STORAGE_KEY_CREATE_ZIP]   === true;
    updateFilenamePreview();
    updateExportButtonLabel();
  } catch (err) {
    console.warn('[ChatVault] Could not load settings:', err);
  }
}

async function saveProjectName(value) {
  try {
    const storage = chrome.storage.sync || chrome.storage.local;
    await storage.set({ [STORAGE_KEY_PROJECT_NAME]: value });
  } catch (err) {
    console.warn('[ChatVault] Could not save project name to storage:', err);
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
});
includeJsonToggle.addEventListener('change', () => {
  saveToggle(STORAGE_KEY_INCLUDE_JSON, includeJsonToggle.checked);
  updateExportButtonLabel();
});
createZipToggle.addEventListener('change',   () => saveToggle(STORAGE_KEY_CREATE_ZIP,   createZipToggle.checked));

function getExportChatButtonLabel() {
  const md = includeMarkdownToggle && includeMarkdownToggle.checked;
  const json = includeJsonToggle && includeJsonToggle.checked;
  if (md && json) return 'Export Chat (Markdown + JSON)';
  if (json) return 'Export Chat (JSON)';
  return 'Export Chat';
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
  const dateStr = new Date().toISOString().slice(0, 10);
  const pSlug = projectVal ? slugForExport(projectVal) : 'Unassigned';
  const folderName = `ChatVault-export--${pSlug}--${dateStr}/`;
  const chatFile   = `ChatVault-export--${pSlug}--Example-Chat--${dateStr}.md`;
  filenamePreview.textContent = 'Folder: ' + folderName + '  Chat: ' + chatFile;
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
  const val = projectNameInput.value;
  saveProjectName(val);
  updateFilenamePreview();
});

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

    const url = tab.url || '';
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
        showStatus(
          'info',
          `Detected: <span class="platform-name">${name}</span>. Ready to export.`
        );
        exportBtn.disabled = false;

        // Load project/space info for platforms that support it
        // Only load if we're actually on a project/space page to avoid interfering with single-chat export
        if (detectedPlatform === 'chatgpt' || detectedPlatform === 'claude' || detectedPlatform === 'perplexity') {
          try {
            const projectResponse = await sendToTab(currentTabId, { action: 'getCurrentProject' });
            // Only call loadProjectInfo if we're actually on a project/space page
            if (projectResponse?.project) {
              await loadProjectInfo();
            }
          } catch (err) {
            // If project detection fails, that's ok - user is probably on a single chat page
            console.log('Not on a project/space page, skipping project info load');
          }
        }
      } else {
        showStatus(
          'warning',
          'On a supported site, but content script not responding. Try refreshing the page.'
        );
      }
    } catch (err) {
      showStatus('warning', 'Content script not loaded. Try refreshing the page.');
    }
  } catch (err) {
    showStatus('error', `Error: ${err.message}`);
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
    const raw = await getProjectNameFromStorage();
    const userProjectName = raw.trim() || null;
    const includeMarkdown = includeMarkdownToggle.checked;
    const includeJson = includeJsonToggle.checked;
    
    // Derive format from checkboxes
    let format = 'markdown'; // default fallback
    if (includeMarkdown && includeJson) {
      format = 'both';
    } else if (includeMarkdown) {
      format = 'markdown';
    } else if (includeJson) {
      format = 'json';
    }
    
    console.log('[ChatVault] Single-chat export — project name:', userProjectName ?? '(blank → Unassigned)', '| includeMarkdown:', includeMarkdown, '| includeJson:', includeJson, '| format:', format);
    const response = await sendToTab(currentTabId, {
      action: 'extract',
      options: {
        format,
        userProjectName,
      },
    });

    if (response && response.success) {
      const meta = response.metadata || {};
      const formatLabel = includeJson ? 'Markdown + JSON' : 'Markdown';
      showStatus(
        'success',
        `Exported ${meta.total_turns || '?'} turns as ${formatLabel} from ${
          PLATFORM_DISPLAY[detectedPlatform] || detectedPlatform
        }.`
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
  exportProjectBtn.disabled = n === 0;
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
    
    // Update section title based on platform
    const projectExportTitle = document.getElementById('projectExportTitle');
    if (detectedPlatform === 'claude') {
      projectExportTitle.textContent = 'Project Export (Claude)';
    } else if (detectedPlatform === 'perplexity') {
      projectExportTitle.textContent = 'Space Export (Perplexity)';
    } else if (detectedPlatform === 'chatgpt') {
      projectExportTitle.textContent = 'Project Export (ChatGPT)';
    } else {
      projectExportTitle.textContent = 'Project Export';
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

exportProjectBtn.addEventListener('click', async () => {
  if (!currentTabId || !currentProject) return;
  const selectedChats = getSelectedChats();
  if (selectedChats.length === 0) {
    showStatus('warning', 'Select at least one chat to export.');
    return;
  }

  exportProjectBtn.disabled = true;
  exportProjectBtn.innerHTML = '<span class="spinner"></span> Exporting...';
  showStatus('info', `Exporting ${selectedChats.length} chat${selectedChats.length !== 1 ? 's' : ''}… Keep this popup open. File will go to your Downloads folder.`);
  resultsEl.classList.remove('visible');

  try {
    const raw = await getProjectNameFromStorage();
    const userProjectName = raw.trim() || null;
    const includeMarkdown = includeMarkdownToggle.checked;
    const includeJson = includeJsonToggle.checked;
    const createZip   = createZipToggle.checked;
    console.log('[ChatVault] Project export — project name:', userProjectName ?? '(blank → Unassigned)', '| includeMarkdown:', includeMarkdown, '| includeJson:', includeJson, '| createZip:', createZip);
    const response = await chrome.runtime.sendMessage({
      action: 'exportProject',
      project: currentProject,
      userProjectName,
      chats: selectedChats,
      tabId: currentTabId,
      includeMarkdown,
      includeJson,
      createZip,
    });

    if (response && response.success) {
      const failedCount = response.failedChats?.length || 0;
      
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
          <div class="stat"><span class="stat-label">Folder</span><span class="stat-value">${escapeHtml(response.folderName || '')}</span></div>
          <div class="failed-chats-list" style="margin-top: 8px; font-size: 11px; color: #e74c3c;">
            <strong>Failed chats:</strong>
            <ul style="margin: 4px 0 0 16px; padding: 0;">${failedListHtml}</ul>
          </div>
        `;
      } else {
        // All succeeded
        showStatus(
          'success',
          `Done. ${response.chatCount} chat${response.chatCount !== 1 ? 's' : ''} exported. Check your Downloads folder.`
        );
        resultsEl.innerHTML = `
          <div class="stat"><span class="stat-label">Exported</span><span class="stat-value">${response.chatCount}</span></div>
          <div class="stat"><span class="stat-label">Folder</span><span class="stat-value">${escapeHtml(response.folderName || '')}</span></div>
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
