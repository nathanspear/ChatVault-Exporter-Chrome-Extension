/**
 * attachment-url-allowlist.js
 *
 * Strict HTTPS host allowlist for ChatGPT attachment downloads and filename
 * probing (HEAD / Range). Prevents credentialed fetch / download to arbitrary hosts
 * if a malicious URL were injected into the attachment pipeline.
 *
 * Loaded by background.js (importScripts) and content_scripts (before content.js).
 */
(function (root) {
  function normalizeHost(host) {
    return String(host || '')
      .toLowerCase()
      .replace(/\.$/, '');
  }

  /**
   * @param {string} host
   * @returns {boolean}
   */
  function isAllowedAttachmentHostname(host) {
    const h = normalizeHost(host);
    if (!h) return false;
    if (h === 'chatgpt.com' || h.endsWith('.chatgpt.com')) return true;
    if (h === 'chat.openai.com') return true;
    if (h === 'oaiusercontent.com' || h.endsWith('.oaiusercontent.com')) return true;
    return false;
  }

  /**
   * @param {string} urlString
   * @returns {boolean}
   */
  function isAllowedAttachmentDownloadUrl(urlString) {
    if (!urlString || typeof urlString !== 'string') return false;
    let u;
    try {
      u = new URL(urlString.trim());
    } catch {
      return false;
    }
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return isAllowedAttachmentHostname(u.hostname);
  }

  root.isAllowedChatVaultAttachmentHostname = isAllowedAttachmentHostname;
  root.isAllowedChatVaultAttachmentDownloadUrl = isAllowedAttachmentDownloadUrl;
})(typeof self !== 'undefined' ? self : this);
