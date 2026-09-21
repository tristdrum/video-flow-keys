const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const core = require("../web-extension/sponsor-core.js");
const playback = require("../web-extension/sponsor-playback.js");

const script = fs.readFileSync(path.join(__dirname, "../web-extension/sponsor-content.js"), "utf8");
const VIDEO_A = "abcdefghijk";
const VIDEO_B = "12345678901";
const CHANNEL = "video-flow-keys:captions";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const copy = (value) => JSON.parse(JSON.stringify(value));
const captions = { events: [{ tStartMs: 10000, dDurationMs: 10000, segs: [{ utf8: "This example is a synthetic sponsor read." }] }] };

function element(tagName = "div") {
  const handlers = new Map();
  return {
    tagName, style: {}, children: [], attributes: {}, parentNode: null,
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(name, listener) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(listener); },
    removeEventListener(name, listener) { handlers.get(name)?.delete(listener); },
    dispatch(name) { for (const listener of handlers.get(name) || []) listener({ stopPropagation() {} }); }
  };
}

function createContent(options = {}) {
  const listeners = new Map();
  const timers = new Map();
  const intervals = [];
  const messages = [];
  const posted = [];
  const pending = [];
  let settingsListener;
  let runtimeListener;
  let serial = 0;
  const location = new URL(`https://www.youtube.com/watch?v=${VIDEO_A}`);
  const video = Object.assign(element("video"), { currentTime: 0, duration: options.duration === undefined ? 120 : options.duration,
    readyState: options.readyState === undefined ? 4 : options.readyState, paused: options.paused === true,
    seeking: false, ended: options.ended === true, currentSrc: "synthetic-media" });
  const bar = element();
  const adClasses = new Set(options.adClasses || []);
  const player = Object.assign(element(), { classList: { contains(name) { return adClasses.has(name); } } });
  const world = {
    location, URL, crypto: { randomUUID() { return `request-${++serial}`; } },
    VideoFlowSponsors: core, VideoFlowSponsorPlayback: playback,
    document: {
      querySelector(selector) { return selector === "#movie_player video" ? (options.noVideo ? null : video) : selector === "#movie_player" ? player : selector === "#movie_player .ytp-progress-bar" ? bar : null; },
      createElement: element
    },
    setTimeout(callback, ms) { const id = ++serial; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    postMessage(message, origin) { posted.push({ message: copy(message), origin }); },
    browser: {
      runtime: {
        id: "extension-id",
        onMessage: { addListener(listener) { runtimeListener = listener; } },
        sendMessage(message, callback) {
          messages.push(copy(message));
          if (message.type === "sponsor:analyze") pending.push({ message: copy(message), callback });
          else callback({ ok: true });
        }
      },
      storage: {
        onChanged: { addListener(listener) { settingsListener = listener; } },
        local: { get(_defaults, callback) { callback({ skipSponsors: options.enabled === true }); } }
      }
    }
  };
  world.window = world;
  world.globalThis = world;
  world.top = options.frame ? {} : world;
  const context = vm.createContext(world);
  vm.runInContext(script, context, { filename: "sponsor-content.js" });
  const worldIdentity = vm.runInContext("globalThis", context);
  function latestRead() { return posted.filter((entry) => entry.message.type === "read").at(-1)?.message; }
  async function receive(patch = {}, overrides = {}) {
    const read = latestRead();
    const data = { source: CHANNEL, type: "captions", videoId: read?.videoId || VIDEO_A, requestId: read?.requestId || "request-1", title: "Synthetic title", duration: 120, captions, ...patch };
    for (const listener of listeners.get("message") || []) await listener({ data, source: worldIdentity, origin: location.origin, ...overrides });
  }
  function dispatch(patch = {}, overrides = {}) { void receive(patch, overrides); }
  function status() { let result; runtimeListener({ type: "sponsor:status" }, { id: "extension-id" }, (value) => { result = value; }); return copy(result); }
  function setEnabled(value) { settingsListener({ skipSponsors: { newValue: value } }, "local"); }
  function tick() { intervals.forEach((callback) => callback()); }
  function navigate(id) { location.href = `https://www.youtube.com/watch?v=${id}`; tick(); }
  function runTimer(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.callback(); } }
  async function finish(index = 0, response) {
    const request = pending[index];
    request.callback(response || { ok: true, videoId: request.message.videoId, segments: request.message.segments.map(({ id, start, end }) => ({ id, start, end, probability: 0.95, category: "sponsor" })) });
    await flush();
  }
  return { world, video, bar, player, messages, posted, pending, latestRead, receive, dispatch, status, setEnabled, tick, navigate, runTimer, finish, runtimeListener,
    timerCount: (ms) => [...timers.values()].filter((timer) => timer.ms === ms).length,
    setVideoAvailable: (value) => { options.noVideo = !value; },
    setAdClass: (name, value) => { if (value) adClasses.add(name); else adClasses.delete(name); }
  };
}

test("sponsor content is opt-in and never reads captions or requests analysis while disabled", async () => {
  const h = createContent();
  assert.equal(h.status().status, "disabled");
  assert.equal(h.latestRead(), undefined);
  await h.receive();
  assert.equal(h.pending.length, 0);
  h.setEnabled(true);
  assert.equal(h.status().status, "reading-captions");
  assert.equal(h.latestRead().videoId, VIDEO_A);
  assert.ok(h.posted.every((entry) => entry.origin === "https://www.youtube.com"));
});

test("a cold Safari video waits for metadata, then reads captions once without starting playback", async () => {
  const h = createContent({ enabled: true, duration: NaN, readyState: 0, paused: true });
  assert.equal(h.status().status, "waiting-player");
  assert.equal(h.latestRead(), undefined);
  assert.equal(h.timerCount(12000), 0);
  h.runTimer(12000);
  h.tick();
  assert.equal(h.status().status, "waiting-player");
  await h.receive();
  assert.equal(h.pending.length, 0);
  h.video.duration = 548.981;
  h.video.readyState = 4;
  h.tick();
  assert.equal(h.status().status, "reading-captions");
  assert.equal(h.latestRead().videoId, VIDEO_A);
  assert.equal(h.timerCount(12000), 1);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, 0);
  h.tick();
  h.tick();
  assert.equal(h.posted.filter((entry) => entry.message.type === "read").length, 1);
  h.dispatch({ duration: 548.981 });
  await flush();
  await h.finish();
  assert.equal(h.status().status, "ready");
});

test("both YouTube ad states defer caption acquisition until content metadata is ready", () => {
  for (const adClass of ["ad-showing", "ad-interrupting"]) {
    const h = createContent({ enabled: true, adClasses: [adClass], duration: 30 });
    assert.equal(h.status().status, "waiting-player");
    assert.equal(h.latestRead(), undefined);
    assert.equal(h.timerCount(12000), 0);
    h.tick();
    assert.equal(h.latestRead(), undefined);
    h.video.duration = NaN;
    h.setAdClass(adClass, false);
    h.tick();
    assert.equal(h.latestRead(), undefined);
    h.video.duration = 120;
    h.tick();
    assert.equal(h.status().status, "reading-captions");
    assert.equal(h.posted.filter((entry) => entry.message.type === "read").length, 1);
    assert.equal(h.video.currentTime, 0);
  }
});

test("missing media waits while paused or ended finite media can be analyzed", () => {
  const missing = createContent({ enabled: true, noVideo: true });
  assert.equal(missing.status().status, "waiting-player");
  assert.equal(missing.latestRead(), undefined);
  missing.setVideoAvailable(true);
  missing.tick();
  assert.equal(missing.status().status, "reading-captions");
  for (const media of [{ paused: true }, { ended: true }]) {
    const h = createContent({ enabled: true, ...media });
    assert.equal(h.status().status, "reading-captions");
    assert.ok(h.latestRead());
  }
});

test("infinite duration reports live without reads, then finite metadata permits one caption request", async () => {
  const h = createContent({ enabled: true, duration: Infinity });
  assert.equal(h.status().status, "live");
  assert.equal(h.latestRead(), undefined);
  assert.equal(h.timerCount(12000), 0);
  await h.receive();
  h.tick();
  h.tick();
  assert.equal(h.latestRead(), undefined);
  assert.equal(h.pending.length, 0);
  h.video.duration = 120;
  h.tick();
  assert.equal(h.status().status, "reading-captions");
  assert.equal(h.latestRead().videoId, VIDEO_A);
  h.tick();
  assert.equal(h.posted.filter((entry) => entry.message.type === "read").length, 1);
  assert.equal(h.pending.length, 0);
});

test("live-to-VOD navigation tolerates the previous video's infinite media duration", () => {
  const h = createContent({ enabled: true, duration: Infinity });
  h.navigate(VIDEO_B);
  assert.equal(h.status().status, "live");
  assert.equal(h.latestRead(), undefined);
  assert.equal(h.timerCount(12000), 0);
  h.tick();
  assert.equal(h.latestRead(), undefined);
  h.video.duration = 120;
  h.tick();
  assert.equal(h.status().status, "reading-captions");
  assert.equal(h.latestRead().videoId, VIDEO_B);
  h.tick();
  assert.equal(h.posted.filter((entry) => entry.message.type === "read").length, 1);
});

test("a correlated live response from the page remains terminal despite later finite metadata", async () => {
  const h = createContent({ enabled: true });
  await h.receive({ type: "error", error: "live" });
  assert.equal(h.status().status, "live");
  h.video.duration = Infinity;
  h.tick();
  h.video.duration = 120;
  h.tick();
  assert.equal(h.status().status, "live");
  assert.equal(h.posted.filter((entry) => entry.message.type === "read").length, 1);
  assert.equal(h.pending.length, 0);
});

test("navigation and disablement cancel pending readiness and reject the old video", async () => {
  const h = createContent({ enabled: true, duration: NaN });
  h.navigate(VIDEO_B);
  assert.equal(h.status().status, "waiting-player");
  assert.ok(h.posted.some((entry) => entry.message.type === "cancel" && entry.message.videoId === VIDEO_A));
  h.video.duration = 120;
  h.tick();
  assert.equal(h.latestRead().videoId, VIDEO_B);
  await h.receive({ videoId: VIDEO_A, requestId: "request-1" });
  assert.equal(h.pending.length, 0);
  const disabled = createContent({ enabled: true, duration: NaN });
  disabled.setEnabled(false);
  disabled.video.duration = 120;
  disabled.tick();
  assert.equal(disabled.status().status, "disabled");
  assert.equal(disabled.latestRead(), undefined);
});

test("an actual terminal caption failure never restarts acquisition when metadata or ad state changes", async () => {
  const h = createContent({ enabled: true });
  await h.receive({ type: "error", error: "no-captions" });
  h.setAdClass("ad-showing", true);
  h.video.duration = NaN;
  h.tick();
  h.setAdClass("ad-showing", false);
  h.video.duration = 120;
  h.tick();
  assert.equal(h.status().status, "captions-unavailable");
  assert.equal(h.posted.filter((entry) => entry.message.type === "read").length, 1);
  assert.equal(h.pending.length, 0);
});

test("content rejects cross-origin, other-window, uncorrelated and other-video messages", async () => {
  const h = createContent({ enabled: true });
  await h.receive({}, { source: {} });
  await h.receive({}, { origin: "https://evil.example" });
  await h.receive({ requestId: "stale-correlation" });
  await h.receive({ videoId: VIDEO_B });
  await h.receive({ source: "some-other-channel" });
  assert.equal(h.pending.length, 0);
  assert.equal(h.status().status, "reading-captions");
});

test("valid captions produce one analysis request, ready status, and a noninteractive heatmap", async () => {
  const h = createContent({ enabled: true });
  h.dispatch();
  await flush();
  assert.equal(h.status().status, "analyzing");
  assert.equal(h.pending.length, 1);
  await h.receive();
  assert.equal(h.pending.length, 1);
  await h.finish();
  assert.deepEqual(h.status(), { status: "ready", canUndo: false, count: 1 });
  assert.equal(h.bar.children.length, 1);
  assert.equal(h.bar.children[0].id, "video-flow-sponsor-heatmap");
  assert.equal(h.bar.children[0].style.pointerEvents, "none");
  assert.equal(h.bar.children[0].children.length, 1);
  h.tick();
  await h.receive();
  assert.equal(h.bar.children.length, 1);
  assert.equal(h.pending.length, 1);
  assert.equal(JSON.stringify(h.messages).includes("key"), false);
  assert.equal(JSON.stringify(h.messages).includes("pot="), false);
});

test("navigation cancels the old video and ignores its caption and classification responses", async () => {
  const h = createContent({ enabled: true });
  const previous = h.latestRead();
  h.dispatch();
  await flush();
  h.navigate(VIDEO_B);
  assert.equal(h.latestRead().videoId, VIDEO_B);
  assert.ok(h.messages.some((message) => message.type === "sponsor:cancel" && message.videoId === VIDEO_A));
  await h.receive({ videoId: VIDEO_A, requestId: previous.requestId });
  await h.finish();
  assert.equal(h.status().status, "reading-captions");
  assert.equal(h.pending.length, 1);
  assert.equal(h.bar.children.length, 0);
  assert.equal(h.video.currentTime, 0);
});

test("disabling cancels pending analysis, removes the heatmap and prevents stale responses", async () => {
  const h = createContent({ enabled: true });
  h.dispatch();
  await flush();
  h.setEnabled(false);
  await h.finish();
  assert.equal(h.status().status, "disabled");
  assert.equal(h.bar.children.length, 0);
  assert.ok(h.messages.some((message) => message.type === "sponsor:cancel"));
  h.tick();
  assert.equal(h.video.currentTime, 0);
});

test("malformed captions and live or unavailable video status never request analysis", async () => {
  for (const patch of [{ captions: {} }, { captions: { events: [] } }, { captions: null }, { type: "error", error: "live" }, { type: "error", error: "no-captions" }]) {
    const h = createContent({ enabled: true });
    await h.receive(patch);
    assert.equal(h.pending.length, 0);
    assert.equal(h.status().status, patch.error === "live" ? "live" : "captions-unavailable");
    assert.equal(h.video.currentTime, 0);
  }
});

test("caption timeout and terminal page errors ignore later matching caption messages", async () => {
  for (const terminal of ["timeout", "no-captions", "live"]) {
    const h = createContent({ enabled: true });
    if (terminal === "timeout") h.runTimer(12000);
    else await h.receive({ type: "error", error: terminal });
    const status = h.status().status;
    h.dispatch();
    await flush();
    assert.equal(h.pending.length, 0, terminal);
    assert.equal(h.status().status, status, terminal);
  }
});

test("matching failure responses leave playback unchanged and expose sanitized status", async () => {
  const h = createContent({ enabled: true });
  h.dispatch();
  await flush();
  await h.finish(0, { ok: false, error: "authentication", details: "private native diagnostic" });
  assert.deepEqual(h.status(), { status: "authentication", canUndo: false, count: 0 });
  assert.equal(h.video.currentTime, 0);
  assert.equal(h.bar.children.length, 0);
});

test("playback preserves both boundary cues, skips only sponsor interior, and supports undo and replay", async () => {
  const h = createContent({ enabled: true });
  h.dispatch({ captions: { events: [
    { tStartMs: 10000, dDurationMs: 2000, segs: [{ utf8: "The review is always changing." }] },
    { tStartMs: 12000, dDurationMs: 2000, segs: [{ utf8: "Our synthetic sponsor sells storage." }] },
    { tStartMs: 14000, dDurationMs: 2000, segs: [{ utf8: "Their advertised drive comes in several sizes." }] },
    { tStartMs: 16000, dDurationMs: 2000, segs: [{ utf8: "Use the sponsor link for the promotion." }] },
    { tStartMs: 18000, dDurationMs: 2000, segs: [{ utf8: "Now back to the ordinary review." }] }
  ] } });
  await flush();
  await h.finish();
  // The mocked classifier labels the whole mixed window as sponsor. The
  // integration must still preserve its first and last source captions.
  h.video.currentTime = 11;
  h.video.dispatch("timeupdate");
  assert.equal(h.video.currentTime, 11);
  assert.equal(h.status().canUndo, false);
  h.video.currentTime = 19;
  h.video.dispatch("timeupdate");
  assert.equal(h.video.currentTime, 19);
  assert.equal(h.status().canUndo, false);
  h.video.currentTime = 13;
  h.video.dispatch("timeupdate");
  assert.equal(h.video.currentTime, 18);
  assert.equal(h.status().canUndo, true);
  const hud = h.player.children.find((child) => child.id === "video-flow-sponsor-undo");
  assert.ok(hud);
  hud.children.find((child) => child.tagName === "button").dispatch("click");
  assert.equal(h.video.currentTime, 13);
  h.tick();
  assert.equal(h.video.currentTime, 13);
  assert.equal(h.status().canUndo, false);
  h.video.currentTime = 14;
  h.video.dispatch("seeking");
  h.video.dispatch("timeupdate");
  assert.equal(h.video.currentTime, 14);
});

test("a confident single-cue sponsor stays visible in the heatmap without an automatic seek", async () => {
  const h = createContent({ enabled: true });
  h.dispatch();
  await flush();
  await h.finish();
  assert.equal(h.status().status, "ready");
  assert.equal(h.bar.children[0].children.length, 1);
  h.video.currentTime = 11;
  h.video.dispatch("timeupdate");
  assert.equal(h.video.currentTime, 11);
  assert.equal(h.status().canUndo, false);
});

test("content does not activate in child frames", () => {
  const h = createContent({ enabled: true, frame: true });
  assert.equal(h.runtimeListener, undefined);
  assert.equal(h.messages.length, 0);
  assert.equal(h.posted.length, 0);
});

test("disabling ready analysis removes the heatmap and cancels further automatic seeks", async () => {
  const h = createContent({ enabled: true });
  h.dispatch();
  await flush();
  await h.finish();
  assert.equal(h.bar.children.length, 1);
  h.setEnabled(false);
  assert.equal(h.bar.children.length, 0);
  h.video.currentTime = 11;
  h.tick();
  assert.equal(h.video.currentTime, 11);
  assert.equal(h.status().status, "disabled");
});
