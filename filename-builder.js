/**
 * filename-builder.js
 *
 * Single source of truth for all ChatVault export filenames.
 * Loaded by both content.js (via content_scripts) and background.js (via importScripts).
 *
 * Folder format:
 *   ChatVault-export--{Platform}--{ProjectSlug}--{YYYY-MM-DD}/
 *
 * Chat file format:
 *   ChatVault-export--{Platform}--{ProjectSlug}--{ChatSlug}--{chatStartedYYYY-MM-DD}--{exportYYYY-MM-DD}.{ext}
 *   chatStarted: first-message date when known, else literal "Unknown".
 *
 * Collision variant (same name already used in this export run):
 *   ChatVault-export--{Platform}--{ProjectSlug}--{ChatSlug}--{chatStarted}--{shortChatId}--{exportYYYY-MM-DD}.{ext}
 *
 * Platform values: ChatGPT, Claude, Perplexity, Gemini
 */

/**
 * Convert a raw name to a filename-safe slug.
 *
 * Rules (per spec):
 *   - Trim whitespace
 *   - Remove chars illegal on macOS/Windows: / \ : * ? " < > | and control chars
 *   - Replace whitespace sequences with a single hyphen
 *   - Keep letters, numbers, hyphen, underscore; remove everything else
 *   - Collapse multiple hyphens into one
 *   - Remove leading/trailing hyphens
 *   - Title-case each hyphen-separated word (deterministic)
 *   - Max 60 chars (applied before slug conversion)
 *
 * @param {string} text
 * @returns {string}  Empty string if input produces no safe characters.
 */
function slugForExport(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .slice(0, 60)
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '')  // remove illegal filename chars
    .replace(/\s+/g, '-')                      // whitespace → hyphen
    .replace(/[^\w-]/g, '')                    // keep only word chars + hyphen
    .replace(/-+/g, '-')                       // collapse hyphens
    .replace(/^-+|-+$/g, '')                   // strip leading/trailing hyphens
    .split('-')
    .map(function(word) {
      return word.length === 0 ? '' : word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('-');
}

function exportDateLocalYyyyMmDd(d) {
  d = d || new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1);
  if (m.length === 1) m = '0' + m;
  var day = String(d.getDate());
  if (day.length === 1) day = '0' + day;
  return y + '-' + m + '-' + day;
}

/** ISO 8601 timestamp with local offset (parseable by Date.parse), not UTC Zulu. */
function exportTimestampIsoOffset(d) {
  d = d || new Date();
  function pad(n, len) {
    len = len || 2;
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  }
  var y = d.getFullYear();
  var mo = pad(d.getMonth() + 1);
  var day = pad(d.getDate());
  var h = pad(d.getHours());
  var min = pad(d.getMinutes());
  var s = pad(d.getSeconds());
  var ms = pad(d.getMilliseconds(), 3);
  var tz = -d.getTimezoneOffset();
  var sign = tz >= 0 ? '+' : '-';
  var abs = Math.abs(tz);
  var ah = pad(Math.floor(abs / 60));
  var am = pad(abs % 60);
  return y + '-' + mo + '-' + day + 'T' + h + ':' + min + ':' + s + '.' + ms + sign + ah + ':' + am;
}

/** Human-readable local date and time for Markdown headers. */
function exportTimestampDisplay(d) {
  d = d || new Date();
  try {
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZoneName: 'short',
    });
  } catch (e) {
    return exportTimestampIsoOffset(d);
  }
}

/**
 * JSZip writes DOS mtimes using getUTC*() but unzip tools treat those fields as local wall time
 * (https://github.com/Stuk/jszip/issues/369). This value is for `new Date(ms)` so getUTC* match local clock.
 * Call from a window or content script (correct timezone); MV3 service workers often report UTC only.
 */
function msForJsZipDosLocalMtime(d) {
  d = d || new Date();
  return d.getTime() - d.getTimezoneOffset() * 60000;
}

/** Normalize chat-started segment: YYYY-MM-DD or "Unknown". */
function normalizeChatStartedSegment(v) {
  if (v == null || v === '') return 'Unknown';
  var s = String(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return 'Unknown';
}

/**
 * Build a deterministic export filename.
 *
 * @param {object}   opts
 * @param {string}   opts.platform     Platform name: 'chatgpt', 'claude', 'perplexity', 'gemini'
 * @param {string}   opts.projectName  Raw project name; falsy → "Unassigned"
 * @param {string}   opts.chatName     Raw chat title; falsy → "Untitled"
 * @param {string}   opts.ext          Extension without dot: "json", "md", "zip", etc.
 * @param {string}   [opts.chatStartedYyyyMmDd]  YYYY-MM-DD when chat began (best effort); else "Unknown"
 * @param {string}   [opts.exportDate] ISO date string or YYYY-MM-DD; defaults to today (local calendar date)
 * @param {string}   [opts.chatId]     Chat id used only for collision suffix derivation
 * @param {Set}      [opts.usedNames]  Mutable Set of base names already emitted this run;
 *                                     caller passes the same Set for all files in a batch
 * @returns {string} Full filename including extension
 */
function buildExportFilename(opts) {
  var platform    = opts.platform;
  var projectName = opts.projectName;
  var chatName    = opts.chatName;
  var ext         = opts.ext;
  var exportDate  = opts.exportDate;
  var chatId      = opts.chatId;
  var usedNames   = opts.usedNames;
  var startStr    = normalizeChatStartedSegment(opts.chatStartedYyyyMmDd);

  var dateStr = exportDate
    ? String(exportDate).slice(0, 10)
    : exportDateLocalYyyyMmDd();

  var platformSlug = slugForExport(platform) || 'Unknown';
  var pSlug = slugForExport(projectName) || 'Unassigned';
  var cSlug = slugForExport(chatName)    || 'Untitled';

  var baseName = 'ChatVault-export--' + platformSlug + '--' + pSlug + '--' + cSlug + '--' + startStr + '--' + dateStr;

  if (usedNames && usedNames.has(baseName)) {
    var shortId = (chatId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'x';
    var candidate = 'ChatVault-export--' + platformSlug + '--' + pSlug + '--' + cSlug + '--' + startStr + '--' + shortId + '--' + dateStr;
    var counter = 2;
    while (usedNames.has(candidate)) {
      candidate = 'ChatVault-export--' + platformSlug + '--' + pSlug + '--' + cSlug + '--' + startStr + '--' + shortId + counter + '--' + dateStr;
      counter++;
    }
    baseName = candidate;
  }

  if (usedNames) usedNames.add(baseName);

  return baseName + '.' + ext;
}

/**
 * Build the export folder name (no trailing slash).
 *
 * @param {object}  opts
 * @param {string}  opts.platform     Platform name: 'chatgpt', 'claude', 'perplexity', 'gemini'
 * @param {string}  opts.projectName  Raw project name; falsy → "Unassigned"
 * @param {string}  [opts.exportDate] ISO date or YYYY-MM-DD; defaults to today (local calendar date)
 * @returns {string} e.g. "ChatVault-export--ChatGPT--Job-Search--2026-02-21"
 */
function buildExportFolderName(opts) {
  var platform    = opts.platform;
  var projectName = opts.projectName;
  var exportDate  = opts.exportDate;
  var dateStr = exportDate
    ? String(exportDate).slice(0, 10)
    : exportDateLocalYyyyMmDd();
  var platformSlug = slugForExport(platform) || 'Unknown';
  var pSlug = slugForExport(projectName) || 'Unassigned';
  return 'ChatVault-export--' + platformSlug + '--' + pSlug + '--' + dateStr;
}

// Make available in both browser (window) and service worker (self) contexts.
(function(root) {
  root.slugForExport             = slugForExport;
  root.buildExportFilename       = buildExportFilename;
  root.buildExportFolderName     = buildExportFolderName;
  root.exportDateLocalYyyyMmDd   = exportDateLocalYyyyMmDd;
  root.exportTimestampIsoOffset  = exportTimestampIsoOffset;
  root.exportTimestampDisplay    = exportTimestampDisplay;
  root.msForJsZipDosLocalMtime     = msForJsZipDosLocalMtime;
  root.normalizeChatStartedSegment = normalizeChatStartedSegment;
})(typeof self !== 'undefined' ? self : this);
