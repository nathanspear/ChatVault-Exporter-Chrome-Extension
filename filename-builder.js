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
 *   ChatVault-export--{Platform}--{ProjectSlug}--{ChatSlug}--{YYYY-MM-DD}.{ext}
 *
 * Collision variant (same name already used in this export run):
 *   ChatVault-export--{Platform}--{ProjectSlug}--{ChatSlug}--{shortChatId}--{YYYY-MM-DD}.{ext}
 *
 * Platform values: ChatGPT, Claude, Perplexity, Gemini, Grok
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

/**
 * Build a deterministic export filename.
 *
 * @param {object}   opts
 * @param {string}   opts.platform     Platform name: 'chatgpt', 'claude', 'perplexity', 'gemini', 'grok'
 * @param {string}   opts.projectName  Raw project name; falsy → "Unassigned"
 * @param {string}   opts.chatName     Raw chat title; falsy → "Untitled"
 * @param {string}   opts.ext          Extension without dot: "json", "md", "zip", etc.
 * @param {string}   [opts.exportDate] ISO date string or YYYY-MM-DD; defaults to today (UTC)
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

  var dateStr = exportDate
    ? String(exportDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  var platformSlug = slugForExport(platform) || 'Unknown';
  var pSlug = slugForExport(projectName) || 'Unassigned';
  var cSlug = slugForExport(chatName)    || 'Untitled';

  var baseName = 'ChatVault-export--' + platformSlug + '--' + pSlug + '--' + cSlug + '--' + dateStr;

  if (usedNames && usedNames.has(baseName)) {
    var shortId = (chatId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'x';
    var candidate = 'ChatVault-export--' + platformSlug + '--' + pSlug + '--' + cSlug + '--' + shortId + '--' + dateStr;
    var counter = 2;
    while (usedNames.has(candidate)) {
      candidate = 'ChatVault-export--' + platformSlug + '--' + pSlug + '--' + cSlug + '--' + shortId + counter + '--' + dateStr;
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
 * @param {string}  opts.platform     Platform name: 'chatgpt', 'claude', 'perplexity', 'gemini', 'grok'
 * @param {string}  opts.projectName  Raw project name; falsy → "Unassigned"
 * @param {string}  [opts.exportDate] ISO date or YYYY-MM-DD; defaults to today (UTC)
 * @returns {string} e.g. "ChatVault-export--ChatGPT--Job-Search--2026-02-21"
 */
function buildExportFolderName(opts) {
  var platform    = opts.platform;
  var projectName = opts.projectName;
  var exportDate  = opts.exportDate;
  var dateStr = exportDate
    ? String(exportDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  var platformSlug = slugForExport(platform) || 'Unknown';
  var pSlug = slugForExport(projectName) || 'Unassigned';
  return 'ChatVault-export--' + platformSlug + '--' + pSlug + '--' + dateStr;
}

// Make available in both browser (window) and service worker (self) contexts.
(function(root) {
  root.slugForExport        = slugForExport;
  root.buildExportFilename  = buildExportFilename;
  root.buildExportFolderName = buildExportFolderName;
})(typeof self !== 'undefined' ? self : this);
