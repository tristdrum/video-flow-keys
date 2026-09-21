(function startSponsorContent(root) {
  "use strict";
  if (root !== root.top || root.location.hostname !== "www.youtube.com" || root.__videoFlowSponsorsStarted) return;
  const api = root.browser || root.chrome;
  const core = root.VideoFlowSponsors;
  const playback = root.VideoFlowSponsorPlayback;
  if (!api?.runtime || !core || !playback) return;
  root.__videoFlowSponsorsStarted = true;
  const CHANNEL = "video-flow-keys:captions";
  let enabled = false;
  let videoId = "";
  let requestId = "";
  let status = "disabled";
  let results = [];
  let duration = 0;
  let timeout = null;
  let heatmap = null;
  let undoHud = null;
  let hudTimer = null;
  let attachedVideo = null;
  let classifying = false;
  let captionReceived = false;

  const controller = playback.createController({ getSnapshot,
    seek(time) { const video = getVideo(); if (video) video.currentTime = time; },
    onSkip: showUndo
  });
  function currentVideoId() {
    const url = new URL(root.location.href);
    const id = url.searchParams.get("v");
    return url.pathname === "/watch" && /^[\w-]{11}$/.test(id || "") ? id : "";
  }
  function getVideo() { return root.document.querySelector("#movie_player video"); }
  function getSnapshot() {
    const video = getVideo();
    const player = root.document.querySelector("#movie_player");
    if (!video) return null;
    return { videoId: currentVideoId(), media: video, source: video.currentSrc,
      currentTime: video.currentTime, duration: video.duration, paused: video.paused,
      ended: video.ended, seeking: video.seeking,
      adShowing: Boolean(player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting")),
      live: !Number.isFinite(video.duration) || Boolean(duration && Math.abs(video.duration - duration) > Math.max(2, duration * 0.01)) };
  }
  function send(message) {
    return new Promise((resolve) => {
      try {
        api.runtime.sendMessage(message, (response) => {
          if (api.runtime.lastError) resolve({ ok: false, error: "unavailable" });
          else resolve(response || { ok: false, error: "unavailable" });
        });
      } catch (_) { resolve({ ok: false, error: "unavailable" }); }
    });
  }
  function post(type, id = videoId, correlation = requestId) {
    if (!id || !correlation) return;
    root.postMessage({ source: `${CHANNEL}:request`, type, videoId: id, requestId: correlation }, root.location.origin);
  }
  function clearViews() {
    if (heatmap) heatmap.remove();
    if (undoHud) undoHud.remove();
    heatmap = null;
    undoHud = null;
    root.clearTimeout(hudTimer);
  }
  function restart() {
    const previousId = videoId;
    const previousRequest = requestId;
    root.clearTimeout(timeout);
    post("cancel", previousId, previousRequest);
    if (previousId) void send({ type: "sponsor:cancel", videoId: previousId });
    videoId = currentVideoId();
    requestId = root.crypto.randomUUID();
    classifying = false;
    captionReceived = false;
    results = [];
    duration = 0;
    clearViews();
    controller.reset(videoId);
    controller.setEnabled(enabled);
    status = enabled ? (videoId ? "reading-captions" : "unsupported-page") : "disabled";
    if (!enabled || !videoId) return;
    const ownRequest = requestId;
    post("read");
    timeout = root.setTimeout(() => {
      if (requestId === ownRequest && !captionReceived) {
        captionReceived = true;
        status = "captions-unavailable";
        post("cancel");
      }
    }, 12000);
  }
  function mergeSkips(values) {
    const merged = [];
    for (const segment of values) {
      const last = merged[merged.length - 1];
      if (last && last.category === "sponsor" && segment.category === "sponsor" &&
          last.probability >= playback.THRESHOLD && segment.probability >= playback.THRESHOLD &&
          segment.start >= last.end && segment.start - last.end <= 0.35) {
        last.end = segment.end;
        last.probability = Math.min(last.probability, segment.probability);
      } else merged.push({ ...segment });
    }
    return merged;
  }
  async function receive(event) {
    const message = event.data;
    if (!enabled || event.source !== root || event.origin !== root.location.origin ||
        message?.source !== CHANNEL || message.requestId !== requestId || message.videoId !== videoId ||
        currentVideoId() !== videoId || captionReceived) return;
    if (message.type === "error") {
      captionReceived = true;
      root.clearTimeout(timeout);
      status = message.error === "live" ? "live" : "captions-unavailable";
      return;
    }
    if (message.type !== "captions" || classifying || !Number.isFinite(message.duration) || message.duration <= 0 ||
        typeof message.title !== "string" || message.title.length > 1000) return;
    root.clearTimeout(timeout);
    captionReceived = true;
    let segments;
    try {
      if (JSON.stringify(message.captions).length > 1000000) throw new Error();
      segments = core.segmentCaptions(core.parseCaptions(message.captions), message.duration);
    } catch (_) { status = "captions-unavailable"; return; }
    if (!segments.length) { status = "captions-unavailable"; return; }
    const ownRequest = requestId;
    duration = message.duration;
    classifying = true;
    status = "analyzing";
    const response = await send({ type: "sponsor:analyze", videoId, title: message.title, segments });
    if (!enabled || requestId !== ownRequest || videoId !== currentVideoId()) return;
    classifying = false;
    if (!response.ok || response.videoId !== videoId || !Array.isArray(response.segments)) {
      status = ["key-unavailable", "authentication", "rate-limited", "timeout", "invalid-response", "request-too-large"].includes(response.error) ? response.error : "unavailable";
      return;
    }
    results = response.segments;
    controller.setSegments(videoId, mergeSkips(results));
    status = "ready";
    renderHeatmap();
    attachVideo();
    controller.tick();
  }
  function renderHeatmap() {
    const bar = root.document.querySelector("#movie_player .ytp-progress-bar");
    if (!bar || !results.length || !duration) return;
    if (heatmap?.parentNode === bar) return;
    if (heatmap) heatmap.remove();
    heatmap = root.document.createElement("div");
    heatmap.id = "video-flow-sponsor-heatmap";
    heatmap.setAttribute("role", "img");
    heatmap.setAttribute("aria-label", "Sponsor likelihood. Stronger amber marks more likely sponsorship.");
    Object.assign(heatmap.style, { position: "absolute", left: "0", right: "0", top: "0", height: "100%", pointerEvents: "none", zIndex: "45" });
    for (const segment of results) {
      if (!Number.isFinite(segment.probability) || segment.probability < 0.05 || segment.end > duration) continue;
      const mark = root.document.createElement("span");
      Object.assign(mark.style, { position: "absolute", height: "100%", left: `${100 * segment.start / duration}%`,
        width: `${100 * (segment.end - segment.start) / duration}%`, background: "#ffbd4a",
        opacity: String(Math.max(0.1, Math.min(0.95, segment.probability))) });
      heatmap.appendChild(mark);
    }
    bar.appendChild(heatmap);
  }
  function showUndo() {
    const player = root.document.querySelector("#movie_player");
    if (!player) return;
    if (undoHud) undoHud.remove();
    root.clearTimeout(hudTimer);
    undoHud = root.document.createElement("div");
    undoHud.id = "video-flow-sponsor-undo";
    undoHud.setAttribute("role", "status");
    Object.assign(undoHud.style, { position: "absolute", left: "20px", bottom: "70px", zIndex: "2147483647",
      display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "12px",
      background: "rgba(25,25,28,0.8)", color: "white", backdropFilter: "blur(14px)",
      border: "1px solid rgba(255,255,255,0.25)", font: "500 14px -apple-system, sans-serif" });
    const label = root.document.createElement("span");
    label.textContent = "Sponsor skipped";
    const button = root.document.createElement("button");
    button.type = "button";
    button.textContent = "Undo";
    Object.assign(button.style, { border: "0", borderRadius: "7px", padding: "7px 10px", color: "#18181b",
      background: "#ffbd4a", cursor: "pointer", font: "600 13px -apple-system, sans-serif" });
    button.addEventListener("click", (event) => { event.stopPropagation(); undo(); });
    undoHud.appendChild(label);
    undoHud.appendChild(button);
    player.appendChild(undoHud);
    hudTimer = root.setTimeout(() => { if (undoHud) undoHud.remove(); undoHud = null; }, 8000);
  }
  function undo() {
    const undone = controller.undo();
    if (undone && undoHud) { undoHud.remove(); undoHud = null; }
    return undone;
  }
  function attachVideo() {
    const video = getVideo();
    if (attachedVideo === video) return;
    if (attachedVideo) {
      attachedVideo.removeEventListener("timeupdate", controller.tick);
      attachedVideo.removeEventListener("seeking", controller.manualSeek);
      attachedVideo.removeEventListener("play", controller.tick);
    }
    attachedVideo = video;
    if (video) {
      video.addEventListener("timeupdate", controller.tick);
      video.addEventListener("seeking", controller.manualSeek);
      video.addEventListener("play", controller.tick);
    }
  }
  root.addEventListener("message", receive);
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id && sender.id !== api.runtime.id) return false;
    if (message?.type === "sponsor:status") {
      respond({ status, canUndo: controller.canUndo(), count: results.filter((s) => s.category === "sponsor" && s.probability >= playback.THRESHOLD).length });
    } else if (message?.type === "sponsor:undo") respond({ ok: undo() });
    else if (message?.type === "sponsor:retry") { restart(); respond({ ok: true }); }
    return false;
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.skipSponsors) {
      enabled = changes.skipSponsors.newValue === true;
      restart();
    }
  });
  api.storage.local.get({ skipSponsors: false }, (settings) => {
    enabled = settings.skipSponsors === true;
    restart();
  });
  root.setInterval(() => {
    if (currentVideoId() !== videoId) restart();
    if (enabled && videoId) {
      attachVideo();
      renderHeatmap();
      controller.tick();
    }
  }, 250);
})(typeof globalThis !== "undefined" ? globalThis : window);
