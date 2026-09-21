(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VideoFlowSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";
  const DEFAULT_SETTINGS = Object.freeze({
    slowerKey: "s", defaultKey: "d", fasterKey: "f", skipKey: "e",
    rateStep: 0.1, defaultRate: 2, resetRate: 1, minRate: 0.1, maxRate: 9.9,
    autoApplyDefaultOnYouTube: true, autoSkipYouTubeAds: true, showHud: true,
    skipSponsors: false
  });
  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }
  function normalizeKey(value, fallback) {
    const key = String(value || "").trim().toLowerCase();
    return key.length === 1 ? key : fallback;
  }
  function normalizeSettings(candidate = {}) {
    const next = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(next)) {
      if (candidate[key] !== undefined) next[key] = candidate[key];
    }
    for (const key of ["slowerKey", "defaultKey", "fasterKey", "skipKey"]) {
      next[key] = normalizeKey(next[key], DEFAULT_SETTINGS[key]);
    }
    next.minRate = clampNumber(next.minRate, 0.05, 1, DEFAULT_SETTINGS.minRate);
    next.maxRate = clampNumber(next.maxRate, 1, 16, DEFAULT_SETTINGS.maxRate);
    next.defaultRate = clampNumber(next.defaultRate, next.minRate, next.maxRate, DEFAULT_SETTINGS.defaultRate);
    next.resetRate = clampNumber(next.resetRate, next.minRate, next.maxRate, DEFAULT_SETTINGS.resetRate);
    next.rateStep = clampNumber(next.rateStep, 0.01, 2, DEFAULT_SETTINGS.rateStep);
    for (const key of ["autoApplyDefaultOnYouTube", "autoSkipYouTubeAds", "showHud", "skipSponsors"]) {
      next[key] = next[key] === true;
    }
    return next;
  }
  return { DEFAULT_SETTINGS, normalizeSettings, normalizeKey, clampNumber };
});
