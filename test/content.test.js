const assert = require("node:assert/strict");
const test = require("node:test");

const videoFlowKeys = require("../web-extension/content.js");

test("normalizes Dynamo-style default keys", () => {
  const settings = videoFlowKeys.normalizeSettings({});

  assert.equal(settings.slowerKey, "s");
  assert.equal(settings.defaultKey, "d");
  assert.equal(settings.fasterKey, "f");
  assert.equal(settings.skipKey, "e");
  assert.equal(settings.resetRate, 1);
});

test("clamps playback rates to the configured range", () => {
  const settings = videoFlowKeys.normalizeSettings({
    minRate: 0.1,
    maxRate: 9.9,
    defaultRate: 2.5
  });

  assert.equal(videoFlowKeys.clampRate(0, settings), 0.1);
  assert.equal(videoFlowKeys.clampRate(3.04, settings), 3);
  assert.equal(videoFlowKeys.clampRate(20, settings), 9.9);
});

test("maps shortcut keys to actions", () => {
  const settings = videoFlowKeys.normalizeSettings({});

  assert.equal(videoFlowKeys.actionForKey("s", settings), "slower");
  assert.equal(videoFlowKeys.actionForKey("d", settings), "default");
  assert.equal(videoFlowKeys.actionForKey("f", settings), "faster");
  assert.equal(videoFlowKeys.actionForKey("e", settings), "skip");
  assert.equal(videoFlowKeys.actionForKey("x", settings), "");
});

test("ignores text input targets", () => {
  assert.equal(videoFlowKeys.shouldIgnoreKeyTarget({ tagName: "INPUT" }), true);
  assert.equal(videoFlowKeys.shouldIgnoreKeyTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(videoFlowKeys.shouldIgnoreKeyTarget({ tagName: "VIDEO" }), false);
});

test("formats readable playback rates", () => {
  assert.equal(videoFlowKeys.formatRate(1), "1x");
  assert.equal(videoFlowKeys.formatRate(2.5), "2.5x");
});
