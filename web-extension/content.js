(function initVideoFlowKeys(root, factory) {
  const api = factory(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  api.start();
})(typeof globalThis !== "undefined" ? globalThis : window, function createVideoFlowKeys(root) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    slowerKey: "s",
    defaultKey: "d",
    fasterKey: "f",
    skipKey: "e",
    rateStep: 0.1,
    defaultRate: 2.5,
    resetRate: 1,
    minRate: 0.1,
    maxRate: 9.9,
    autoApplyDefaultOnYouTube: true,
    autoSkipYouTubeAds: true,
    showHud: true
  });

  const YOUTUBE_SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-container button",
    "button[aria-label='Skip']",
    "button[aria-label^='Skip ad']",
    "button[aria-label*='Skip ad']",
    ".ytp-ad-overlay-close-button"
  ];

  const extensionApi = getExtensionApi(root);
  let settings = { ...DEFAULT_SETTINGS };
  let hudElement = null;
  let hudTimer = null;
  let skipTimer = null;
  let observer = null;
  let currentUrl = "";
  const defaultApplications = new WeakMap();

  function getExtensionApi(scope) {
    if (scope && scope.browser && scope.browser.storage) {
      return scope.browser;
    }

    if (scope && scope.chrome && scope.chrome.storage) {
      return scope.chrome;
    }

    return null;
  }

  function start() {
    if (!root.document || root.__videoFlowKeysStarted) {
      return;
    }

    root.__videoFlowKeysStarted = true;
    currentUrl = String(root.location && root.location.href ? root.location.href : "");

    loadSettings().then(() => {
      root.document.addEventListener("keydown", handleKeyDown, true);
      root.document.addEventListener("play", maybeApplyDefaultFromEvent, true);
      root.document.addEventListener("loadedmetadata", maybeApplyDefaultFromEvent, true);

      installStorageListener();
      installMessageListener();
      installObserver();
      installUrlWatcher();
      maybeApplyDefaultToVideos();
      maybeStartYouTubeAutoSkip();
    });
  }

  function normalizeSettings(candidate) {
    const next = { ...DEFAULT_SETTINGS, ...(candidate || {}) };

    next.slowerKey = normalizeKey(next.slowerKey, DEFAULT_SETTINGS.slowerKey);
    next.defaultKey = normalizeKey(next.defaultKey, DEFAULT_SETTINGS.defaultKey);
    next.fasterKey = normalizeKey(next.fasterKey, DEFAULT_SETTINGS.fasterKey);
    next.skipKey = normalizeKey(next.skipKey, DEFAULT_SETTINGS.skipKey);
    next.rateStep = clampNumber(next.rateStep, 0.01, 2, DEFAULT_SETTINGS.rateStep);
    next.defaultRate = clampNumber(next.defaultRate, next.minRate, next.maxRate, DEFAULT_SETTINGS.defaultRate);
    next.resetRate = clampNumber(next.resetRate, next.minRate, next.maxRate, DEFAULT_SETTINGS.resetRate);
    next.minRate = clampNumber(next.minRate, 0.05, 1, DEFAULT_SETTINGS.minRate);
    next.maxRate = clampNumber(next.maxRate, 1, 16, DEFAULT_SETTINGS.maxRate);
    next.autoApplyDefaultOnYouTube = Boolean(next.autoApplyDefaultOnYouTube);
    next.autoSkipYouTubeAds = Boolean(next.autoSkipYouTubeAds);
    next.showHud = Boolean(next.showHud);

    if (next.defaultRate < next.minRate) {
      next.defaultRate = next.minRate;
    }

    if (next.defaultRate > next.maxRate) {
      next.defaultRate = next.maxRate;
    }

    return next;
  }

  function normalizeKey(value, fallback) {
    const key = String(value || "").trim().toLowerCase();
    return key.length === 1 ? key : fallback;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, number));
  }

  function clampRate(value, activeSettings) {
    const active = activeSettings || settings;
    const rounded = Math.round(Number(value) * 10) / 10;
    return clampNumber(rounded, active.minRate, active.maxRate, active.defaultRate);
  }

  function loadSettings() {
    if (!extensionApi || !extensionApi.storage || !extensionApi.storage.local) {
      settings = normalizeSettings({});
      return Promise.resolve(settings);
    }

    return new Promise((resolve) => {
      extensionApi.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        settings = normalizeSettings(stored);
        resolve(settings);
      });
    });
  }

  function installStorageListener() {
    if (!extensionApi || !extensionApi.storage || !extensionApi.storage.onChanged) {
      return;
    }

    extensionApi.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      const patch = {};
      for (const [key, change] of Object.entries(changes)) {
        patch[key] = change.newValue;
      }

      settings = normalizeSettings({ ...settings, ...patch });
      maybeApplyDefaultToVideos();
      maybeStartYouTubeAutoSkip();
    });
  }

  function installMessageListener() {
    const runtime = extensionApi && extensionApi.runtime;
    if (!runtime || !runtime.onMessage) {
      return;
    }

    runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      if (message.type === "set-rate") {
        const applied = setRate(Number(message.rate), "rate");
        sendResponse({ ok: applied });
        return true;
      }

      if (message.type === "change-rate") {
        const applied = changeRate(Number(message.delta));
        sendResponse({ ok: applied });
        return true;
      }

      if (message.type === "skip-ad") {
        const skipped = skipAd();
        sendResponse({ ok: skipped });
        return true;
      }

      if (message.type === "apply-default") {
        const applied = setRate(settings.resetRate, "default");
        sendResponse({ ok: applied });
        return true;
      }

      if (message.type === "reset-rate") {
        const applied = setRate(settings.resetRate, "default");
        sendResponse({ ok: applied });
        return true;
      }

      return false;
    });
  }

  function installObserver() {
    if (!root.MutationObserver || !root.document || !root.document.documentElement) {
      return;
    }

    observer = new root.MutationObserver(() => {
      maybeApplyDefaultToVideos();

      if (settings.autoSkipYouTubeAds && isYouTubeHost()) {
        clickYouTubeSkipButton();
      }
    });

    observer.observe(root.document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function installUrlWatcher() {
    root.setInterval(() => {
      const nextUrl = String(root.location && root.location.href ? root.location.href : "");
      if (nextUrl === currentUrl) {
        return;
      }

      currentUrl = nextUrl;
      maybeApplyDefaultToVideos(true);
      maybeStartYouTubeAutoSkip();
    }, 500);
  }

  function maybeStartYouTubeAutoSkip() {
    if (skipTimer) {
      root.clearInterval(skipTimer);
      skipTimer = null;
    }

    if (!settings.autoSkipYouTubeAds || !isYouTubeHost()) {
      return;
    }

    skipTimer = root.setInterval(clickYouTubeSkipButton, 350);
  }

  function handleKeyDown(event) {
    if (!event || event.defaultPrevented || shouldIgnoreKeyTarget(event.target)) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const key = String(event.key || "").toLowerCase();
    const action = actionForKey(key);

    if (!action) {
      return;
    }

    let handled = false;
    if (action === "slower") {
      handled = changeRate(-settings.rateStep);
    } else if (action === "default") {
      handled = setRate(settings.resetRate, "default");
    } else if (action === "faster") {
      handled = changeRate(settings.rateStep);
    } else if (action === "skip") {
      handled = skipAd();
    }

    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function actionForKey(key) {
    if (key === settings.slowerKey) {
      return "slower";
    }
    if (key === settings.defaultKey) {
      return "default";
    }
    if (key === settings.fasterKey) {
      return "faster";
    }
    if (key === settings.skipKey) {
      return "skip";
    }
    return "";
  }

  function shouldIgnoreKeyTarget(target) {
    const document = root.document || null;
    if (!target || target === document || (document && target === document.body)) {
      return false;
    }

    const element = target.nodeType && target.nodeType !== 1 ? target.parentElement : target;
    if (!element) {
      return false;
    }

    const tagName = String(element.tagName || "").toLowerCase();
    if (["input", "textarea", "select", "button"].includes(tagName)) {
      return true;
    }

    if (element.isContentEditable) {
      return true;
    }

    return Boolean(element.closest && element.closest("[contenteditable='true'], [role='textbox'], [role='searchbox']"));
  }

  function maybeApplyDefaultFromEvent(event) {
    const video = event && event.target && event.target.tagName === "VIDEO" ? event.target : null;
    if (video) {
      maybeApplyDefaultToVideo(video);
    }
  }

  function maybeApplyDefaultToVideos(force) {
    if (!settings.autoApplyDefaultOnYouTube || !isYouTubeHost() || isYouTubeAdShowing()) {
      return false;
    }

    let applied = false;
    for (const video of getVideos()) {
      applied = maybeApplyDefaultToVideo(video, force) || applied;
    }

    return applied;
  }

  function maybeApplyDefaultToVideo(video, force) {
    if (!video || !settings.autoApplyDefaultOnYouTube || !isYouTubeHost() || isYouTubeAdShowing()) {
      return false;
    }

    const signature = getVideoSignature(video);
    if (!force && defaultApplications.get(video) === signature) {
      return false;
    }

    applyRateToVideos([video], settings.defaultRate);
    defaultApplications.set(video, signature);
    showHud(formatRate(settings.defaultRate));
    return true;
  }

  function getVideoSignature(video) {
    const source = video.currentSrc || video.src || "";
    const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : "unknown";
    return `${currentUrl}|${source}|${duration}`;
  }

  function changeRate(delta) {
    const video = getActiveVideo();
    if (!video) {
      return false;
    }

    return setRate(Number(video.playbackRate || settings.defaultRate) + delta, "rate");
  }

  function setRate(value, reason) {
    const targetRate = clampRate(value);
    const videos = getTargetVideos();

    if (!videos.length) {
      return false;
    }

    applyRateToVideos(videos, targetRate);

    for (const video of videos) {
      defaultApplications.set(video, getVideoSignature(video));
    }

    showHud(formatRate(targetRate));
    return true;
  }

  function applyRateToVideos(videos, targetRate) {
    if (isYouTubeHost()) {
      syncYouTubePlayerRate(targetRate);
    }

    for (const video of videos) {
      video.playbackRate = targetRate;
      video.defaultPlaybackRate = targetRate;
    }
  }

  function syncYouTubePlayerRate(targetRate) {
    const player = getYouTubePlayer();
    if (!player || typeof player.setPlaybackRate !== "function") {
      return false;
    }

    if (!isYouTubeNativePlaybackRate(targetRate, player)) {
      return false;
    }

    try {
      player.setPlaybackRate(targetRate);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getYouTubePlayer() {
    if (!root.document || !isYouTubeHost()) {
      return null;
    }

    return root.document.querySelector("#movie_player, .html5-video-player");
  }

  function isYouTubeNativePlaybackRate(targetRate, player) {
    const rate = Number(targetRate);
    if (!Number.isFinite(rate)) {
      return false;
    }

    if (Math.abs(rate - settings.resetRate) < 0.001) {
      return true;
    }

    if (!player || typeof player.getAvailablePlaybackRates !== "function") {
      return false;
    }

    try {
      const rates = player.getAvailablePlaybackRates();
      return Array.isArray(rates) && rates.some((candidate) => Math.abs(Number(candidate) - rate) < 0.001);
    } catch (error) {
      return false;
    }
  }

  function skipAd() {
    if (isYouTubeHost() && clickYouTubeSkipButton()) {
      showHud("Skipped");
      return true;
    }

    showHud("No skip button");
    return false;
  }

  function clickYouTubeSkipButton() {
    if (!root.document || !isYouTubeHost()) {
      return false;
    }

    for (const selector of YOUTUBE_SKIP_SELECTORS) {
      const candidates = Array.from(root.document.querySelectorAll(selector));
      const button = candidates.find(isClickableElement);
      if (button) {
        button.click();
        return true;
      }
    }

    return false;
  }

  function isClickableElement(element) {
    if (!element || element.disabled || element.getAttribute("aria-disabled") === "true") {
      return false;
    }

    return isVisibleElement(element);
  }

  function isVisibleElement(element) {
    if (!element || !root.getComputedStyle) {
      return Boolean(element);
    }

    const style = root.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getTargetVideos() {
    const active = getActiveVideo();
    if (!active) {
      return [];
    }

    if (isYouTubeHost()) {
      return [active];
    }

    const visibleVideos = getVideos().filter(isVisibleVideo);
    return visibleVideos.length ? visibleVideos : [active];
  }

  function getActiveVideo() {
    const videos = getVideos();
    if (!videos.length) {
      return null;
    }

    const playing = videos
      .filter((video) => !video.paused && !video.ended)
      .sort((a, b) => visibleArea(b) - visibleArea(a));

    if (playing.length) {
      return playing[0];
    }

    return videos
      .slice()
      .sort((a, b) => visibleArea(b) - visibleArea(a))[0] || null;
  }

  function getVideos() {
    if (!root.document) {
      return [];
    }

    return Array.from(root.document.querySelectorAll("video"));
  }

  function isVisibleVideo(video) {
    return visibleArea(video) > 0;
  }

  function visibleArea(element) {
    if (!element || !element.getBoundingClientRect || !root.getComputedStyle) {
      return 0;
    }

    const style = root.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function isYouTubeHost() {
    const host = String(root.location && root.location.hostname ? root.location.hostname : "").toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  }

  function isYouTubeAdShowing() {
    if (!root.document || !isYouTubeHost()) {
      return false;
    }

    return Boolean(root.document.querySelector(".html5-video-player.ad-showing, .ad-showing"));
  }

  function showHud(message) {
    if (!settings.showHud || !root.document || !root.document.body) {
      return;
    }

    if (!hudElement) {
      hudElement = root.document.createElement("div");
      hudElement.setAttribute("data-video-flow-keys-hud", "true");
      Object.assign(hudElement.style, {
        position: "fixed",
        left: "20px",
        top: "20px",
        zIndex: "2147483647",
        minWidth: "64px",
        padding: "10px 14px",
        borderRadius: "12px",
        border: "1px solid rgba(255, 255, 255, 0.28)",
        background: "linear-gradient(135deg, rgba(32, 38, 46, 0.56), rgba(8, 10, 14, 0.42))",
        backdropFilter: "blur(18px) saturate(1.6)",
        webkitBackdropFilter: "blur(18px) saturate(1.6)",
        color: "white",
        font: "800 24px -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
        letterSpacing: "0",
        lineHeight: "1.05",
        textAlign: "center",
        textShadow: "0 2px 8px rgba(0, 0, 0, 0.55)",
        boxShadow: "0 14px 36px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.22)",
        pointerEvents: "none",
        opacity: "0",
        transform: "translateY(8px) scale(0.98)",
        transition: "opacity 160ms ease, transform 160ms ease"
      });
      root.document.body.appendChild(hudElement);
    }

    positionHud();
    hudElement.textContent = message;
    hudElement.style.opacity = "1";
    hudElement.style.transform = "translateY(0) scale(1)";

    if (hudTimer) {
      root.clearTimeout(hudTimer);
    }

    hudTimer = root.setTimeout(() => {
      if (!hudElement) {
        return;
      }
      hudElement.style.opacity = "0";
      hudElement.style.transform = "translateY(8px) scale(0.98)";
    }, 2000);
  }

  function positionHud() {
    if (!hudElement || !root.document) {
      return;
    }

    const video = getActiveVideo();
    if (!video || !video.getBoundingClientRect) {
      hudElement.style.left = "20px";
      hudElement.style.top = "20px";
      return;
    }

    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hudElement.style.left = "20px";
      hudElement.style.top = "20px";
      return;
    }

    const left = Math.round(rect.left + 20);
    const top = Math.round(rect.bottom - 78);
    hudElement.style.left = `${Math.max(12, left)}px`;
    hudElement.style.top = `${Math.max(12, top)}px`;
  }

  function formatRate(rate) {
    return `${Number(rate).toFixed(1).replace(/\.0$/, "")}x`;
  }

  return {
    DEFAULT_SETTINGS,
    YOUTUBE_SKIP_SELECTORS,
    actionForKey: (key, activeSettings) => {
      const previous = settings;
      settings = normalizeSettings(activeSettings || settings);
      const action = actionForKey(key);
      settings = previous;
      return action;
    },
    clampNumber,
    clampRate,
    formatRate,
    normalizeKey,
    normalizeSettings,
    shouldIgnoreKeyTarget,
    start
  };
});
