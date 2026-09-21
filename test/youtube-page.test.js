const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../web-extension/youtube-page.js"), "utf8");
const VIDEO_A = "abcdefghijk";
const VIDEO_B = "12345678901";
const CHANNEL = "video-flow-keys:captions";
const signedUrl = (videoId = VIDEO_A) => `https://www.youtube.com/api/timedtext?v=${videoId}&pot=synthetic-proof&fmt=srv3`;
const captionBody = { events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: "Synthetic example sentence." }] }] };
const copy = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function createPage(options = {}) {
  const messages = [];
  const requests = [];
  const selections = [];
  const pendingFetches = [];
  const listeners = new Map();
  const documentListeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let moduleLoads = 0;
  let track = options.previousTrack || {};
  const location = new URL(`https://www.youtube.com/watch?v=${VIDEO_A}`);
  const details = { videoDetails: { videoId: VIDEO_A, title: "Synthetic video", lengthSeconds: "120", isLiveContent: options.live || false } };
  let page;
  const player = {
    getPlayerResponse() { return options.noDetails ? null : details; },
    getOption(_module, name) { return name === "track" ? track : options.noTracks ? [] : [{ languageCode: "en", vssId: ".en" }, { languageCode: "fr", vssId: ".fr" }]; },
    setOption(_module, _name, value) {
      track = { ...value };
      selections.push(copy(value));
      if (value.languageCode && options.captureOnSelect !== false) void page.fetch(signedUrl(details.videoDetails.videoId));
      if (options.onSelect) options.onSelect(page, value);
    },
    loadModule() { moduleLoads++; }
  };
  const document = {
    querySelector(selector) {
      if (selector === "#movie_player") return options.noPlayer ? null : player;
      if (selector === ".ytp-subtitles-button") return { getAttribute() { return options.previouslyOn ? "true" : "false"; } };
      return null;
    },
    addEventListener(name, listener) { if (!documentListeners.has(name)) documentListeners.set(name, new Set()); documentListeners.get(name).add(listener); },
    removeEventListener(name, listener) { documentListeners.get(name)?.delete(listener); }
  };
  class FakeXHR { open(...args) { this.openArguments = args; } }
  page = {
    location, document, URL, AbortController, XMLHttpRequest: FakeXHR,
    setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    postMessage(message, origin) { messages.push({ message: copy(message), origin }); },
    fetch(rawUrl, init) {
      requests.push({ url: typeof rawUrl === "string" ? rawUrl : rawUrl.url, init });
      const response = { ok: options.httpFailure ? false : true, headers: { get() { return options.contentLength || null; } }, async text() { return options.body === undefined ? JSON.stringify(captionBody) : options.body; } };
      if (init?.signal && options.deferFetch) return new Promise((resolve, reject) => {
        pendingFetches.push({ resolve: () => resolve(response), reject });
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return Promise.resolve(response);
    }
  };
  page.window = page;
  page.globalThis = page;
  page.top = options.frame ? {} : page;
  const context = vm.createContext(page);
  vm.runInContext(script, context, { filename: "youtube-page.js" });
  const pageIdentity = vm.runInContext("window", context);
  function dispatch(data, overrides = {}) {
    for (const listener of listeners.get("message") || []) listener({ data, source: pageIdentity, origin: location.origin, ...overrides });
  }
  function read(requestId = "request-1", videoId = VIDEO_A, overrides = {}) {
    dispatch({ source: `${CHANNEL}:request`, type: "read", requestId, videoId }, overrides);
  }
  function cancel(requestId = "request-1", videoId = VIDEO_A) { dispatch({ source: `${CHANNEL}:request`, type: "cancel", requestId, videoId }); }
  function runDelay(ms = 150) {
    for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.callback(); }
  }
  async function settle() {
    for (let index = 0; index < 60; index++) { await flush(); if (![...timers.values()].some((timer) => timer.ms === 150)) break; runDelay(); }
    await flush();
  }
  function gesture(type, details = {}) { for (const listener of documentListeners.get(type) || []) listener({ type, isTrusted: true, ...details }); }
  function navigate(id, metadataReady = true) { location.href = `https://www.youtube.com/watch?v=${id}`; if (metadataReady) details.videoDetails.videoId = id; }
  return { page, messages, requests, selections, pendingFetches, read, cancel, dispatch, settle, runDelay, gesture, navigate, setMetadataVideo: (id) => { details.videoDetails.videoId = id; }, moduleLoads: () => moduleLoads, track: () => copy(track), setTrack: (value) => { track = value; } };
}

test("page bridge reuses a signed fetch URL, requests JSON3, and exposes captions without request credentials", async () => {
  const h = createPage();
  await h.page.fetch({ url: signedUrl() });
  h.read();
  await h.settle();
  assert.deepEqual(h.messages.map((entry) => entry.message.type), ["details", "captions"]);
  const reread = h.requests.find((request) => request.init?.signal);
  assert.equal(new URL(reread.url).searchParams.get("fmt"), "json3");
  assert.equal(new URL(reread.url).searchParams.get("pot"), "synthetic-proof");
  assert.equal(reread.init.credentials, "include");
  assert.equal(reread.init.redirect, "error");
  assert.deepEqual(h.messages[1].message.captions, captionBody);
  assert.equal(h.selections.length, 0);
  assert.equal(JSON.stringify(h.messages).includes("synthetic-proof"), false);
  assert.equal(JSON.stringify(h.messages).includes("apiKey"), false);
  assert.ok(h.messages.every((entry) => entry.origin === "https://www.youtube.com"));
});

test("page bridge also intercepts XMLHttpRequest caption requests", async () => {
  const h = createPage();
  const xhr = new h.page.XMLHttpRequest();
  xhr.open("GET", signedUrl());
  h.read();
  await h.settle();
  assert.equal(h.messages.at(-1).message.type, "captions");
  assert.deepEqual(xhr.openArguments, ["GET", signedUrl()]);
});

test("page bridge rejects non-player caption destinations, proofless URLs and another video's requests", async () => {
  const invalidUrls = [
    signedUrl().replace("https:", "http:"),
    signedUrl().replace("www.youtube.com", "www.youtube.com.evil.test"),
    signedUrl().replace("www.youtube.com", "www.youtube.com:8443"),
    signedUrl().replace("https://", "https://user:password@"),
    signedUrl().replace("/api/timedtext", "/not-captions"),
    signedUrl().replace("&pot=synthetic-proof", ""),
    signedUrl(VIDEO_B)
  ];
  for (const invalid of invalidUrls) {
    const h = createPage({ noTracks: true });
    await h.page.fetch(invalid);
    h.read();
    await h.settle();
    assert.equal(h.requests.filter((request) => request.init?.signal).length, 0, invalid);
    assert.equal(h.messages.at(-1).message.error, "no-captions", invalid);
  }
});

test("caption acquisition restores captions off after its temporary track selection", async () => {
  const h = createPage();
  h.read();
  await h.settle();
  assert.deepEqual(h.selections, [{ languageCode: "en", vssId: ".en" }, {}]);
  assert.deepEqual(h.track(), {});
  assert.equal(h.messages.at(-1).message.type, "captions");
});

test("caption acquisition restores an existing language and preserves a later trusted user choice", async () => {
  const previous = { languageCode: "fr", vssId: ".fr", name: "French" };
  const h = createPage({ previousTrack: previous, previouslyOn: true });
  h.read();
  await h.settle();
  assert.deepEqual(h.track(), previous);
  assert.deepEqual(h.selections.at(-1), previous);

  const changed = createPage({ deferFetch: true });
  changed.read();
  await changed.settle();
  changed.setTrack({ languageCode: "fr", vssId: ".fr" });
  changed.gesture("click", { target: { closest() { return {}; } } });
  changed.pendingFetches[0].resolve();
  await changed.settle();
  assert.deepEqual(changed.track(), { languageCode: "fr", vssId: ".fr" });
  assert.equal(changed.selections.length, 1);
});

test("trusted caption shortcut preserves the user's change even when the selected track matches", async () => {
  const h = createPage({ deferFetch: true });
  h.read();
  await h.settle();
  h.gesture("keydown", { key: "c" });
  h.pendingFetches[0].resolve();
  await h.settle();
  assert.deepEqual(h.track(), { languageCode: "en", vssId: ".en" });
  assert.equal(h.selections.length, 1);
});

test("page bridge accepts only its own same-origin correlated read messages", async () => {
  const h = createPage();
  h.read("request-1", VIDEO_A, { source: {} });
  h.read("request-1", VIDEO_A, { origin: "https://other.example" });
  h.read("bad request id");
  h.read("request-1", VIDEO_B);
  await h.settle();
  assert.equal(h.messages.length, 0);
  assert.equal(h.requests.length, 0);
});

test("live videos, no captions, and malformed caption bodies fail without fabricated captions", async () => {
  for (const options of [{ live: true }, { noTracks: true }, { body: "malformed" }, { body: "{\"events\":[]}" }, { body: "" }, { contentLength: "1000001" }, { httpFailure: true }]) {
    const h = createPage(options);
    h.read();
    await h.settle();
    assert.equal(h.messages.some((entry) => entry.message.type === "captions"), false);
    assert.equal(h.messages.at(-1).message.error, options.live ? "live" : "no-captions");
    if (options.live) assert.equal(h.requests.length, 0);
  }
});

test("navigation discards an outstanding caption response without changing the new video's track", async () => {
  const h = createPage({ deferFetch: true });
  h.read();
  await h.settle();
  h.navigate(VIDEO_B);
  h.setTrack({ languageCode: "fr", vssId: ".fr" });
  h.pendingFetches[0].resolve();
  await h.settle();
  assert.equal(h.messages.some((entry) => entry.message.type === "captions"), false);
  assert.deepEqual(h.track(), { languageCode: "fr", vssId: ".fr" });
});

test("matching cancellation aborts a pending fetch and restores the temporary caption selection", async () => {
  const h = createPage({ deferFetch: true });
  h.read();
  await h.settle();
  h.cancel("unrelated-request");
  assert.equal(h.requests.at(-1).init.signal.aborted, false);
  h.cancel();
  await h.settle();
  assert.equal(h.requests.at(-1).init.signal.aborted, true);
  assert.deepEqual(h.track(), {});
  assert.equal(h.messages.some((entry) => entry.message.type === "captions"), false);
});

test("cancellation before or during module loading cannot select a later-available caption track", async () => {
  for (const afterModuleLoad of [false, true]) {
    const options = { noTracks: true };
    const h = createPage(options);
    h.read();
    if (afterModuleLoad) {
      for (let index = 0; index < 4; index++) { h.runDelay(); await flush(); }
      assert.equal(h.moduleLoads(), 1);
    }
    h.cancel();
    options.noTracks = false;
    await h.settle();
    assert.equal(h.selections.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.messages.some((entry) => entry.message.type === "captions"), false);
    if (!afterModuleLoad) assert.equal(h.moduleLoads(), 0);
  }
});

test("replacement restores the first request exactly once and only the replacement may publish captions", async () => {
  const h = createPage({ deferFetch: true });
  h.read("request-old");
  await h.settle();
  h.read("request-new");
  await h.settle();
  assert.deepEqual(h.track(), {});
  assert.equal(h.selections.filter((selection) => !selection.languageCode).length, 1);
  assert.equal(h.pendingFetches.length, 2);
  h.pendingFetches[1].resolve();
  await h.settle();
  const published = h.messages.filter((entry) => entry.message.type === "captions");
  assert.equal(published.length, 1);
  assert.equal(published[0].message.requestId, "request-new");
  assert.equal(h.selections.filter((selection) => !selection.languageCode).length, 1);
});

test("untrusted synthetic caption gestures cannot suppress restoration", async () => {
  const h = createPage({ deferFetch: true });
  h.read();
  await h.settle();
  h.gesture("keydown", { key: "c", isTrusted: false });
  h.pendingFetches[0].resolve();
  await h.settle();
  assert.deepEqual(h.track(), {});
});

test("SPA navigation waits for matching player metadata before reading the new captions", async () => {
  const h = createPage();
  h.navigate(VIDEO_B, false);
  h.read("request-new-video", VIDEO_B);
  for (let index = 0; index < 3; index++) { h.runDelay(); await flush(); }
  assert.equal(h.messages.length, 0);
  assert.equal(h.selections.length, 0);
  h.setMetadataVideo(VIDEO_B);
  await h.settle();
  assert.deepEqual(h.messages.map((entry) => [entry.message.type, entry.message.videoId]), [["details", VIDEO_B], ["captions", VIDEO_B]]);
});

test("metadata waiting is bounded and cancellation cannot publish later-arriving metadata", async () => {
  const h = createPage();
  h.navigate(VIDEO_B, false);
  h.read("request-never-ready", VIDEO_B);
  await h.settle();
  assert.equal(h.messages.at(-1).message.error, "unavailable");
  assert.equal(h.requests.length, 0);
  const canceled = createPage();
  canceled.navigate(VIDEO_B, false);
  canceled.read("request-canceled", VIDEO_B);
  canceled.cancel("request-canceled", VIDEO_B);
  canceled.setMetadataVideo(VIDEO_B);
  await canceled.settle();
  assert.equal(canceled.messages.length, 0);
  assert.equal(canceled.selections.length, 0);
});

test("trusted language selection while the caption module loads is never overwritten", async () => {
  const options = { noTracks: true };
  const h = createPage(options);
  h.read();
  for (let index = 0; index < 4; index++) { h.runDelay(); await flush(); }
  assert.equal(h.moduleLoads(), 1);
  h.setTrack({ languageCode: "fr", vssId: ".fr" });
  h.gesture("click", { target: { closest() { return {}; } } });
  options.noTracks = false;
  await h.page.fetch(signedUrl());
  await h.settle();
  assert.deepEqual(h.track(), { languageCode: "fr", vssId: ".fr" });
  assert.equal(h.selections.length, 0);
  assert.equal(h.messages.at(-1).message.type, "captions");
});
