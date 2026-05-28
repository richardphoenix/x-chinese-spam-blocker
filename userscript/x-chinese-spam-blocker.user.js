// ==UserScript==
// @name         X 中文 Spam 拦截器（寻固炮专用）
// @name:zh-CN   X 中文 Spam 拦截器（寻固炮专用）
// @namespace    https://github.com/richardphoenix/x-chinese-spam-blocker
// @version      0.9.1
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
    SUBMIT_BATCH_API: 'https://x-chinese-spam-blocker.vercel.app/api/submit/batch',
  };

  // ===================== STATE =====================
  let approvedBlocklistUserIds = new Set();   // Only accounts from the curated blocklist (safe for bulk blocking)
  let approvedBlocklistScreenNames = new Set();
  let approvedBlocklistEntries = [];          // Full entries (name/category/reason) for the viewer

  let activeKeywords = [];               // Loaded from remote spam-keywords.txt + fallback
  let hiddenItems = [];                  // Records of posts hidden this session (for the reviewer)
  let isHidingEnabled = true;

  // Advanced blocking system
  let isBlockingActive = false;
  let blockingQueue = [];
  let blockedThisSession = 0;
  let blockingPaused = false;

  // Local whitelist (persistent via GM storage) - highest priority to prevent false positives
  let localWhitelist = new Set(); // screen_names (lowercased) stored locally by the user

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

    // X doesn't expose user_id as a DOM attribute, but the avatar image URL
    // (pbs.twimg.com/profile_images/<user_id>/...) embeds it — reliable + free, no API.
    let userId = element.getAttribute('data-user-id') || null;
    if (!userId) {
      const avatar = element.querySelector('img[src*="/profile_images/"]');
      const m = avatar && (avatar.getAttribute('src') || '').match(/\/profile_images\/(\d+)\//);
      if (m) userId = m[1];
    }

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

    // 2. Very short tweet text + heavy emoji usage (new "小狗求抱抱" style)
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
              approvedBlocklistEntries = data;
              log(`[Approved Blocklist] Loaded ${approvedBlocklistEntries.length} accounts`);
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
    if (isWhitelisted(userInfo.screenName)) {
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

    // Capture content before collapsing (for the reviewer / hidden list)
    const info = extractUserInfo(element);
    const screenName = info ? info.screenName : null;
    const displayName = info ? info.displayName : '';
    const tweetText = info ? info.tweetText : '';
    const handle = screenName ? '@' + screenName : 'spam';

    element.dataset.spamHidden = 'true';

    // Collapse: hide the original content, leave only a thin bar
    const originalChildren = Array.from(element.children);
    originalChildren.forEach(c => { c.style.display = 'none'; });

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 14px;font-size:12px;color:#8899a6;border-bottom:1px solid #2f3336;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

    // "已隐藏 @handle" — built via textContent to avoid any HTML injection
    const text = document.createElement('span');
    const tag = document.createElement('span');
    tag.textContent = '已隐藏';
    tag.style.cssText = 'color:#f4212e;font-weight:600;';
    text.appendChild(tag);
    text.appendChild(document.createTextNode(' ' + handle));

    // Toggle the original content in place (展开 / 收起)
    const showBtn = document.createElement('span');
    showBtn.textContent = '显示';
    showBtn.style.cssText = 'color:#1d9bf0;cursor:pointer;';
    showBtn.onclick = (e) => {
      e.stopImmediatePropagation();
      const expanded = originalChildren[0] && originalChildren[0].style.display !== 'none';
      originalChildren.forEach(c => { c.style.display = expanded ? 'none' : ''; });
      showBtn.textContent = expanded ? '显示' : '收起';
    };

    // Shared false-positive recovery: whitelist (if possible) + reveal + drop from session list.
    // Reused by the in-place bar button and the "本次隐藏" reviewer modal.
    const record = { screenName, displayName, tweetText, userId: info ? info.userId : null, score: info ? calculateSpamScore(info) : 0, element };
    record.recover = async () => {
      if (screenName) await addToLocalWhitelist(screenName);
      originalChildren.forEach(c => { c.style.display = ''; });
      bar.remove();
      const i = hiddenItems.indexOf(record);
      if (i >= 0) hiddenItems.splice(i, 1);
      updateHiddenCount();
      updatePanelCount();
    };

    const whitelistBtn = document.createElement('span');
    whitelistBtn.textContent = '误杀→加白名单';
    whitelistBtn.style.cssText = 'color:#1d9bf0;cursor:pointer;margin-left:auto;';
    whitelistBtn.onclick = (e) => {
      e.stopImmediatePropagation();
      record.recover();
    };

    bar.appendChild(text);
    bar.appendChild(showBtn);
    bar.appendChild(whitelistBtn);
    element.insertBefore(bar, element.firstChild);

    hiddenItems.push(record);
    updateHiddenCount();
  }

  function updateHiddenCount() {
    const el = document.getElementById('x-spam-hidden');
    if (el) el.textContent = hiddenItems.length;
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

  // X's public web bearer token — the same one x.com's own web app sends.
  // Free: requests use your logged-in session cookies + this bearer + the ct0 CSRF token.
  const X_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

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
          'authorization': X_BEARER
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

  // Whitelist is keyed on screen_name (lowercased), because X does NOT expose
  // a stable user_id on timeline tweet/cell elements — the handle is what we
  // can reliably extract from the profile link.
  async function addToLocalWhitelist(screenName) {
    if (!screenName) return false;
    localWhitelist.add(String(screenName).toLowerCase());
    await saveLocalWhitelist();
    log(`Added @${screenName} to local whitelist`);
    return true;
  }

  // Check if an account is whitelisted (local > everything)
  function isWhitelisted(screenName) {
    if (!screenName) return false;
    return localWhitelist.has(String(screenName).toLowerCase());
  }

  async function removeFromLocalWhitelist(screenName) {
    localWhitelist.delete(String(screenName).toLowerCase());
    await saveLocalWhitelist();
    log(`Removed @${screenName} from local whitelist`);
  }

  // ===================== LIST VIEWER MODAL =====================

  function closeListModal() {
    const m = document.getElementById('x-spam-modal');
    if (m) m.remove();
  }

  // Generic modal. buildBody(box) appends rows; all text via textContent (no HTML injection).
  function openListModal(title, buildBody) {
    closeListModal();

    const overlay = document.createElement('div');
    overlay.id = 'x-spam-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) closeListModal(); };

    const box = document.createElement('div');
    box.style.cssText = 'background:#15202b;color:#fff;border:1px solid #38444d;border-radius:14px;padding:16px;min-width:300px;max-width:440px;max-height:70vh;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-weight:700;color:#1d9bf0;';
    const close = document.createElement('span');
    close.textContent = '✕';
    close.style.cssText = 'cursor:pointer;color:#8899a6;padding:0 4px;';
    close.onclick = closeListModal;
    head.appendChild(h);
    head.appendChild(close);
    box.appendChild(head);

    buildBody(box);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function openWhitelistModal() {
    openListModal(`本地白名单（${localWhitelist.size}）`, (box) => {
      if (localWhitelist.size === 0) {
        const p = document.createElement('div');
        p.textContent = '（空）你点「误杀→加白名单」加入的账号会出现在这里。';
        p.style.color = '#8899a6';
        box.appendChild(p);
        return;
      }
      Array.from(localWhitelist).sort().forEach((sn) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2f3336;';
        const name = document.createElement('span');
        name.textContent = '@' + sn;
        const rm = document.createElement('span');
        rm.textContent = '移除';
        rm.style.cssText = 'color:#f4212e;cursor:pointer;';
        rm.onclick = async () => {
          await removeFromLocalWhitelist(sn);
          row.remove();
          updatePanelCount();
        };
        row.appendChild(name);
        row.appendChild(rm);
        box.appendChild(row);
      });
    });
  }

  function openHiddenModal() {
    openListModal(`本次隐藏（${hiddenItems.length}）— 复查是否误杀`, (box) => {
      if (hiddenItems.length === 0) {
        const p = document.createElement('div');
        p.textContent = '（本次还没有隐藏任何推文）';
        p.style.color = '#8899a6';
        box.appendChild(p);
        return;
      }
      hiddenItems.slice().forEach((item) => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px 0;border-bottom:1px solid #2f3336;';

        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';
        const who = document.createElement('span');
        who.textContent = (item.displayName || '') + (item.screenName ? '  @' + item.screenName : '');
        who.style.cssText = 'font-weight:600;';
        const recover = document.createElement('span');
        recover.textContent = '恢复并加白';
        recover.style.cssText = 'color:#1d9bf0;cursor:pointer;white-space:nowrap;';
        recover.onclick = async () => {
          await item.recover();
          row.remove();
        };
        head.appendChild(who);
        head.appendChild(recover);
        row.appendChild(head);

        const body = document.createElement('div');
        body.style.cssText = 'color:#8899a6;font-size:12px;margin-top:4px;white-space:pre-wrap;word-break:break-word;';
        body.textContent = item.tweetText || '（无文字内容，可能是纯图片/emoji）';
        row.appendChild(body);

        box.appendChild(row);
      });
    });
  }

  function openBlocklistModal() {
    openListModal(`正式黑名单（${approvedBlocklistEntries.length}）`, (box) => {
      if (approvedBlocklistEntries.length === 0) {
        const p = document.createElement('div');
        p.textContent = '（空 / 未加载）维护者审核通过的账号会出现在这里。';
        p.style.color = '#8899a6';
        box.appendChild(p);
        return;
      }
      approvedBlocklistEntries.forEach((e) => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 0;border-bottom:1px solid #2f3336;';
        const line1 = document.createElement('div');
        line1.textContent = (e.name || '(无名)') + (e.screen_name ? '  @' + e.screen_name : '');
        const meta = [e.category, e.reason].filter(Boolean).join(' · ');
        row.appendChild(line1);
        if (meta) {
          const line2 = document.createElement('div');
          line2.style.cssText = 'color:#8899a6;font-size:11px;margin-top:2px;';
          line2.textContent = meta;
          row.appendChild(line2);
        }
        box.appendChild(row);
      });
    });
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
  // Resolve a record's user_id, re-extracting from the live element if the
  // hide-time value was missing (X avatars lazy-load, so it may be ready now).
  function recordUserId(rec) {
    if (rec.userId) return rec.userId;
    if (rec.element && rec.element.isConnected) {
      const fresh = extractUserInfo(rec.element);
      if (fresh && fresh.userId) {
        rec.userId = fresh.userId;
        return fresh.userId;
      }
    }
    return null;
  }

  // Submit ALL accounts hidden this session in ONE batch request (server dedups by user_id).
  async function submitAllHidden() {
    if (hiddenItems.length === 0) {
      alert('本次没有被隐藏的账号可提交。');
      return;
    }

    const accounts = [];
    let skipped = 0;
    hiddenItems.forEach((rec) => {
      const userId = recordUserId(rec);
      if (!userId) { skipped++; return; }
      accounts.push({
        user_id: String(userId),
        screen_name: rec.screenName || '',
        display_name: rec.displayName || '',
        tweet_text: rec.tweetText || '',
        source_url: window.location.href,
        detected_reasons: ['userscript-report'],
        detected_score: rec.score || 0,
      });
    });

    if (accounts.length === 0) {
      alert('没有可提交的隐藏账号（取不到 user_id，请向上滚动让头像加载后重试）。');
      return;
    }

    updatePanelStatus(`正在提交 ${accounts.length} 个账号...`);
    GM_xmlhttpRequest({
      method: 'POST',
      url: CONFIG.SUBMIT_BATCH_API,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ accounts }),
      onload: (res) => {
        try {
          const d = JSON.parse(res.responseText);
          const extra = skipped ? `，跳过 ${skipped}（无 ID）` : '';
          updatePanelStatus(`提交完成：新增 ${d.created}，已存在 ${d.duplicate}${d.invalid ? `，无效 ${d.invalid}` : ''}${extra}`);
        } catch {
          updatePanelStatus(res.status >= 200 && res.status < 300 ? '提交完成' : `提交失败(${res.status})`);
        }
        setTimeout(() => updatePanelStatus('就绪'), 6000);
      },
      onerror: () => {
        updatePanelStatus('提交失败，请稍后重试');
        setTimeout(() => updatePanelStatus('就绪'), 5000);
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
      <div class="title">🛡️ X 中文 Spam 拦截器 v0.9.1</div>
      <div class="status" id="x-spam-status">正在加载维护者黑名单 + 检测规则...</div>
      
      <div class="row">
        <button id="x-spam-toggle-hide">隐藏已开启</button>
        <button id="x-spam-submit" class="secondary">提交全部隐藏账号</button>
      </div>

      <div class="row" style="margin-top: 6px;">
        <button id="x-spam-block-approved" class="danger">从维护者黑名单拉黑</button>
        <button id="x-spam-pause" class="secondary" style="display:none;">暂停</button>
        <button id="x-spam-cancel" class="secondary" style="display:none;">取消</button>
      </div>

      <div style="margin-top:8px;font-size:11px;color:#8899a6; display:flex; gap:12px; flex-wrap: wrap;">
        <span id="x-spam-blocklist-open" style="cursor:pointer;text-decoration:underline;">正式黑名单：<span id="x-spam-count">0</span></span>
        <span id="x-spam-hidden-open" style="cursor:pointer;text-decoration:underline;">本次隐藏：<span id="x-spam-hidden">0</span></span>
        <span id="x-spam-whitelist-open" style="cursor:pointer;text-decoration:underline;">本地白名单：<span id="x-spam-whitelist">0</span></span>
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
    document.getElementById('x-spam-submit').addEventListener('click', submitAllHidden);

    // List viewers
    document.getElementById('x-spam-blocklist-open').addEventListener('click', openBlocklistModal);
    document.getElementById('x-spam-whitelist-open').addEventListener('click', openWhitelistModal);
    document.getElementById('x-spam-hidden-open').addEventListener('click', openHiddenModal);

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
    if (countEl) countEl.textContent = approvedBlocklistEntries.length;

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
