const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const popupScript = fs.readFileSync(
  path.join(__dirname, "..", "web-extension", "popup.js"),
  "utf8"
);

test("renders saved popup settings and persists form changes", async () => {
  const popup = await createPopupWorld({ defaultRate: 2.5, rateStep: 0.25, showHud: false });

  assert.equal(popup.fields.defaultRate.value, "2.5");
  assert.equal(popup.fields.rateStep.value, "0.25");
  assert.equal(popup.fields.showHud.checked, false);

  popup.fields.defaultRate.value = "3.0";
  popup.fields.autoSkipYouTubeAds.checked = false;
  popup.form.dispatch("input");

  assert.deepEqual(popup.storageWrites.at(-1), {
    defaultRate: 3,
    rateStep: 0.25,
    autoApplyDefaultOnYouTube: true,
    autoSkipYouTubeAds: false,
    showHud: false
  });
});

test("sends every popup command to the active tab", async () => {
  const popup = await createPopupWorld({ rateStep: 0.2 });

  popup.clickCommand("slower");
  popup.clickCommand("default");
  popup.clickCommand("faster");
  popup.clickCommand("skip");

  assert.deepEqual(JSON.parse(JSON.stringify(popup.messages)), [
    { type: "change-rate", delta: -0.2 },
    { type: "apply-default" },
    { type: "change-rate", delta: 0.2 },
    { type: "skip-ad" }
  ]);
});

test("the sponsor toggle outside the form saves only its boolean setting on change", async () => {
  const popup = await createPopupWorld({}, { sponsors: true });
  const html = fs.readFileSync(path.join(__dirname, "../web-extension/popup.html"), "utf8");
  assert.ok(html.indexOf('id="skipSponsors"') > html.indexOf("</form>"));
  assert.equal(popup.fields.skipSponsors.checked, false);
  popup.fields.skipSponsors.checked = true;
  popup.fields.skipSponsors.dispatch("change");
  assert.deepEqual(popup.storageWrites, [{ skipSponsors: true }]);
  popup.fields.skipSponsors.checked = false;
  popup.fields.skipSponsors.dispatch("change");
  assert.deepEqual(popup.storageWrites.at(-1), { skipSponsors: false });
});

test("saving a masked API key uses native messaging, clears the field, and never stores the key in extension storage", async () => {
  const popup = await createPopupWorld({}, { sponsors: true, deferSave: true });
  const html = fs.readFileSync(path.join(__dirname, "../web-extension/popup.html"), "utf8");
  assert.match(html, /<input[^>]*id="typesafe-key"[^>]*type="password"[^>]*autocomplete="off"/);
  popup.fields["typesafe-key"].value = "  synthetic-typesafe-test-key  ";
  popup.fields["save-key"].dispatch("click");
  assert.equal(popup.fields["save-key"].disabled, true);
  assert.deepEqual(popup.nativeMessages.at(-1), {
    appId: "com.tristdrum.VideoFlowKeys",
    message: { type: "typesafe:save-key", key: "synthetic-typesafe-test-key" }
  });
  popup.finishSave({ ok: true });
  await flush();
  assert.equal(popup.fields["typesafe-key"].value, "");
  assert.equal(popup.fields["save-key"].disabled, false);
  assert.equal(popup.fields["remove-key"].disabled, false);
  assert.equal(popup.fields["key-status"].textContent, "Key saved securely on this Mac.");
  assert.equal(popup.fields.skipSponsors.checked, false);
  assert.deepEqual(popup.storageWrites, []);
  assert.ok(popup.messages.some((message) => message.type === "sponsor:retry"));
  assert.equal(JSON.stringify(popup.messages).includes("synthetic-typesafe-test-key"), false);
  assert.equal(JSON.stringify(popup.storageWrites).includes("synthetic-typesafe-test-key"), false);
});

test("blank API keys never reach native messaging", async () => {
  const popup = await createPopupWorld({}, { sponsors: true });
  popup.fields["typesafe-key"].value = "   ";
  popup.fields["save-key"].dispatch("click");
  await flush();
  assert.deepEqual(popup.nativeMessages.map((entry) => entry.message.type), ["typesafe:key-status"]);
  assert.equal(popup.fields["key-status"].textContent, "Enter your TypeSafe API key.");
  assert.deepEqual(popup.storageWrites, []);
});

test("removing a saved key clears the field and disables sponsor analysis", async () => {
  const popup = await createPopupWorld({ skipSponsors: true }, { sponsors: true, configured: true });
  popup.fields["typesafe-key"].value = "synthetic-unsaved-key";
  popup.fields["remove-key"].dispatch("click");
  await flush();
  assert.deepEqual(popup.nativeMessages.at(-1), { appId: "com.tristdrum.VideoFlowKeys", message: { type: "typesafe:remove-key" } });
  assert.deepEqual(popup.storageWrites, [{ skipSponsors: false }]);
  assert.equal(popup.fields.skipSponsors.checked, false);
  assert.equal(popup.fields["typesafe-key"].value, "");
  assert.equal(popup.fields["remove-key"].disabled, true);
  assert.equal(popup.fields["key-status"].textContent, "Key removed. Sponsor analysis is off.");
});

test("native key failures are sanitized and a failed removal preserves the enabled state", async () => {
  for (const nativeFailure of ["response", "runtime-error", "throw"]) {
    const popup = await createPopupWorld({}, { sponsors: true, nativeFailure });
    popup.fields["typesafe-key"].value = "synthetic-typesafe-test-key";
    popup.fields["save-key"].dispatch("click");
    await flush();
    assert.equal(popup.fields["typesafe-key"].value, "");
    assert.equal(popup.fields["key-status"].textContent, "Could not save the key. Check the app installation.");
    assert.equal(popup.fields["save-key"].disabled, false);
    assert.deepEqual(popup.storageWrites, []);
    assert.equal(popup.messages.some((message) => message.type === "sponsor:retry"), false);
  }
  const popup = await createPopupWorld({ skipSponsors: true }, { sponsors: true, configured: true, nativeFailure: "response" });
  popup.fields["remove-key"].dispatch("click");
  await flush();
  assert.equal(popup.fields.skipSponsors.checked, true);
  assert.deepEqual(popup.storageWrites, []);
  assert.equal(popup.fields["key-status"].textContent, "Could not remove the key.");
});

test("key status displays presence only and analysis diagnostics use fixed user-facing messages", async () => {
  const popup = await createPopupWorld({}, {
    sponsors: true, configured: true,
    nativeStatus: { ok: true, configured: true, key: "synthetic-never-display-key" },
    analysis: { status: "authentication", details: "synthetic-private-native-detail", canUndo: false }
  });
  assert.equal(popup.fields["typesafe-key"].value, "");
  assert.equal(popup.fields["key-status"].textContent, "Key saved securely on this Mac.");
  assert.equal(popup.fields["analysis-status"].textContent, "TypeSafe rejected the key. Replace it and try again.");
  assert.equal(popup.fields["undo-sponsor"].disabled, true);
  assert.equal(JSON.stringify(popup.storageWrites).includes("synthetic-never-display-key"), false);
  popup.setAnalysis({ status: "synthetic-private-native-detail", canUndo: false });
  popup.poll();
  await flush();
  assert.equal(popup.fields["analysis-status"].textContent, "Sponsor analysis needs Safari 18+ and a YouTube watch page.");
});

test("ready sponsor status enables undo and reports only the segment count", async () => {
  const popup = await createPopupWorld({}, { sponsors: true, analysis: { status: "ready", count: 2, canUndo: true } });
  assert.equal(popup.fields["analysis-status"].textContent, "2 likely sponsor segments marked in amber.");
  assert.equal(popup.fields["undo-sponsor"].disabled, false);
  popup.fields["undo-sponsor"].dispatch("click");
  await flush();
  assert.ok(popup.messages.some((message) => message.type === "sponsor:undo"));
  popup.setAnalysis({ status: "ready", count: 0, canUndo: false });
  popup.poll();
  await flush();
  assert.equal(popup.fields["analysis-status"].textContent, "No confident sponsor segments found.");
  assert.equal(popup.fields["undo-sponsor"].disabled, true);
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function createPopupWorld(storedSettings = {}, options = {}) {
  const storageWrites = [];
  const messages = [];
  const nativeMessages = [];
  const intervals = [];
  let deferredSave;
  let analysis = options.analysis || { status: "disabled", canUndo: false };
  const form = fakeEventTarget();
  const controls = fakeEventTarget();
  const fields = {
    defaultRate: { value: "" },
    rateStep: { value: "" },
    autoApplyDefaultOnYouTube: { checked: false },
    autoSkipYouTubeAds: { checked: false },
    showHud: { checked: false }
  };
  if (options.sponsors) {
    for (const id of ["skipSponsors", "typesafe-key", "key-status", "analysis-status", "save-key", "remove-key", "undo-sponsor", "retry-analysis"]) {
      fields[id] = { ...fakeEventTarget(), value: "", textContent: "", checked: false, disabled: false };
    }
  }

  const context = {
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    document: {
      getElementById(id) {
        if (id === "settings-form") return form;
        return fields[id];
      },
      querySelector(selector) {
        return selector === ".controls" ? controls : null;
      }
    },
    browser: {
      runtime: {
        sendNativeMessage(appId, message, callback) {
          nativeMessages.push(JSON.parse(JSON.stringify({ appId, message })));
          if (message.type === "typesafe:key-status") {
            callback(options.nativeStatus || { ok: true, configured: options.configured === true });
          } else if (message.type === "typesafe:save-key" && options.deferSave) deferredSave = callback;
          else if (options.nativeFailure === "throw") throw new Error("synthetic-private-native-detail");
          else if (options.nativeFailure === "runtime-error") {
            context.browser.runtime.lastError = { message: "synthetic-private-native-detail" };
            callback();
            delete context.browser.runtime.lastError;
          } else callback(options.nativeFailure === "response" ? { ok: false, error: "synthetic-private-native-detail" } : { ok: true });
        }
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ ...defaults, ...storedSettings });
          },
          set(patch, callback) {
            storageWrites.push({ ...patch });
            callback();
          }
        }
      },
      tabs: {
        query(query, callback) {
          callback([{ id: 0 }]);
        },
        sendMessage(tabId, message, callback) {
          assert.equal(tabId, 0);
          messages.push(message);
          callback(message.type === "sponsor:status" ? analysis : undefined);
        }
      }
    }
  };
  context.globalThis = context;
  context.window = context;

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "web-extension", "settings.js"), "utf8"), context);
  vm.runInNewContext(popupScript, context, { filename: "popup.js" });
  await flush();

  return {
    fields,
    form,
    storageWrites,
    messages,
    nativeMessages,
    finishSave(response) { deferredSave(response); },
    setAnalysis(value) { analysis = value; },
    poll() { intervals.forEach((callback) => callback()); },
    clickCommand(command) {
      controls.dispatch("click", {
        target: {
          closest(selector) {
            return selector === "button[data-command]" ? { dataset: { command } } : null;
          }
        }
      });
    }
  };
}

function fakeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    }
  };
}
