const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../web-extension/sponsor-core.js");
const playback = require("../web-extension/sponsor-playback.js");

function event(start, duration, text) { return { tStartMs: start, dDurationMs: duration, segs: [{ utf8: text }] }; }
function segment(id = "s0001", start = 0, text = "This video is sponsored by Example.") { return { id, start, end: start + 10, text }; }
function answer(probability = 0.97, choice = "sponsor") {
  return { type: "choice", choice, probabilities: { sponsor: probability, content: 1 - probability, uncertain: 0 }, confidence: 0.01 };
}
function response(segments, probability) {
  return { model: core.MODEL, answers: Object.fromEntries(segments.map((item) => [item.id, answer(probability)])) };
}

test("parses JSON3, removes complete duplicate windows, and retains untimed mixed text", () => {
  const cues = core.parseCaptions(JSON.stringify({ events: [
    { wWinId: 0 },
    event(0, 5000, "We built a tiny house"),
    event(2000, 5000, "a tiny house in the woods"),
    event(4000, 2000, "in the woods"),
    event(6000, 1000, "Today."),
    event(6500, 500, "Today.")
  ] }));
  assert.deepEqual(cues, [
    { start: 0, end: 2, text: "We built a tiny house" },
    { start: 2, end: 7, text: "a tiny house in the woods" },
    { start: 6, end: 7, text: "Today." }
  ].map((item, index, items) => ({ ...item, end: items[index + 1] ? Math.min(item.end, items[index + 1].start) : item.end })));
});

test("timed rolling deduplication compares the original preceding cue", () => {
  const cues = core.parseCaptions({ events: [
    event(0, 5000, "one two three four"),
    { tStartMs: 2000, dDurationMs: 5000, segs: [{ utf8: "two three four ", tOffsetMs: 0 }, { utf8: "five", tOffsetMs: 2000 }] },
    { tStartMs: 4000, dDurationMs: 5000, segs: [{ utf8: "three four five ", tOffsetMs: 0 }, { utf8: "six", tOffsetMs: 2000 }] }
  ] });
  assert.deepEqual(cues.map((cue) => cue.text), ["one two three four", "five", "six"]);
  assert.deepEqual(cues.map((cue) => cue.start), [0, 4, 6]);
});

test("rolling editorial prefixes cannot give a sponsor interval an earlier start than its measured words", () => {
  const cues = core.parseCaptions({ events: [
    event(0, 12000, "That explains the science."),
    { tStartMs: 8000, dDurationMs: 12000, segs: [
      { utf8: "That explains the science. ", tOffsetMs: 0 },
      { utf8: "This segment is sponsored by Example.", tOffsetMs: 4000 }
    ] }
  ] });
  assert.deepEqual(cues, [
    { start: 0, end: 12, text: "That explains the science." },
    { start: 12, end: 20, text: "This segment is sponsored by Example." }
  ]);
  const segments = core.segmentCaptions(cues, 20);
  assert.equal(segments.length, 2);
  const results = core.parseAnswers({ model: core.MODEL, answers: {
    [segments[0].id]: answer(0.01, "content"),
    [segments[1].id]: answer(0.99)
  } }, segments);
  let currentTime = 8;
  const controller = playback.createController({
    getSnapshot: () => ({ videoId: "abcdefghijk", currentTime, duration: 20, paused: false }),
    seek: (value) => { currentTime = value; }
  });
  controller.reset("abcdefghijk");
  controller.setEnabled(true);
  controller.setSegments("abcdefghijk", results);
  assert.equal(controller.tick(), false);
  assert.equal(currentTime, 8);
  currentTime = 12;
  assert.equal(controller.tick(), true);
  assert.equal(currentTime, 20);
});

test("missing or invalid word timing retains editorial evidence in a rolling mixed caption", () => {
  const prefix = "That explains the science.";
  for (const offset of [undefined, -1, NaN, Infinity, "4000", 12000]) {
    const cues = core.parseCaptions({ events: [
      event(0, 12000, prefix),
      { tStartMs: 8000, dDurationMs: 12000, segs: [{ utf8: `${prefix} `, tOffsetMs: 0 }, { utf8: "A sponsor read follows.", tOffsetMs: offset }] }
    ] });
    assert.equal(cues[1].start, 8);
    assert.equal(cues[1].text, `${prefix} A sponsor read follows.`);
  }
  const singlePart = core.parseCaptions({ events: [event(0, 12000, prefix), {
    tStartMs: 8000, dDurationMs: 12000, segs: [{ utf8: `${prefix} A sponsor read follows.`, tOffsetMs: 0 }]
  }] });
  assert.equal(singlePart[1].text, `${prefix} A sponsor read follows.`);
});

test("nonmonotonic caption offsets do not create a deduplicated sponsor-only interval", () => {
  const cues = core.parseCaptions({ events: [
    event(0, 12000, "That explains the science."),
    { tStartMs: 8000, dDurationMs: 12000, segs: [
      { utf8: "That explains the science. ", tOffsetMs: 2000 },
      { utf8: "A sponsor read follows.", tOffsetMs: 1000 }
    ] }
  ] });
  assert.equal(cues[1].start, 8);
  assert.equal(cues[1].text, "That explains the science. A sponsor read follows.");
});

test("the first caption word's explicit offset is respected without a rolling prefix", () => {
  const cues = core.parseCaptions({ events: [{ tStartMs: 8000, dDurationMs: 12000,
    segs: [{ utf8: "Sponsor read starts here.", tOffsetMs: 4000 }] }] });
  assert.deepEqual(cues, [{ start: 12, end: 20, text: "Sponsor read starts here." }]);
});

test("does not deduplicate repetitions separated by a pause", () => {
  assert.deepEqual(core.parseCaptions({ events: [event(0, 1000, "do it again"), event(3000, 1000, "do it again")] }).map((cue) => cue.text), ["do it again", "do it again"]);
});

test("preserves short intentional repetitions in adjacent non-overlapping cues", () => {
  assert.deepEqual(core.parseCaptions({ events: [event(0, 1000, "no"), event(1000, 1000, "no")] }).map((cue) => cue.text), ["no", "no"]);
});

test("caption parsing fails safely on empty malformed or excessive inputs", () => {
  for (const input of [null, undefined, "", "{", [], {}, { events: "wrong" }, { events: Array(core.LIMITS.captionEvents + 1).fill({}) }]) assert.deepEqual(core.parseCaptions(input), []);
  assert.deepEqual(core.parseCaptions({ events: [event(-1, 1000, "wrong"), event(0, -5, "wrong"), event(NaN, 10, "wrong"), event(0, 1000, "\n"), event(0, 100000, "wrong")] }), []);
});

test("segments at sentence ends and actual caption times without covering silences", () => {
  const cues = [
    { start: 0, end: 5, text: "Opening words" },
    { start: 5, end: 10, text: "finish here." },
    { start: 10, end: 15, text: "The next thought" },
    { start: 15, end: 20, text: "continues here." },
    { start: 30, end: 40, text: "A separate passage." }
  ];
  const result = core.segmentCaptions(cues, 38);
  assert.deepEqual(result.map(({ start, end }) => [start, end]), [[0, 10], [10, 20], [30, 38]]);
  assert.equal(result[0].text, "Opening words finish here.");
  assert.deepEqual(result.map((item) => item.id), ["s0001", "s0002", "s0003"]);
});

test("unpunctuated captions have bounded cue-aligned windows", () => {
  const cues = Array.from({ length: 20 }, (_, index) => ({ start: index * 3, end: (index + 1) * 3, text: "a few words" }));
  const segments = core.segmentCaptions(cues, 60);
  assert.equal(segments.at(-1).end, 60);
  assert.ok(segments.every((item) => item.end - item.start <= 20 && item.start % 3 === 0 && item.end % 3 === 0));
  assert.equal(segments.map((item) => item.text).join(" "), cues.map((cue) => cue.text).join(" "));
});

test("invalid or live duration cannot create skip segments", () => {
  for (const duration of [Infinity, NaN, -1, 0, undefined]) assert.deepEqual(core.segmentCaptions([{ start: 0, end: 1, text: "words" }], duration), []);
});

test("request instructions contain segment IDs and conservative category rubrics", () => {
  const request = core.buildRequests("A normal product review", [segment()])[0];
  assert.equal(request.model, "jev-1.13.0");
  assert.match(request.questions.s0001.instructions, /s0001/);
  assert.match(request.questions.s0001.instructions, /mixed editorial\/promotion/);
  assert.deepEqual(Object.keys(request.questions.s0001.criteria), ["sponsor", "content", "uncertain"]);
  assert.equal(request.state.title, "A normal product review");
});

test("packs multibyte transcripts below both request context bounds", () => {
  const segments = Array.from({ length: 100 }, (_, index) => segment(`s${index + 1}`, index * 10, "話題についての説明。".repeat(30)));
  const requests = core.buildRequests("Caption budget", segments);
  assert.ok(requests.length > 1);
  assert.deepEqual(requests.flatMap((request) => request.state.segments.map((item) => item.id)), segments.map((item) => item.id));
  for (const request of requests) {
    assert.ok(core.byteLength(request) <= core.LIMITS.requestBytes);
    assert.ok(core.byteLength(request.state) + Math.max(...Object.values(request.questions).map(core.byteLength)) <= core.LIMITS.stateAndQuestionBytes);
    assert.ok(Object.keys(request.questions).length <= core.LIMITS.questionsPerRequest);
  }
});

test("rejects duplicate IDs, overlap, invalid times, huge titles and transcript text", () => {
  for (const segments of [[], [segment(), segment()], [segment(), segment("s2", 5)], [segment("__proto__")], [{ ...segment(), start: NaN }], [{ ...segment(), text: "x".repeat(8001) }], [{ ...segment(), end: 100 }]]) {
    assert.throws(() => core.buildRequests("Title", segments), /invalid-request/);
  }
  assert.throws(() => core.buildRequests("x".repeat(2001), [segment()]), /invalid-request/);
  assert.throws(() => core.buildRequests("Title", Array.from({ length: 601 }, (_, index) => segment(`s${index}`, index * 10))), /invalid-request/);
});

test("reads sponsor probability rather than confidence and returns only classification data", () => {
  const segments = [segment()];
  const result = core.parseAnswers(response(segments, 0.97), segments);
  assert.deepEqual(result, [{ id: "s0001", start: 0, end: 10, probability: 0.97, category: "sponsor" }]);
});

test("rejects missing, malformed or inconsistent classification probabilities", () => {
  const segments = [segment()];
  const variants = [
    { confidence: 1, choice: "sponsor", type: "choice" },
    { ...answer(), probabilities: { sponsor: "0.97", content: 0.03, uncertain: 0 } },
    { ...answer(), probabilities: { sponsor: NaN, content: 0.03, uncertain: 0 } },
    { ...answer(), probabilities: { sponsor: 1.1, content: -0.1, uncertain: 0 } },
    { ...answer(), probabilities: { sponsor: 0.1, content: 0.1, uncertain: 0.1 } },
    { ...answer(), probabilities: { sponsor: 0.1, content: 0.9, uncertain: 0 } },
    { ...answer(), choice: "advertisement" },
    { ...answer(), type: "noul" }
  ];
  for (const malformed of variants) assert.throws(() => core.parseAnswers({ model: core.MODEL, answers: { s0001: malformed } }, segments), /invalid-response/);
  for (const malformed of [{}, { model: "jev-latest", answers: { s0001: answer() } }, { model: core.MODEL, answers: {} }, { model: core.MODEL, answers: { s0001: answer(), unexpected: answer() } }]) assert.throws(() => core.parseAnswers(malformed, segments), /invalid-response/);
});

test("accepts content and uncertain distributions without inventing sponsor confidence", () => {
  const segments = [segment()];
  const result = core.parseAnswers({ model: core.MODEL, answers: { s0001: { type: "choice", choice: "uncertain", probabilities: { sponsor: 0.4, content: 0.1, uncertain: 0.5 }, confidence: 0.99 } } }, segments);
  assert.equal(result[0].probability, 0.4);
  assert.equal(result[0].category, "uncertain");
});
