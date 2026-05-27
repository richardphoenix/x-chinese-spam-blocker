// ==UserScript==
// @name         X 中文 Spam 拦截器（寻固炮专用）
// @name:zh-CN   X 中文 Spam 拦截器（寻固炮专用）
// @namespace    https://github.com/richardphoenix/x-chinese-spam-blocker
// @version      0.6.0
// @updateURL    https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/userscript/x-chinese-spam-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/userscript/x-chinese-spam-blocker.user.js
// @description  自动隐藏并可批量拉黑中文 X 上的“寻固炮”等垃圾账号。支持远程黑名单订阅 + 实时时间线过滤。
// @description:zh-CN 自动隐藏并可批量拉黑中文 X 上的“寻固炮”等垃圾账号。支持远程黑名单订阅 + 实时时间线过滤。
// @author       Richard + Grok
// @license      MIT
// @match        *://x.com/*
// @match        *://twitter.com/*
// @exclude      *://x.com/settings*
// @exclude      *://twitter.com/settings*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @connect      api.x.com
// @connect      x.com
// @connect      vercel.app
// @run-at       document-end
// ==/UserScript==

/**
 * X Chinese Spam Blocker
 * Focused on "寻固炮" and similar Chinese low-quality / scam spam campaigns.
 *
 * Architecture:
 * - Loads remote blocklist (GitHub JSON) + local keywords
 * - Uses MutationObserver to hide matching tweets in real-time (primary defense)
 * - Optional safe mass blocking via X's internal endpoints
 * - Report button to help community grow the blocklist
 *
 * Safety first: Hiding is always on. Mass blocking requires explicit user action + delays.
 */

(function () {
  'use strict';

  // ===================== CONFIG =====================
  const CONFIG = {
    // Remote approved blocklist (only these accounts are allowed for bulk blocking)
    BLOCKLIST_URL: 'https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/blocklist/blocklist.json',

    // How often to refresh remote list (ms)
    BLOCKLIST_REFRESH_MS: 1000 * 60 * 60 * 6, // 6 hours

    // Remote keywords (for hiding / heuristic detection)
    KEYWORDS_URL: 'https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/blocklist/spam-keywords.txt',

    // Hardcoded minimal fallback (used if remote fails)
    FALLBACK_KEYWORDS: [
      '寻固炮', '固炮', '找固搭', '固搭', '真心寻固炮',
      '只进入身体', '不进入生活', '长期炮友', '同城上门'
    ],

    // === Blocking Configuration ===
    BLOCK_DELAY_MS: 10000,          // 10 seconds between blocks (user requested)
    MAX_BLOCK_PER_SESSION: 80,      // Increased but still capped

    // UI
    PANEL_Z_INDEX: 999999,

    // Backend submission API. Update to the deployed domain after first deploy.
    SUBMIT_API: 'https://x-chinese-spam-blocker.vercel.app/api/submit',
  };

  // ===================== STATE =====================
  let approvedBlocklistUserIds = new Set();   // Only accounts from the curated blocklist (safe for bulk blocking)
  let approvedBlocklistScreenNames = new Set();

  let activeKeywords = [];               // Loaded from remote spam-keywords.txt + fallback
  let hiddenThisSession = 0;
  let isHidingEnabled = true;

  // Advanced blocking system
  let isBlockingActive = false;
  let blockingQueue = [];
  let blockedThisSession = 0;
  let blockingPaused = false;

  // Local whitelist (persistent via GM storage) - highest priority to prevent false positives
  let localWhitelist = new Set(); // user_ids stored locally by the user

  // ===================== UTILITIES =====================

  function log(...args) {
    console.log('[X-Spam-Blocker]', ...args);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Extract user info + tweet text from a tweet article or user cell
  function extractUserInfo(element) {
    if (!element) return null;

    // User name link
    const userNameLink = element.querySelector('a[href*="/"][role="link"]') ||
                         element.querySelector('div[data-testid="User-Name"] a[role="link"]');

    if (!userNameLink) return null;

    const href = userNameLink.getAttribute('href') || '';
    const screenNameMatch = href.match(/\/([A-Za-z0-9_]+)$/);
    const screenName = screenNameMatch ? screenNameMatch[1] : null;

    const userId = element.getAttribute('data-user-id') || null;

    // Display name
    const displayNameEl = element.querySelector('div[data-testid="User-Name"] span') ||
                          element.querySelector('a[role="link"] span');
    const displayName = displayNameEl ? displayNameEl.textContent.trim() : '';

    // Tweet text (very important for new variants)
    const tweetTextEl = element.querySelector('div[data-testid="tweetText"]');
    const tweetText = tweetTextEl ? tweetTextEl.textContent.trim() : '';

    return { screenName, userId, displayName, tweetText, element };
  }

  // Calculate spam probability score (0-100)
  // Higher score = more likely to be spam
  function calculateSpamScore(userInfo) {
    if (!userInfo) return 0;

    let score = 0;
    const { screenName, displayName, tweetText } = userInfo;

    const combinedText = `${displayName} ${tweetText}`.toLowerCase();

    // 1. Keyword match (strong signal)
    const keywordHits = activeKeywords.filter(kw => combinedText.includes(kw.toLowerCase())).length;
    if (keywordHits > 0) {
      score += 35 + (keywordHits * 8); // Base 35 + bonus per extra keyword
    }

    // 2. Suspicious handle pattern: English/Name + 5+ digits (very common in this spam)
    // Examples: Frank8408766657, CherryHans44645, MignonB78162
    if (screenName && /^[A-Za-z]{2,}[A-Za-z0-9]*[0-9]{5,}$/.test(screenName)) {
      score += 28;
    }

    // 3. Very short tweet text + heavy emoji usage (new "小狗求抱抱" style)
    if (tweetText && tweetText.length > 0 && tweetText.length < 25) {
      const emojiCount = (tweetText.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu) || []).length;
      if (emojiCount >= 3) {
        score += 22; // Short + many emojis = high risk
      } else if (emojiCount >= 1 && tweetText.length < 15) {
        score += 12;
      }
    }

    // 4. Display name contains spam keywords (old 寻固炮 style)
    if (displayName && isSimpleKeywordMatch(displayName)) {
      score += 30;
    }

    // 5. Extremely low effort content (only emojis or very repetitive)
    if (tweetText && /^[\s\W\d\U0001F300-\U0001F9FF]+$/.test(tweetText) && tweetText.length > 5) {
      score += 15;
    }

    return Math.min(score, 100);
  }

  // Simple keyword check (used internally)
  function isSimpleKeywordMatch(text) {
    if (!text || activeKeywords.length === 0) return false;
    const lower = text.toLowerCase();
    return activeKeywords.some(kw => lower.includes(kw.toLowerCase()));
  }

  // ===================== BLOCKLIST LOADING =====================

  // Load the CURATED / APPROVED blocklist from maintainer
  // These accounts are considered high-confidence and safe for bulk blocking.
  async function loadApprovedBlocklist() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: CONFIG.BLOCKLIST_URL + '?t=' + Date.now(),
        onload: function (res) {
          try {
            const data = JSON.parse(res.responseText);
            if (Array.isArray(data)) {
              approvedBlocklistUserIds.clear();
              approvedBlocklistScreenNames.clear();

              data.forEach(entry => {
                if (entry.user_id) approvedBlocklistUserIds.add(String(entry.user_id));
                if (entry.screen_name) approvedBlocklistScreenNames.add(entry.screen_name.toLowerCase());
              });
              log(`[Approved Blocklist] Loaded ${approvedBlocklistUserIds.size} accounts`);
            }
          } catch (e) {
            log('Failed to parse approved blocklist', e);
          }
          resolve();
        },
        onerror: function () {
          log('Failed to load approved blocklist');
          resolve();
        }
      });
    });
  }

  async function loadRemoteKeywords() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: CONFIG.KEYWORDS_URL + '?t=' + Date.now(),
        onload: function (res) {
          try {
            const lines = res.responseText
              .split('\n')
              .map(l => l.trim())
              .filter(l => l && !l.startsWith('#'));

            activeKeywords = [...new Set([...lines, ...CONFIG.FALLBACK_KEYWORDS])];
            log(`Loaded ${activeKeywords.length} spam keywords`);
          } catch (e) {
            activeKeywords = [...CONFIG.FALLBACK_KEYWORDS];
            log('Failed to load remote keywords, using fallback only');
          }
          resolve();
        },
        onerror: function () {
          activeKeywords = [...CONFIG.FALLBACK_KEYWORDS];
          log('Failed to load remote keywords (using fallback)');
          resolve();
        }
      });
    });
  }

  // ===================== HIDING LOGIC (MUTATION OBSERVER) =====================

  function shouldHide(userInfo) {
    if (!userInfo) return false;

    const uid = String(userInfo.userId || '');

    // 0. Local whitelist has highest priority (never hide or block these)
    if (isWhitelisted(uid)) {
      return false;
    }

    // 1. Exact match from MAINTAINER-APPROVED blocklist (highest confidence)
    if (uid && approvedBlocklistUserIds.has(uid)) {
      return true;
    }
    if (userInfo.screenName && approvedBlocklistScreenNames.has(userInfo.screenName.toLowerCase())) {
      return true;
    }

    // 2. Heuristic scoring system (used for hiding, NOT for bulk blocking)
    const score = calculateSpamScore(userInfo);

    if (score >= 40) {
      return true;
    }

    return false;
  }

  function hideElement(element) {
    if (!element || element.dataset.spamHidden === 'true') return;

    element.style.transition = 'opacity 0.2s ease';
    element.style.opacity = '0.05';
    element.style.pointerEvents = 'none';
    element.dataset.spamHidden = 'true';

    hiddenThisSession++;
    updateHiddenCount();

    // Label
    const label = document.createElement('div');
    label.textContent = '已隐藏：spam';
    label.style.cssText = 'position:absolute;right:8px;top:8px;font-size:10px;color:#f4212e;background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:4px;';

    // Quick "Add to local whitelist" button on the hidden item (great for false positive recovery)
    const whitelistBtn = document.createElement('div');
    whitelistBtn.textContent = '误杀 → 加白名单';
    whitelistBtn.style.cssText = 'position:absolute;right:8px;bottom:6px;font-size:9px;color:#1d9bf0;background:rgba(0,0,0,0.5);padding:1px 5px;border-radius:3px;cursor:pointer;';
    whitelistBtn.onclick = async (e) => {
      e.stopImmediatePropagation();
      const info = extractUserInfo(element);
      if (info && info.userId) {
        await addToLocalWhitelist(info.userId, info.screenName);
        element.style.opacity = '1';
        element.style.pointerEvents = 'auto';
        whitelistBtn.remove();
        label.textContent = '已加入本地白名单';
        updatePanelCount();
      }
    };

    element.style.position = 'relative';
    element.appendChild(label);
    element.appendChild(whitelistBtn);
  }

  function updateHiddenCount() {
    const el = document.getElementById('x-spam-hidden');
    if (el) el.textContent = hiddenThisSession;
  }

  function scanAndHide() {
    if (!isHidingEnabled) return;

    // Main timeline tweets
    document.querySelectorAll('article[data-testid="tweet"]:not([data-spam-scanned])').forEach(article => {
      article.dataset.spamScanned = 'true';
      const info = extractUserInfo(article);
      if (shouldHide(info)) {
        hideElement(article.closest('div[data-testid="cellInnerDiv"]') || article);
        // Optional debug log
        // console.log('[SpamBlocker] Hidden post with score', calculateSpamScore(info), info);
      }
    });

    // User cells (search, lists, followers, "who to follow" etc.)
    document.querySelectorAll('div[data-testid="UserCell"]:not([data-spam-scanned])').forEach(cell => {
      cell.dataset.spamScanned = 'true';
      const info = extractUserInfo(cell);
      if (shouldHide(info)) {
        hideElement(cell);
      }
    });
  }

  function startObserver() {
    const observer = new MutationObserver(() => {
      scanAndHide();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial scan
    setTimeout(scanAndHide, 800);
    // Periodic re-scan (catches some edge cases)
    setInterval(scanAndHide, 4000);
  }

  // ===================== MASS BLOCKING =====================

  async function getCsrfToken() {
    const match = document.cookie.match(/ct0=([^;]+)/);
    return match ? match[1] : null;
  }

  async function blockUserById(userId) {
    const csrf = await getCsrfToken();
    if (!csrf) throw new Error('无法获取 CSRF token');

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://x.com/i/api/1.1/blocks/create.json',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-csrf-token': csrf,
          'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
        },
        data: `user_id=${userId}`,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve();
          } else {
            reject(new Error(`Block failed: ${res.status}`));
          }
        },
        onerror: reject
      });
    });
  }

  // ===================== LOCAL WHITELIST MANAGEMENT =====================

  async function loadLocalWhitelist() {
    try {
      const saved = await GM_getValue('local_whitelist', []);
      localWhitelist = new Set(saved);
      log(`Loaded ${localWhitelist.size} accounts from local whitelist`);
    } catch (e) {
      localWhitelist = new Set();
    }
  }

  async function saveLocalWhitelist() {
    await GM_setValue('local_whitelist', Array.from(localWhitelist));
  }

  async function addToLocalWhitelist(userId, screenName = '') {
    if (!userId) return false;
    localWhitelist.add(String(userId));
    await saveLocalWhitelist();
    log(`Added ${userId} to local whitelist`);
    return true;
  }

  // Check if an account is whitelisted (local > everything)
  function isWhitelisted(userId, screenName = '') {
    if (!userId) return false;
    return localWhitelist.has(String(userId));
  }

  // ===================== NEW ADVANCED BLOCKING SYSTEM =====================

  /**
   * Start bulk blocking from the APPROVED remote blocklist only.
   * Shows a preview list first so user can deselect false positives.
   */
  async function startBulkBlockFromApprovedList() {
    if (isBlockingActive) {
      alert('已有拉黑任务正在进行中');
      return;
    }

    const approvedCount = approvedBlocklistUserIds.size;
    if (approvedCount === 0) {
      alert('当前没有加载到维护者审核的黑名单账号');
      return;
    }

    // Take a reasonable preview size
    const previewSize = Math.min(approvedCount, 50);
    const idsForPreview = Array.from(approvedBlocklistUserIds).slice(0, previewSize);

    // Simple preview using confirm + list (can be improved to a real modal later)
    const previewList = idsForPreview.slice(0, 15).map(id => `• ${id}`).join('\n');
    const moreText = idsForPreview.length > 15 ? `\n... 还有 ${idsForPreview.length - 15} 个` : '';

    const msg = `即将从维护者黑名单中拉黑以下账号（前15个预览）：\n\n${previewList}${moreText}\n\n` +
      `总计：${idsForPreview.length} 个账号\n` +
      `间隔：10秒/个\n\n` +
      `确认后开始执行（可中途暂停/取消）。`;

    if (!confirm(msg)) return;

    // Prepare queue (filter out anything already in local whitelist just in case)
    const idsToBlock = idsForPreview.filter(id => !isWhitelisted(id));

    if (idsToBlock.length === 0) {
      alert('所有待拉黑账号都在你的本地白名单中，已跳过。');
      return;
    }

    blockingQueue = idsToBlock.map(id => ({ userId: id }));
    blockedThisSession = 0;
    isBlockingActive = true;
    blockingPaused = false;

    updatePanelStatus(`开始从维护者黑名单拉黑 ${blockingQueue.length} 个账号...`);
    await processBlockingQueue();
  }

  async function processBlockingQueue() {
    const total = blockingQueue.length + blockedThisSession;

    while (blockingQueue.length > 0 && isBlockingActive && !blockingPaused) {
      const item = blockingQueue.shift();
      const remaining = blockingQueue.length;
      const done = blockedThisSession;

      // Show nice progress
      updatePanelStatus(`拉黑中 ${done + 1}/${total}（剩余 ${remaining}） - 10秒间隔`);

      // Double-check whitelist right before blocking
      if (isWhitelisted(item.userId)) {
        log(`Skipped whitelisted account: ${item.userId}`);
        await sleep(300);
        continue;
      }

      try {
        await blockUserById(item.userId);
        blockedThisSession++;
        await sleep(CONFIG.BLOCK_DELAY_MS);
      } catch (err) {
        console.error('[Block Queue] Failed to block', item.userId, err);

        if (String(err).includes('429') || String(err.message || '').includes('limit')) {
          updatePanelStatus('触发 X 频率限制，自动暂停 30 分钟...');
          await sleep(30 * 60 * 1000);
        } else {
          await sleep(6000);
        }
      }
    }

    if (blockingQueue.length === 0 && isBlockingActive) {
      updatePanelStatus(`✅ 批量拉黑完成！本次成功 ${blockedThisSession} 个`);
      isBlockingActive = false;
      setTimeout(() => updatePanelStatus('就绪'), 6000);
    }
  }

  function pauseBlocking() {
    if (isBlockingActive) {
      blockingPaused = true;
      updatePanelStatus('拉黑已暂停');
    }
  }

  function resumeBlocking() {
    if (isBlockingActive && blockingPaused) {
      blockingPaused = false;
      updatePanelStatus('继续拉黑...');
      processBlockingQueue();
    }
  }

  function cancelBlocking() {
    isBlockingActive = false;
    blockingPaused = false;
    blockingQueue = [];
    updatePanelStatus('拉黑任务已取消');
    setTimeout(() => updatePanelStatus('就绪'), 3000);
  }

  /**
   * Allow users to submit suspicious accounts to the maintainer for review.
   * This does NOT directly add to the blocklist. Submissions go through GitHub Issues for audit.
   */
  function submitCurrentSpamToDatabase() {
    const visibleSpam = document.querySelector('article[data-testid="tweet"][data-spam-hidden="true"]') ||
                        document.querySelector('div[data-testid="UserCell"][data-spam-hidden="true"]');

    if (!visibleSpam) {
      alert('未找到当前页面已识别的 spam，请先让脚本隐藏到 spam 后再提交。');
      return;
    }

    const info = extractUserInfo(visibleSpam);
    if (!info || !info.userId) {
      alert('无法获取该账号的 user_id，暂时无法提交。');
      return;
    }

    const payload = {
      user_id: String(info.userId),
      screen_name: info.screenName || '',
      display_name: info.displayName || '',
      tweet_text: info.tweetText || '',
      source_url: window.location.href,
      detected_reasons: ['userscript-report'],
      detected_score: calculateSpamScore(info),
    };

    updatePanelStatus('正在提交到审核队列...');
    GM_xmlhttpRequest({
      method: 'POST',
      url: CONFIG.SUBMIT_API,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      onload: (res) => {
        try {
          const data = JSON.parse(res.responseText);
          updatePanelStatus(data.message || '已提交，等待审核');
        } catch {
          updatePanelStatus(res.status === 200 ? '已提交，等待审核' : '提交失败');
        }
        setTimeout(() => updatePanelStatus('就绪'), 4000);
      },
      onerror: () => {
        updatePanelStatus('提交失败，请稍后重试');
        setTimeout(() => updatePanelStatus('就绪'), 4000);
      },
    });
  }

  // ===================== UI PANEL =====================

  let panelEl = null;

  function createPanel() {
    if (panelEl) return panelEl;

    GM_addStyle(`
      #x-spam-panel {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: ${CONFIG.PANEL_Z_INDEX};
        background: #15202b;
        color: #fff;
        border: 1px solid #38444d;
        border-radius: 16px;
        padding: 12px 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        min-width: 260px;
      }
      #x-spam-panel .title {
        font-weight: 700;
        margin-bottom: 8px;
        color: #1d9bf0;
      }
      #x-spam-panel .status {
        font-size: 12px;
        color: #8899a6;
        margin-bottom: 10px;
      }
      #x-spam-panel button {
        background: #1d9bf0;
        color: #fff;
        border: none;
        border-radius: 9999px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        margin-right: 6px;
        margin-bottom: 4px;
      }
      #x-spam-panel button.secondary {
        background: #38444d;
      }
      #x-spam-panel button.danger {
        background: #f4212e;
      }
      #x-spam-panel .row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
    `);

    panelEl = document.createElement('div');
    panelEl.id = 'x-spam-panel';
    panelEl.innerHTML = `
      <div class="title">🛡️ X 中文 Spam 拦截器 v0.6</div>
      <div class="status" id="x-spam-status">正在加载维护者黑名单 + 检测规则...</div>
      
      <div class="row">
        <button id="x-spam-toggle-hide">隐藏已开启</button>
        <button id="x-spam-submit" class="secondary">提交此账号到黑名单</button>
      </div>

      <div class="row" style="margin-top: 6px;">
        <button id="x-spam-block-approved" class="danger">从维护者黑名单拉黑</button>
        <button id="x-spam-pause" class="secondary" style="display:none;">暂停</button>
        <button id="x-spam-cancel" class="secondary" style="display:none;">取消</button>
      </div>

      <div style="margin-top:8px;font-size:11px;color:#8899a6; display:flex; gap:12px; flex-wrap: wrap;">
        <span>正式黑名单：<span id="x-spam-count">0</span></span>
        <span>本次隐藏：<span id="x-spam-hidden">0</span></span>
        <span>本地白名单：<span id="x-spam-whitelist">0</span></span>
      </div>
    `;

    document.body.appendChild(panelEl);

    // Wire buttons
    document.getElementById('x-spam-toggle-hide').addEventListener('click', () => {
      isHidingEnabled = !isHidingEnabled;
      document.getElementById('x-spam-toggle-hide').textContent = isHidingEnabled ? '隐藏已开启' : '隐藏已关闭';
      if (isHidingEnabled) scanAndHide();
    });

    // Main strong blocking button - only uses approved remote blocklist
    document.getElementById('x-spam-block-approved').addEventListener('click', startBulkBlockFromApprovedList);

    // Pause / Cancel controls (shown during blocking)
    const pauseBtn = document.getElementById('x-spam-pause');
    const cancelBtn = document.getElementById('x-spam-cancel');

    if (pauseBtn) pauseBtn.addEventListener('click', () => {
      if (blockingPaused) {
        resumeBlocking();
        pauseBtn.textContent = '暂停';
      } else {
        pauseBlocking();
        pauseBtn.textContent = '继续';
      }
    });

    if (cancelBtn) cancelBtn.addEventListener('click', cancelBlocking);

    // Community submission button (opens GitHub issue for review)
    document.getElementById('x-spam-submit').addEventListener('click', submitCurrentSpamToDatabase);

    return panelEl;
  }

  function updatePanelStatus(text) {
    const el = document.getElementById('x-spam-status');
    if (el) el.textContent = text;

    // Show/hide pause and cancel buttons during blocking
    const pauseBtn = document.getElementById('x-spam-pause');
    const cancelBtn = document.getElementById('x-spam-cancel');
    const blockBtn = document.getElementById('x-spam-block-approved');

    if (isBlockingActive) {
      if (pauseBtn) pauseBtn.style.display = 'inline-block';
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      if (blockBtn) blockBtn.style.display = 'none';
    } else {
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (blockBtn) blockBtn.style.display = 'inline-block';
    }
  }

  function updatePanelCount() {
    const countEl = document.getElementById('x-spam-count');
    if (countEl) countEl.textContent = approvedBlocklistUserIds.size + approvedBlocklistScreenNames.size;

    const whitelistEl = document.getElementById('x-spam-whitelist');
    if (whitelistEl) whitelistEl.textContent = localWhitelist.size;
  }

  // ===================== INIT =====================

  async function init() {
    log('Initializing X Chinese Spam Blocker...');

    createPanel();

    // Load remote data + local whitelist in parallel
    await Promise.all([
      loadApprovedBlocklist(),
      loadRemoteKeywords(),
      loadLocalWhitelist()
    ]);

    updatePanelCount();
    updatePanelStatus('维护者黑名单 + 本地白名单 + 智能隐藏已就绪（10秒安全拉黑）');

    // Start hiding
    startObserver();

    // Periodic refresh of approved blocklist
    setInterval(async () => {
      await loadApprovedBlocklist();
      updatePanelCount();
    }, CONFIG.BLOCKLIST_REFRESH_MS);

    // Register menu command
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('打开 Spam 拦截器面板', () => {
        if (panelEl) panelEl.style.display = panelEl.style.display === 'none' ? 'block' : 'none';
      });
    }

    log('Initialization complete. Hiding active.');
  }

  // Boot
  init();

})();
