(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VideoFlowSponsorPlayback = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";
  const THRESHOLD = 0.90;

  function createController({ getSnapshot, seek, onSkip = () => {} }) {
    let videoId = "";
    let segments = [];
    let enabled = false;
    let exempt = new Set();
    let lastSkip = null;
    let programmaticTarget = null;

    function reset(id) {
      videoId = id;
      segments = [];
      exempt = new Set();
      lastSkip = null;
      programmaticTarget = null;
    }
    function setSegments(id, values) {
      if (id !== videoId) return false;
      segments = values.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) &&
        s.start >= 0 && s.end > s.start && Number.isFinite(s.probability) &&
        s.probability >= 0 && s.probability <= 1).map((s) => ({ ...s }));
      return true;
    }
    function valid(snapshot) {
      return enabled && snapshot && snapshot.videoId === videoId && !snapshot.adShowing &&
        !snapshot.live && Number.isFinite(snapshot.duration) && snapshot.duration > 0 &&
        Number.isFinite(snapshot.currentTime) && !snapshot.ended;
    }
    function manualSeek() {
      const snapshot = getSnapshot();
      if (!valid(snapshot)) return;
      if (programmaticTarget !== null && Math.abs(snapshot.currentTime - programmaticTarget) < 0.5) {
        programmaticTarget = null;
        return;
      }
      programmaticTarget = null;
      for (const segment of segments) {
        if (snapshot.currentTime >= segment.start && snapshot.currentTime < segment.end) exempt.add(segment.id);
      }
    }
    function tick() {
      const snapshot = getSnapshot();
      if (!valid(snapshot) || snapshot.paused || snapshot.seeking) return false;
      const segment = segments.find((s) => s.category === "sponsor" && s.probability >= THRESHOLD &&
        !exempt.has(s.id) && snapshot.currentTime >= s.start && snapshot.currentTime < s.end &&
        s.end <= snapshot.duration);
      if (!segment) return false;
      // A fresh read immediately before seeking prevents ad/media transitions from
      // turning a stale analysis into a seek in a different timeline.
      const current = getSnapshot();
      if (!valid(current) || current.paused || current.seeking ||
          current.media !== snapshot.media || current.source !== snapshot.source ||
          current.currentTime < segment.start || current.currentTime >= segment.end) return false;
      exempt.add(segment.id);
      lastSkip = { videoId, segment, from: current.currentTime };
      programmaticTarget = segment.end;
      seek(segment.end);
      onSkip(lastSkip);
      return true;
    }
    function undo() {
      const current = getSnapshot();
      if (!lastSkip || !valid(current) || lastSkip.videoId !== videoId) return false;
      exempt.add(lastSkip.segment.id);
      programmaticTarget = lastSkip.from;
      seek(lastSkip.from);
      lastSkip = null;
      return true;
    }
    return { reset, setSegments, tick, manualSeek, undo,
      setEnabled(value) { enabled = value === true; },
      canUndo() { return lastSkip !== null; }
    };
  }
  return { THRESHOLD, createController };
});
