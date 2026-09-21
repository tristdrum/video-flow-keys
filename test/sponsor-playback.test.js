const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../web-extension/sponsor-playback.js");

function setup() {
  let snapshot = { videoId: "abcdefghijk", media: {}, currentTime: 10, duration: 100,
    paused: false, seeking: false, adShowing: false, live: false, ended: false };
  const seeks = [];
  const controller = createController({ getSnapshot: () => snapshot,
    seek(time) { seeks.push(time); snapshot.currentTime = time; } });
  controller.reset(snapshot.videoId);
  controller.setEnabled(true);
  controller.setSegments(snapshot.videoId, [{ id: "s1", start: 10, end: 20, category: "sponsor", probability: 0.95 }]);
  return { controller, snapshot, seeks, replace(value) { snapshot = value; } };
}

test("skips confident sponsors, supports undo, and never loops on replay", () => {
  const { controller, snapshot, seeks } = setup();
  assert.equal(controller.tick(), true);
  assert.deepEqual(seeks, [20]);
  assert.equal(controller.undo(), true);
  assert.equal(snapshot.currentTime, 10);
  assert.equal(controller.tick(), false);
  snapshot.currentTime = 12;
  assert.equal(controller.tick(), false);
});

test("manual seek into a sponsor lets the user watch it", () => {
  const { controller, snapshot, seeks } = setup();
  snapshot.currentTime = 14;
  controller.manualSeek();
  assert.equal(controller.tick(), false);
  assert.deepEqual(seeks, []);
});

test("ad-bypass seeks do not exempt matching content sponsor timestamps", () => {
  const { controller, snapshot } = setup();
  snapshot.adShowing = true;
  snapshot.currentTime = 15;
  controller.manualSeek();
  snapshot.adShowing = false;
  snapshot.currentTime = 10;
  assert.equal(controller.tick(), true);
});

test("pause, seeking, ad, live, end, disablement, and mismatched video prevent skips", () => {
  for (const patch of [{ paused: true }, { seeking: true }, { adShowing: true }, { live: true },
    { ended: true }, { duration: Infinity }, { videoId: "other-video" }]) {
    const { controller, snapshot, seeks } = setup();
    Object.assign(snapshot, patch);
    assert.equal(controller.tick(), false);
    assert.deepEqual(seeks, []);
  }
  const { controller } = setup();
  controller.setEnabled(false);
  assert.equal(controller.tick(), false);
});

test("late callbacks never rewind and playback rate does not change media boundaries", () => {
  const { controller, snapshot, seeks } = setup();
  snapshot.currentTime = 21;
  assert.equal(controller.tick(), false);
  snapshot.currentTime = 12;
  snapshot.playbackRate = 3;
  assert.equal(controller.tick(), true);
  assert.deepEqual(seeks, [20]);
});

test("navigation discards old results and undo", () => {
  const { controller, snapshot } = setup();
  controller.tick();
  controller.reset("newvideo123");
  snapshot.videoId = "newvideo123";
  assert.equal(controller.setSegments("abcdefghijk", [{ id: "late", start: 20, end: 30, probability: 1, category: "sponsor" }]), false);
  assert.equal(controller.tick(), false);
  assert.equal(controller.undo(), false);
});

test("low probability, non-sponsor and out-of-duration intervals never skip", () => {
  for (const patch of [{ probability: 0.89 }, { category: "uncertain" }, { end: 101 }, { probability: NaN }]) {
    const { controller, snapshot } = setup();
    controller.setSegments(snapshot.videoId, [{ id: "x", start: 10, end: 20, probability: 1, category: "sponsor", ...patch }]);
    assert.equal(controller.tick(), false);
  }
});

test("an ad or a media replacement between scheduling and seeking prevents a seek", () => {
  for (const replacement of [{ adShowing: true }, { media: {} }, { videoId: "other-video" }]) {
    let reads = 0;
    const original = { videoId: "abcdefghijk", media: {}, currentTime: 10, duration: 100 };
    let seeks = 0;
    const controller = createController({ getSnapshot: () => (++reads === 1 ? original : { ...original, ...replacement }), seek() { seeks++; } });
    controller.reset(original.videoId);
    controller.setEnabled(true);
    controller.setSegments(original.videoId, [{ id: "s", start: 10, end: 20, category: "sponsor", probability: 1 }]);
    assert.equal(controller.tick(), false);
    assert.equal(seeks, 0);
  }
});
