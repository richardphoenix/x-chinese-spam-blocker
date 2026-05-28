// ==UserScript==
// @name         X 中文 Spam 拦截器（寻固炮专用）
// @name:zh-CN   X 中文 Spam 拦截器（寻固炮专用）
// @namespace    https://github.com/richardphoenix/x-chinese-spam-blocker
// @version      0.11.2
// @updateURL    https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/userscript/x-chinese-spam-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/userscript/x-chinese-spam-blocker.user.js
// @description  自动隐藏并可批量拉黑中文 X 上的“寻固炮”等垃圾账号。支持远程黑名单订阅 + 实时时间线过滤。
// @description:zh-CN 自动隐藏并可批量拉黑中文 X 上的“寻固炮”等垃圾账号。支持远程黑名单订阅 + 实时时间线过滤。
// @author       Richard + Claude
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

  // Local manual blocklist (persistent) - accounts the user hid by hand via the per-tweet button.
  // Map: screen_name (lowercased) -> user_id (string) | null. user_id lets us submit them later.
  let localBlocklist = new Map();

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
    // X renders emoji as <img> (stripped from textContent), so count them separately.
    const emojiCount = tweetTextEl ? tweetTextEl.querySelectorAll('img').length : 0;

    return { screenName, userId, displayName, tweetText, emojiCount, element };
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

    // 6. Bot pattern: gibberish ASCII display name whose handle is exactly that
    //    name lowercased + digits (e.g. "Hqzbrc" / @hqzbrc85482). The 全国安排
    //    escort-spam family — its only spam marker is in the avatar image, so
    //    text keywords miss it. Require low-vowel gibberish to spare real
    //    english-named accounts.
    if (screenName && displayName && /^[A-Za-z]{5,12}$/.test(displayName)) {
      const nameLower = displayName.toLowerCase();
      const handleLower = screenName.toLowerCase();
      const rest = handleLower.startsWith(nameLower) ? handleLower.slice(nameLower.length) : null;
      if (rest && /^\d{3,}$/.test(rest)) {
        const vowelRatio = (nameLower.match(/[aeiou]/g) || []).length / nameLower.length;
        const maxConsonantRun = Math.max(
          0,
          ...(nameLower.match(/[^aeiou]+/g) || ['']).map(s => s.length)
        );
        // Gibberish (vs a real name): very few vowels, or a consonant cluster
        // together with below-average vowel density. Tuned to catch the bot
        // names (Qnegk/Bihysuq/Hqzbrc…) while sparing Andrew/Brandon/Steven 等真名.
        if (vowelRatio <= 0.2 || (maxConsonantRun >= 3 && vowelRatio < 0.3)) {
          score += 40;
        }
      }
    }

    // NOTE: emoji-garbage tweets (real-looking name + 同城上门 avatar + 散落 emoji
    // + 孤立单字母) are too easily confused with real heavy-emoji users, so they are
    // NOT auto-hidden. Use the per-tweet manual 「隐藏」 button instead (see
    // addManualHideButton) — the human is the judge for that ambiguous family.

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

    // 0.5 Manually hidden by the user (per-tweet 隐藏 button) — sticks across loads
    if (userInfo.screenName && localBlocklist.has(userInfo.screenName.toLowerCase())) {
      return true;
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

    const record = { screenName, displayName, tweetText, userId: info ? info.userId : null, score: info ? calculateSpamScore(info) : 0, element };
    // Plain un-collapse: restore content, drop the bar + the hidden flag (so it
    // won't be treated as hidden), remove from the session list. No whitelisting.
    record.reveal = () => {
      originalChildren.forEach(c => { c.style.display = ''; });
      bar.remove();
      delete element.dataset.spamHidden;
      const i = hiddenItems.indexOf(record);
      if (i >= 0) hiddenItems.splice(i, 1);
      updateHiddenCount();
    };
    // False-positive recovery: reveal + add to whitelist (never hide again).
    // Reused by the in-place bar button and the "本次隐藏" reviewer modal.
    record.recover = async () => {
      if (screenName) await addToLocalWhitelist(screenName);
      record.reveal();
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
      const container = article.closest('div[data-testid="cellInnerDiv"]') || article;
      if (shouldHide(info)) {
        hideElement(container);
      } else if (info && info.screenName) {
        addManualHideButton(container, info.screenName, info.userId);
      }
    });

    // User cells (search, lists, followers, "who to follow" etc.)
    document.querySelectorAll('div[data-testid="UserCell"]:not([data-spam-scanned])').forEach(cell => {
      cell.dataset.spamScanned = 'true';
      const info = extractUserInfo(cell);
      if (shouldHide(info)) {
        hideElement(cell);
      } else if (info && info.screenName) {
        addManualHideButton(cell, info.screenName, info.userId);
      }
    });
  }

  // Inject a subtle per-tweet manual hide button (revealed on hover). Lets the
  // user catch spam that's too ambiguous for the heuristics (e.g. real-looking
  // name + 同城上门 avatar + emoji garbage) without auto-hiding emoji-loving users.
  function addManualHideButton(container, screenName, userId) {
    if (!container || container.dataset.spamHost === 'true' || container.dataset.spamHidden === 'true') return;
    container.dataset.spamHost = 'true';
    if (!container.style.position) container.style.position = 'relative';

    const btn = document.createElement('div');
    btn.className = 'x-spam-manual-hide';
    btn.textContent = '🚫 隐藏';
    btn.title = '手动隐藏该账号（加入本地隐藏，以后自动折叠）';
    btn.onclick = async (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      await addToLocalBlocklist(screenName, userId);
      hideElement(container);
      updatePanelCount();
    };
    container.appendChild(btn);
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

  // Block by screen_name. The timeline DOM has no real user_id (the avatar URL
  // number is the IMAGE id, not the account id), but blocks/create.json accepts
  // screen_name directly, which we extract reliably.
  async function blockByScreenName(screenName) {
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
        data: `screen_name=${encodeURIComponent(screenName)}`,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve();
          } else {
            reject(new Error(`${res.status} ${String(res.responseText || '').slice(0, 120)}`));
          }
        },
        onerror: () => reject(new Error('网络错误'))
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

  // ===================== LOCAL MANUAL BLOCKLIST =====================
  // Accounts the user hid by hand (per-tweet 隐藏 button). Persisted by screen_name.

  async function loadLocalBlocklist() {
    try {
      const saved = await GM_getValue('local_blocklist', []);
      localBlocklist = new Map();
      (saved || []).forEach((item) => {
        if (typeof item === 'string') localBlocklist.set(item, null);       // legacy format (screen_name only)
        else if (item && item.s) localBlocklist.set(item.s, item.u || null); // {s: screen_name, u: user_id}
      });
      log(`Loaded ${localBlocklist.size} accounts from local blocklist`);
    } catch (e) {
      localBlocklist = new Map();
    }
  }

  async function saveLocalBlocklist() {
    await GM_setValue('local_blocklist', Array.from(localBlocklist, ([s, u]) => ({ s, u })));
  }

  async function addToLocalBlocklist(screenName, userId) {
    if (!screenName) return false;
    localBlocklist.set(String(screenName).toLowerCase(), userId ? String(userId) : null);
    await saveLocalBlocklist();
    log(`Added @${screenName} to local blocklist`);
    return true;
  }

  async function removeFromLocalBlocklist(screenName) {
    const lc = String(screenName).toLowerCase();
    localBlocklist.delete(lc);
    await saveLocalBlocklist();
    // Un-collapse this account's tweets that are still on the page (no refresh needed).
    hiddenItems.slice().forEach((rec) => {
      if (rec.screenName && rec.screenName.toLowerCase() === lc && rec.reveal) rec.reveal();
    });
    log(`Removed @${screenName} from local blocklist`);
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

  function openLocalBlocklistModal() {
    openListModal(`本地隐藏（${localBlocklist.size}）`, (box) => {
      if (localBlocklist.size === 0) {
        const p = document.createElement('div');
        p.textContent = '（空）你用每条推文上的「🚫 隐藏」按钮手动隐藏的账号会出现在这里。';
        p.style.color = '#8899a6';
        box.appendChild(p);
        return;
      }

      // Submit the whole persistent list to the review queue (only entries that
      // carry a user_id can be submitted; older screen-name-only entries are skipped).
      const submittable = Array.from(localBlocklist.values()).filter(Boolean).length;
      const submitBtn = document.createElement('button');
      submitBtn.textContent = `提交 ${submittable} 个到审核队列`;
      submitBtn.style.cssText = 'width:100%;margin-bottom:10px;background:#1d9bf0;color:#fff;border:none;border-radius:9999px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;';
      submitBtn.disabled = submittable === 0;
      submitBtn.onclick = () => {
        closeListModal();
        submitLocalBlocklist();
      };
      box.appendChild(submitBtn);

      Array.from(localBlocklist.keys()).sort().forEach((sn) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2f3336;';
        const name = document.createElement('span');
        name.textContent = '@' + sn;
        const rm = document.createElement('span');
        rm.textContent = '移除';
        rm.style.cssText = 'color:#1d9bf0;cursor:pointer;';
        rm.title = '移除后该账号不再被本地隐藏，页面上已折叠的会立即恢复显示';
        rm.onclick = async () => {
          await removeFromLocalBlocklist(sn);
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

      // Submit-all shortcut right inside the reviewer.
      const submitAllBtn = document.createElement('button');
      submitAllBtn.textContent = `提交全部 ${hiddenItems.length} 个到审核队列`;
      submitAllBtn.style.cssText = 'width:100%;margin-bottom:10px;background:#1d9bf0;color:#fff;border:none;border-radius:9999px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;';
      submitAllBtn.onclick = () => {
        closeListModal();
        submitAllHidden();
      };
      box.appendChild(submitAllBtn);

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

    // Block by screen_name (reliable), skipping anything in the local whitelist.
    const names = approvedBlocklistEntries
      .map(e => e.screen_name)
      .filter(Boolean)
      .filter(sn => !isWhitelisted(sn));

    if (names.length === 0) {
      alert('当前没有可拉黑的维护者黑名单账号（或都在你的本地白名单里）');
      return;
    }

    // Cap per session
    const toBlock = names.slice(0, CONFIG.MAX_BLOCK_PER_SESSION);
    const previewList = toBlock.slice(0, 15).map(sn => `• @${sn}`).join('\n');
    const moreText = toBlock.length > 15 ? `\n... 还有 ${toBlock.length - 15} 个` : '';

    const msg = `即将从维护者黑名单中按 @句柄 拉黑以下账号（前15个预览）：\n\n${previewList}${moreText}\n\n` +
      `总计：${toBlock.length} 个账号\n` +
      `间隔：10秒/个\n\n` +
      `确认后开始执行（可中途暂停/取消）。`;

    if (!confirm(msg)) return;

    blockingQueue = toBlock.map(sn => ({ screenName: sn }));
    blockedThisSession = 0;
    isBlockingActive = true;
    blockingPaused = false;

    updatePanelStatus(`开始从维护者黑名单拉黑 ${blockingQueue.length} 个账号...`);
    await processBlockingQueue();
  }

  async function processBlockingQueue() {
    let attempted = 0;
    let consecutiveFails = 0;
    let lastError = '';

    while (blockingQueue.length > 0 && isBlockingActive && !blockingPaused) {
      const item = blockingQueue.shift();
      attempted++;
      const remaining = blockingQueue.length;

      // Honest progress: attempted / succeeded / remaining (failures don't inflate success).
      updatePanelStatus(`拉黑中 第 ${attempted} 个（成功 ${blockedThisSession}，剩余 ${remaining}） - 10秒间隔`);

      try {
        await blockByScreenName(item.screenName);
        blockedThisSession++;
        consecutiveFails = 0;
        await sleep(CONFIG.BLOCK_DELAY_MS);
      } catch (err) {
        consecutiveFails++;
        lastError = String((err && err.message) || err);
        console.error('[Block Queue] Failed to block', item.screenName, lastError);

        if (lastError.includes('429') || lastError.includes('limit')) {
          updatePanelStatus('触发 X 频率限制，自动暂停 30 分钟...');
          await sleep(30 * 60 * 1000);
          consecutiveFails = 0;
        } else if (consecutiveFails >= 5) {
          // Everything is failing — likely the block endpoint changed / auth invalid.
          // Abort instead of churning 10s per item for the whole queue.
          isBlockingActive = false;
          updatePanelStatus(`拉黑疑似失效，已中止（成功 ${blockedThisSession}，错误：${lastError}）`);
          setTimeout(() => updatePanelStatus('就绪'), 12000);
          return;
        } else {
          await sleep(4000);
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

  // Submit the persistent local blocklist (manually hidden accounts) to the review
  // queue. Only entries that stored a user_id can be submitted.
  function submitLocalBlocklist() {
    const accounts = [];
    let noId = 0;
    localBlocklist.forEach((userId, sn) => {
      if (!userId) { noId++; return; }
      accounts.push({
        user_id: String(userId),
        screen_name: sn,
        display_name: '',
        tweet_text: '',
        source_url: window.location.href,
        detected_reasons: ['manual-hide'],
        detected_score: 0,
      });
    });

    if (accounts.length === 0) {
      alert('本地隐藏里没有可提交的账号（缺 user_id，老数据只存了句柄）。');
      return;
    }

    updatePanelStatus(`正在提交 ${accounts.length} 个本地隐藏账号...`);
    GM_xmlhttpRequest({
      method: 'POST',
      url: CONFIG.SUBMIT_BATCH_API,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ accounts }),
      onload: (res) => {
        try {
          const d = JSON.parse(res.responseText);
          const extra = noId ? `，跳过 ${noId}（无 ID）` : '';
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
      .x-spam-manual-hide {
        position: absolute;
        top: 6px;
        right: 48px;
        z-index: 5;
        font-size: 11px;
        color: #8899a6;
        background: rgba(0,0,0,0.55);
        border: 1px solid #38444d;
        border-radius: 9999px;
        padding: 2px 8px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      [data-spam-host="true"]:hover .x-spam-manual-hide {
        opacity: 1;
      }
      .x-spam-manual-hide:hover {
        color: #fff;
        background: #f4212e;
        border-color: #f4212e;
      }
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
      <div class="title">🛡️ X 中文 Spam 拦截器 v0.11.2</div>
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
        <span id="x-spam-localblock-open" style="cursor:pointer;text-decoration:underline;">本地隐藏：<span id="x-spam-localblock">0</span></span>
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
    document.getElementById('x-spam-localblock-open').addEventListener('click', openLocalBlocklistModal);

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

    const localBlockEl = document.getElementById('x-spam-localblock');
    if (localBlockEl) localBlockEl.textContent = localBlocklist.size;
  }

  // ===================== INIT =====================

  async function init() {
    log('Initializing X Chinese Spam Blocker...');

    createPanel();

    // Load remote data + local whitelist/blocklist in parallel
    await Promise.all([
      loadApprovedBlocklist(),
      loadRemoteKeywords(),
      loadLocalWhitelist(),
      loadLocalBlocklist()
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
