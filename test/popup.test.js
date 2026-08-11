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

async function createPopupWorld(storedSettings = {}) {
  const storageWrites = [];
  const messages = [];
  const form = fakeEventTarget();
  const controls = fakeEventTarget();
  const fields = {
    defaultRate: { value: "" },
    rateStep: { value: "" },
    autoApplyDefaultOnYouTube: { checked: false },
    autoSkipYouTubeAds: { checked: false },
    showHud: { checked: false }
  };

  const context = {
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
          callback();
        }
      }
    }
  };
  context.globalThis = context;
  context.window = context;

  vm.runInNewContext(popupScript, context, { filename: "popup.js" });
  await new Promise((resolve) => setImmediate(resolve));

  return {
    fields,
    form,
    storageWrites,
    messages,
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
