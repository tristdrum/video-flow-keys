const assert = require("node:assert/strict");
const test = require("node:test");
const background = require("../web-extension/background.js");
const core = require("../web-extension/sponsor-core.js");

const VIDEO_A = "abcdefghijk";
const VIDEO_B = "12345678901";
const url = (id) => `https://www.youtube.com/watch?v=${id}`;
const sender = (tabId = 1, videoId = VIDEO_A) => ({ id: "extension-id", frameId: 0, tab: { id: tabId }, url: url(videoId) });
const message = (videoId = VIDEO_A) => ({ type: "sponsor:analyze", videoId, title: "A review", segments: [{ id: "s1", start: 0, end: 10, text: "This video is sponsored by Example." }] });

function result(request, probability = 0.95) {
  return { ok: true, data: { model: core.MODEL, answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, {
    type: "choice", choice: "sponsor", probabilities: { sponsor: probability, content: 1 - probability, uncertain: 0 }, confidence: 0.1
  }])) } };
}

function harness(options = {}) {
  const calls = [];
  const pending = [];
  const tabs = new Map([[1, url(VIDEO_A)], [2, url(VIDEO_B)]]);
  const state = { enabled: true };
  const api = {
    runtime: {
      id: "extension-id",
      sendNativeMessage(appId, nativeMessage, callback) {
        calls.push({ appId, message: nativeMessage });
        if (nativeMessage.type === "typesafe:cancel") { callback({ ok: true }); return; }
        if (options.pending) pending.push({ message: nativeMessage, callback });
        else callback(options.response || result(nativeMessage.request));
      }
    },
    storage: { local: { get(_defaults, callback) { callback({ skipSponsors: state.enabled }); } } },
    tabs: { get(id, callback) { callback({ id, url: tabs.get(id) }); } }
  };
  const coordinator = background.createBackground(api, { timeoutMs: options.timeoutMs });
  return { api, calls, pending, tabs, state, coordinator };
}

async function tick() { await new Promise((resolve) => setImmediate(resolve)); }

test("validates exact YouTube watch-page origin and video identity", () => {
  assert.equal(background.watchVideoId(url(VIDEO_A)), VIDEO_A);
  for (const invalid of ["https://youtube.com/watch?v=abcdefghijk", "https://www.youtube.com.evil.test/watch?v=abcdefghijk", "http://www.youtube.com/watch?v=abcdefghijk", "https://www.youtube.com/shorts/abcdefghijk", "https://user@www.youtube.com/watch?v=abcdefghijk", "https://www.youtube.com/watch?v=wrong"]) assert.equal(background.watchVideoId(invalid), null);
});

test("coordinator accepts only authenticated top-frame video messages and refuses key commands", async () => {
  const h = harness();
  for (const untrusted of [{ ...sender(), frameId: 1 }, { ...sender(), id: "another-extension" }, { ...sender(), url: "https://other.example/" }, sender(1, VIDEO_B), { url: url(VIDEO_A), frameId: 0 }]) {
    assert.deepEqual(await h.coordinator.handleMessage(message(), untrusted), { ok: false, error: "unauthorized" });
  }
  assert.deepEqual(await h.coordinator.handleMessage({ type: "typesafe:set-key", key: "untrusted" }, sender()), { ok: false, error: "unauthorized" });
  assert.equal(h.calls.length, 0);
});

test("disabled analysis never invokes native API", async () => {
  const h = harness();
  h.state.enabled = false;
  assert.deepEqual(await h.coordinator.handleMessage(message(), sender()), { ok: false, error: "disabled" });
  assert.equal(h.calls.length, 0);
});

test("uses fixed native app and returns only sanitized classification results", async () => {
  const h = harness();
  const response = await h.coordinator.handleMessage(message(), sender());
  assert.deepEqual(response, { ok: true, videoId: VIDEO_A, segments: [{ id: "s1", start: 0, end: 10, probability: 0.95, category: "sponsor" }] });
  assert.equal(h.calls[0].appId, "com.tristdrum.VideoFlowKeys");
  assert.equal(h.calls[0].message.type, "typesafe:classify");
  assert.ok(h.calls[0].message.requestId);
  assert.equal(JSON.stringify(h.calls).includes("key"), false);
});

test("native auth, throttling, and timeout errors pass through without retry", async () => {
  for (const error of ["authentication", "rate-limited", "timeout", "key-unavailable"]) {
    const h = harness({ response: { ok: false, error } });
    assert.deepEqual(await h.coordinator.handleMessage(message(), sender()), { ok: false, error });
    assert.equal(h.calls.length, 1);
  }
  const h = harness({ response: { ok: false, error: "Raw private diagnostic", details: "Never forward native diagnostic text" } });
  assert.deepEqual(await h.coordinator.handleMessage(message(), sender()), { ok: false, error: "invalid-response" });
});

test("ignores an outstanding result after cancellation and sends matching native cancel", async () => {
  const h = harness({ pending: true });
  const analyzing = h.coordinator.handleMessage(message(), sender());
  await tick();
  const pending = h.pending[0];
  assert.deepEqual(await h.coordinator.handleMessage({ type: "sponsor:cancel", videoId: VIDEO_A }, sender()), { ok: true, videoId: VIDEO_A });
  assert.deepEqual(await analyzing, { ok: false, error: "cancelled" });
  assert.deepEqual(h.calls[1].message, { type: "typesafe:cancel", requestId: pending.message.requestId });
  pending.callback(result(pending.message.request));
});

test("a replaced same-tab request cannot publish stale results", async () => {
  const h = harness({ pending: true });
  const first = h.coordinator.handleMessage(message(), sender());
  await tick();
  const second = h.coordinator.handleMessage(message(), sender());
  await tick();
  assert.deepEqual(await first, { ok: false, error: "cancelled" });
  h.pending[0].callback(result(h.pending[0].message.request, 0.91));
  h.pending[1].callback(result(h.pending[1].message.request, 0.99));
  assert.equal((await second).segments[0].probability, 0.99);
  assert.notEqual(h.pending[0].message.requestId, h.pending[1].message.requestId);
});

test("simultaneous tabs are independent and can only cancel their own work", async () => {
  const h = harness({ pending: true });
  const first = h.coordinator.handleMessage(message(), sender());
  const second = h.coordinator.handleMessage(message(VIDEO_B), sender(2, VIDEO_B));
  await tick();
  await h.coordinator.handleMessage({ type: "sponsor:cancel", videoId: VIDEO_A }, sender());
  assert.deepEqual(await first, { ok: false, error: "cancelled" });
  const secondPending = h.pending.find((pending) => pending !== h.pending[0]);
  secondPending.callback(result(secondPending.message.request));
  assert.equal((await second).videoId, VIDEO_B);
});

test("navigating or closing a tab cancels pending native work", async () => {
  for (const action of ["navigate", "close"]) {
    const h = harness({ pending: true });
    const analyzing = h.coordinator.handleMessage(message(), sender());
    await tick();
    if (action === "navigate") h.coordinator.onTabUpdated(1, { url: url(VIDEO_B) });
    else h.coordinator.onTabRemoved(1);
    assert.deepEqual(await analyzing, { ok: false, error: "cancelled" });
    assert.equal(h.calls.at(-1).message.type, "typesafe:cancel");
  }
});

test("disabling settings cancels all tabs and stale success cannot revive analysis", async () => {
  const h = harness({ pending: true });
  const analyzing = h.coordinator.handleMessage(message(), sender());
  await tick();
  h.state.enabled = false;
  h.coordinator.onStorageChanged({ skipSponsors: { newValue: false } }, "local");
  h.pending[0].callback(result(h.pending[0].message.request));
  assert.deepEqual(await analyzing, { ok: false, error: "cancelled" });
});

test("rechecks settings and current tab URL even if change events were missed", async () => {
  for (const change of ["disabled", "navigation"]) {
    const h = harness({ pending: true });
    const analyzing = h.coordinator.handleMessage(message(), sender());
    await tick();
    if (change === "disabled") h.state.enabled = false;
    else h.tabs.set(1, url(VIDEO_B));
    h.pending[0].callback(result(h.pending[0].message.request));
    assert.deepEqual(await analyzing, { ok: false, error: change === "disabled" ? "disabled" : "cancelled" });
  }
});

test("native timeout cancels once and returns without waiting for a callback", async () => {
  const h = harness({ pending: true, timeoutMs: 5 });
  assert.deepEqual(await h.coordinator.handleMessage(message(), sender()), { ok: false, error: "timeout" });
  assert.deepEqual(h.calls.map((call) => call.message.type), ["typesafe:classify", "typesafe:cancel"]);
});

test("invalid transcript data and malformed native results are rejected", async () => {
  const h = harness();
  const malformed = message();
  malformed.segments[0].text = "x".repeat(8001);
  assert.deepEqual(await h.coordinator.handleMessage(malformed, sender()), { ok: false, error: "invalid-request" });
  assert.equal(h.calls.length, 0);
  const bad = harness({ response: { ok: true, data: { model: core.MODEL, answers: { s1: { confidence: 0.99 } } } } });
  assert.deepEqual(await bad.coordinator.handleMessage(message(), sender()), { ok: false, error: "invalid-response" });
});

test("promise-based Safari APIs are supported without double resolution", async () => {
  const h = harness();
  h.api.storage.local.get = async () => ({ skipSponsors: true });
  h.api.tabs.get = async () => ({ id: 1, url: url(VIDEO_A) });
  h.api.runtime.sendNativeMessage = async (_appId, nativeMessage) => result(nativeMessage.request);
  assert.equal((await h.coordinator.handleMessage(message(), sender())).ok, true);
});

test("batches run serially and a later failure discards all earlier classification data", async () => {
  const h = harness({ pending: true });
  const longMessage = message();
  longMessage.segments = Array.from({ length: 40 }, (_, index) => ({ id: `s${index + 1}`, start: index * 10, end: index * 10 + 10, text: "A spoken sentence." }));
  const analyzing = h.coordinator.handleMessage(longMessage, sender());
  await tick();
  assert.equal(h.pending.length, 1);
  h.pending[0].callback(result(h.pending[0].message.request));
  await tick();
  assert.equal(h.pending.length, 2);
  h.pending[1].callback({ ok: false, error: "service-unavailable" });
  assert.deepEqual(await analyzing, { ok: false, error: "service-unavailable" });
});

test("a canceled storage lookup cannot cancel a newer job when it resolves", async () => {
  const h = harness();
  const storageLookups = [];
  h.api.storage.local.get = (_defaults, callback) => { storageLookups.push(callback); };
  const first = h.coordinator.handleMessage(message(), sender());
  const second = h.coordinator.handleMessage(message(), sender());
  storageLookups[0]({ skipSponsors: false });
  storageLookups[1]({ skipSponsors: true });
  await tick();
  assert.deepEqual(await first, { ok: false, error: "cancelled" });
  assert.equal(h.calls.length, 1);
  storageLookups[2]({ skipSponsors: true });
  assert.equal((await second).ok, true);
});

test("runtime failures expose fixed codes rather than raw native diagnostics", async () => {
  const h = harness();
  h.api.runtime.sendNativeMessage = (_appId, _nativeMessage, callback) => {
    h.api.runtime.lastError = { message: "raw diagnostic must stay private" };
    callback();
    delete h.api.runtime.lastError;
  };
  assert.deepEqual(await h.coordinator.handleMessage(message(), sender()), { ok: false, error: "network-error" });
});
