// =============================================================================
// ChatVault Offscreen Document
// =============================================================================
// The Manifest V3 service worker has no URL.createObjectURL, so any export
// larger than DATA_URL_MAX_CHARS (see background.js) is handed to this page.
// It builds the Blob, returns a blob: URL that chrome.downloads.download can
// read, and revokes that URL when background.js reports the download finished
// or failed (chrome.downloads.onChanged).
//
// Protocol: chrome.runtime messages carrying target: 'offscreen'.
//   { action: 'createBlobUrl', content, mimeType } -> { success, url, size } or { success: false, error }
//   { action: 'revokeBlobUrl', url }               -> { success } or { success: false, error }
// Messages without target: 'offscreen' are ignored so the background and popup
// listeners keep handling their own traffic. No network, no telemetry.
// =============================================================================

function errorText(err) {
  return err && err.message ? err.message : String(err);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;

  if (message.action === 'createBlobUrl') {
    try {
      const mimeType = typeof message.mimeType === 'string' && message.mimeType
        ? message.mimeType
        : 'application/octet-stream';
      const content = typeof message.content === 'string'
        ? message.content
        : String(message.content ?? '');
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      sendResponse({ success: true, url, size: blob.size });
    } catch (err) {
      sendResponse({ success: false, error: errorText(err) });
    }
    return false;
  }

  if (message.action === 'revokeBlobUrl') {
    try {
      if (typeof message.url === 'string' && message.url.startsWith('blob:')) {
        URL.revokeObjectURL(message.url);
      }
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: errorText(err) });
    }
    return false;
  }

  sendResponse({ success: false, error: `Unknown offscreen action: ${String(message.action)}` });
  return false;
});
