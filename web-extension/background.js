(function initSponsorBackground(root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./sponsor-core.js"));
    return;
  }
  if (!root.VideoFlowSponsors && typeof root.importScripts === "function") root.importScripts("sponsor-core.js");
  const api = factory(root.VideoFlowSponsors);
  root.VideoFlowSponsorBackground = api;
  api.start(root.browser || root.chrome);
})(typeof globalThis !== "undefined" ? globalThis : self, function createSponsorBackgroundModule(core) {
  "use strict";
  const APP_ID = "com.tristdrum.VideoFlowKeys";
  const NATIVE_TIMEOUT_MS = 45000;
  const ERRORS = new Set(["invalid-request", "key-unavailable", "key-storage-failed", "authentication", "rate-limited", "service-unavailable", "timeout", "cancelled", "invalid-response", "network-error", "disabled", "unsupported", "unauthorized"]);

  function watchVideoId(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const videoId = url.searchParams.get("v");
      return url.origin === "https://www.youtube.com" && url.pathname === "/watch" && !url.username && !url.password && /^[A-Za-z0-9_-]{11}$/.test(videoId || "") ? videoId : null;
    } catch (_) { return null; }
  }

  function createBackground(api, options = {}) {
    const jobs = new Map();
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    const timeoutMs = options.timeoutMs || NATIVE_TIMEOUT_MS;
    const instanceId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let serial = 0;

    // Safari supports callbacks; promise-returning implementations also work.
    function call(target, method, args) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value, error) => {
          if (settled) return;
          settled = true;
          if (error) reject(new Error("network-error"));
          else resolve(value);
        };
        try {
          const returned = target[method](...args, (value) => finish(value, api.runtime && api.runtime.lastError));
          if (returned && typeof returned.then === "function") returned.then((value) => finish(value), () => finish(undefined, true));
        } catch (_) { finish(undefined, true); }
      });
    }

    function senderAllowed(sender, videoId) {
      return sender && sender.tab && Number.isInteger(sender.tab.id) && sender.tab.id >= 0 && sender.frameId === 0 &&
        (!api.runtime.id || sender.id === api.runtime.id) && watchVideoId(sender.url) === videoId;
    }

    async function enabled() {
      const settings = await call(api.storage.local, "get", [{ skipSponsors: false }]);
      return settings && settings.skipSponsors === true;
    }

    function sendNative(message) {
      if (!api.runtime || !api.runtime.sendNativeMessage) return Promise.reject(new Error("unsupported"));
      return call(api.runtime, "sendNativeMessage", [APP_ID, message]);
    }

    function cancelJob(tabId) {
      const job = jobs.get(tabId);
      if (!job) return;
      jobs.delete(tabId);
      job.cancelled = true;
      const requestId = job.requestId;
      if (job.rejectPending) job.rejectPending(new Error("cancelled"));
      if (requestId) sendNative({ type: "typesafe:cancel", requestId }).catch(() => {});
    }

    async function assertCurrent(tabId, job) {
      if (job.cancelled || jobs.get(tabId) !== job) throw new Error("cancelled");
      const isEnabled = await enabled();
      if (job.cancelled || jobs.get(tabId) !== job) throw new Error("cancelled");
      if (!isEnabled) { cancelJob(tabId); throw new Error("disabled"); }
      if (api.tabs && api.tabs.get) {
        const tab = await call(api.tabs, "get", [tabId]);
        if (job.cancelled || jobs.get(tabId) !== job) throw new Error("cancelled");
        if (!tab || watchVideoId(tab.url) !== job.videoId) { cancelJob(tabId); throw new Error("cancelled"); }
      }
      if (job.cancelled || jobs.get(tabId) !== job) throw new Error("cancelled");
    }

    function classify(job, request) {
      job.requestId = `${instanceId}-${++serial}`;
      const requestId = job.requestId;
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          sendNative({ type: "typesafe:cancel", requestId }).catch(() => {});
          finish(undefined, new Error("timeout"));
        }, timeoutMs);
        let settled = false;
        function finish(value, error) {
          if (settled) return;
          settled = true;
          clearTimer(timer);
          job.rejectPending = null;
          if (job.requestId === requestId) job.requestId = null;
          if (error) reject(error); else resolve(value);
        }
        job.rejectPending = (error) => finish(undefined, error);
        sendNative({ type: "typesafe:classify", requestId, request }).then((value) => finish(value), (error) => finish(undefined, error));
      });
    }

    async function handleMessage(message, sender) {
      if (!message || !["sponsor:analyze", "sponsor:cancel"].includes(message.type)) return { ok: false, error: "unauthorized" };
      const videoId = message.videoId;
      if (typeof videoId !== "string" || !senderAllowed(sender, videoId)) return { ok: false, error: "unauthorized" };
      const tabId = sender.tab.id;
      if (message.type === "sponsor:cancel") {
        const job = jobs.get(tabId);
        if (job && job.videoId === videoId) cancelJob(tabId);
        return { ok: true, videoId };
      }

      let job;
      try {
        const requests = core.buildRequests(message.title, message.segments);
        cancelJob(tabId);
        job = { videoId, cancelled: false, requestId: null, rejectPending: null };
        jobs.set(tabId, job);
        const results = [];
        for (const request of requests) {
          await assertCurrent(tabId, job);
          const nativeResponse = await classify(job, request);
          await assertCurrent(tabId, job);
          if (!nativeResponse || nativeResponse.ok !== true) throw new Error(nativeResponse && ERRORS.has(nativeResponse.error) ? nativeResponse.error : "invalid-response");
          results.push(...core.parseAnswers(nativeResponse.data, request.state.segments));
        }
        return { ok: true, videoId, segments: results };
      } catch (error) {
        return { ok: false, error: ERRORS.has(error && error.message) ? error.message : "invalid-request" };
      } finally {
        if (job && jobs.get(tabId) === job) jobs.delete(tabId);
      }
    }

    function onStorageChanged(changes, area) {
      if (area === "local" && changes.skipSponsors && changes.skipSponsors.newValue !== true) for (const tabId of [...jobs.keys()]) cancelJob(tabId);
    }

    function onTabUpdated(tabId, change) {
      const job = jobs.get(tabId);
      if (job && change.url && watchVideoId(change.url) !== job.videoId) cancelJob(tabId);
    }

    function dispose() { for (const tabId of [...jobs.keys()]) cancelJob(tabId); }
    return { handleMessage, onStorageChanged, onTabUpdated, onTabRemoved: cancelJob, dispose };
  }

  function start(api) {
    if (!core || !api || !api.runtime || !api.runtime.onMessage || !api.storage || !api.storage.local) return null;
    const coordinator = createBackground(api);
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.type !== "string" || !message.type.startsWith("sponsor:")) return false;
      coordinator.handleMessage(message, sender).then(sendResponse);
      return true;
    });
    if (api.storage.onChanged) api.storage.onChanged.addListener(coordinator.onStorageChanged);
    if (api.tabs && api.tabs.onUpdated) api.tabs.onUpdated.addListener(coordinator.onTabUpdated);
    if (api.tabs && api.tabs.onRemoved) api.tabs.onRemoved.addListener(coordinator.onTabRemoved);
    return coordinator;
  }

  return { APP_ID, NATIVE_TIMEOUT_MS, watchVideoId, createBackground, start };
});
