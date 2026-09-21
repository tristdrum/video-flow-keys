/* Caption interception approach inspired by jev-skip (MIT, Valentyn Kit).
 * See THIRD_PARTY_NOTICES.md. This page-world script never receives a key. */
(function installVideoFlowCaptionBridge() {
  "use strict";
  if (window !== window.top || location.hostname !== "www.youtube.com" ||
      window.__videoFlowCaptionBridge) return;
  window.__videoFlowCaptionBridge = true;
  const CHANNEL = "video-flow-keys:captions";
  const nativeFetch = window.fetch;
  let captured = null;
  let active = null;

  function currentId() {
    return location.pathname === "/watch" ? new URL(location.href).searchParams.get("v") : null;
  }
  function record(raw) {
    try {
      const url = new URL(typeof raw === "string" ? raw : raw && raw.url, location.origin);
      if (url.origin === "https://www.youtube.com" && !url.username && !url.password &&
          url.pathname === "/api/timedtext" && url.searchParams.get("v") === currentId() &&
          url.searchParams.has("pot") && url.href.length < 12000) {
        captured = { videoId: currentId(), url: url.href };
      }
    } catch (_) { /* Ignore unrelated page requests. */ }
  }
  window.fetch = function (...args) {
    record(args[0]);
    return nativeFetch.apply(this, args);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    record(args[1]);
    return open.apply(this, args);
  };
  function post(request, payload) {
    window.postMessage({ source: CHANNEL, requestId: request.requestId, videoId: request.videoId, ...payload }, location.origin);
  }
  function playerDetails(videoId) {
    const player = document.querySelector("#movie_player");
    let response;
    try { response = player && player.getPlayerResponse && player.getPlayerResponse(); } catch (_) {}
    if (!response || response.videoDetails?.videoId !== videoId) response = window.ytInitialPlayerResponse;
    if (response?.videoDetails?.videoId !== videoId) return null;
    const video = response.videoDetails;
    return { player, title: String(video.title || "").slice(0, 1000),
      duration: Number(video.lengthSeconds), live: Boolean(video.isLiveContent || response.playabilityStatus?.liveStreamability) };
  }
  function sameTrack(a, b) {
    return ["languageCode", "vssId", "kind"].every((key) => (a?.[key] || "") === (b?.[key] || ""));
  }
  async function readCaptions(request) {
    if (active) { active.abort(); if (active.restore) active.restore(); }
    const controller = new AbortController();
    controller.requestId = request.requestId;
    active = controller;
    let restore = () => {};
    const timer = setTimeout(() => controller.abort(), 10000);
    const stillCurrent = () => active === controller && !controller.signal.aborted && currentId() === request.videoId;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      let details = null;
      // During YouTube SPA navigation the address changes before the player's
      // response. Wait for that response instead of failing the new video.
      for (let i = 0; i < 24 && stillCurrent() && !details; i++) {
        details = playerDetails(request.videoId);
        if (!details) await delay(150);
      }
      if (!stillCurrent()) return;
      if (!details || !Number.isFinite(details.duration) || details.duration <= 0) throw new Error("unavailable");
      if (details.live) throw new Error("live");
      post(request, { type: "details", title: details.title, duration: details.duration });
      const player = details.player;
      // Reuse the player's signed request if captions are already enabled.
      for (let i = 0; i < 4 && stillCurrent() && captured?.videoId !== request.videoId; i++) await delay(150);
      if (!stillCurrent()) return;
      if (captured?.videoId !== request.videoId) {
        if (!player?.getOption || !player?.setOption) throw new Error("no-captions");
        let previous;
        try { previous = { ...(player.getOption("captions", "track") || {}) }; } catch (_) { previous = {}; }
        const subtitles = document.querySelector(".ytp-subtitles-button");
        const previouslyOn = subtitles?.getAttribute("aria-pressed") === "true" || Boolean(previous.languageCode);
        let selected = null;
        let userChanged = false;
        function changed(event) {
          if (event.isTrusted && ((event.type === "keydown" && event.key?.toLowerCase() === "c") ||
              event.target?.closest?.(".ytp-subtitles-button, .ytp-settings-menu"))) userChanged = true;
        }
        document.addEventListener("click", changed, true);
        document.addEventListener("keydown", changed, true);
        let restored = false;
        restore = () => {
          if (restored) return;
          restored = true;
          document.removeEventListener("click", changed, true);
          document.removeEventListener("keydown", changed, true);
          try {
            const current = player.getOption("captions", "track");
            if (selected && !userChanged && currentId() === request.videoId && sameTrack(current, selected)) {
              player.setOption("captions", "track", previouslyOn ? previous : {});
            }
          } catch (_) {}
        };
        controller.restore = restore;
        if (player.loadModule) player.loadModule("captions");
        let tracks = [];
        for (let i = 0; i < 12 && stillCurrent() && !tracks.length; i++) {
          try { tracks = player.getOption("captions", "tracklist") || []; } catch (_) {}
          if (!tracks.length) await delay(150);
        }
        if (!stillCurrent()) return;
        if (!tracks.length) throw new Error("no-captions");
        // A caption choice made while its module was loading takes precedence.
        if (!userChanged && captured?.videoId !== request.videoId) {
          selected = tracks.find((track) => track.languageCode === previous.languageCode) ||
            tracks.find((track) => track.languageCode === "en") || tracks[0];
          player.setOption("captions", "track", selected);
        }
      }
      for (let i = 0; i < 30 && stillCurrent() && captured?.videoId !== request.videoId; i++) await delay(150);
      if (!stillCurrent()) return;
      if (captured?.videoId !== request.videoId) throw new Error("no-captions");
      const url = new URL(captured.url);
      url.searchParams.set("fmt", "json3");
      const response = await nativeFetch.call(window, url.href, { credentials: "include", signal: controller.signal, redirect: "error" });
      if (!response.ok || Number(response.headers.get("content-length")) > 1000000) throw new Error("no-captions");
      const text = await response.text();
      if (!stillCurrent()) return;
      if (!text || text.length > 1000000) throw new Error("no-captions");
      let json;
      try { json = JSON.parse(text); } catch (_) { throw new Error("no-captions"); }
      if (!Array.isArray(json.events) || !json.events.length) throw new Error("no-captions");
      post(request, { type: "captions", title: details.title, duration: details.duration, captions: json });
    } catch (error) {
      if (active === controller && currentId() === request.videoId) {
        post(request, { type: "error", error: ["no-captions", "live"].includes(error.message) ? error.message : "unavailable" });
      }
    } finally {
      clearTimeout(timer);
      restore();
      if (active === controller) active = null;
    }
  }
  window.addEventListener("message", (event) => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.source !== `${CHANNEL}:request` ||
        typeof request.requestId !== "string" || !/^[\w-]{1,80}$/.test(request.requestId) ||
        !/^[\w-]{11}$/.test(request.videoId || "")) return;
    if (request.type === "cancel") { if (active?.requestId === request.requestId) active.abort(); return; }
    if (request.type === "read" && currentId() === request.videoId) void readCaptions(request);
  });
})();
