(function initPopup(root) {
  "use strict";

  const DEFAULT_SETTINGS = {
    slowerKey: "s",
    defaultKey: "d",
    fasterKey: "f",
    skipKey: "e",
    rateStep: 0.1,
    defaultRate: 2,
    minRate: 0.1,
    maxRate: 9.9,
    autoApplyDefaultOnYouTube: true,
    autoSkipYouTubeAds: true,
    showHud: true
  };

  const extensionApi = root.browser || root.chrome;
  const form = root.document.getElementById("settings-form");
  const fields = {
    defaultRate: root.document.getElementById("defaultRate"),
    rateStep: root.document.getElementById("rateStep"),
    autoApplyDefaultOnYouTube: root.document.getElementById("autoApplyDefaultOnYouTube"),
    autoSkipYouTubeAds: root.document.getElementById("autoSkipYouTubeAds"),
    showHud: root.document.getElementById("showHud")
  };

  function getStoredSettings() {
    return new Promise((resolve) => {
      extensionApi.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        resolve({ ...DEFAULT_SETTINGS, ...stored });
      });
    });
  }

  function setStoredSettings(patch) {
    return new Promise((resolve) => {
      extensionApi.storage.local.set(patch, resolve);
    });
  }

  function sendToActiveTab(message) {
    return new Promise((resolve) => {
      extensionApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id === undefined || tab.id === null) {
          resolve(false);
          return;
        }

        extensionApi.tabs.sendMessage(tab.id, message, () => resolve(true));
      });
    });
  }

  function render(settings) {
    fields.defaultRate.value = Number(settings.defaultRate).toFixed(1);
    fields.rateStep.value = Number(settings.rateStep).toFixed(2);
    fields.autoApplyDefaultOnYouTube.checked = Boolean(settings.autoApplyDefaultOnYouTube);
    fields.autoSkipYouTubeAds.checked = Boolean(settings.autoSkipYouTubeAds);
    fields.showHud.checked = Boolean(settings.showHud);
  }

  function readFormPatch() {
    return {
      defaultRate: Number(fields.defaultRate.value),
      rateStep: Number(fields.rateStep.value),
      autoApplyDefaultOnYouTube: fields.autoApplyDefaultOnYouTube.checked,
      autoSkipYouTubeAds: fields.autoSkipYouTubeAds.checked,
      showHud: fields.showHud.checked
    };
  }

  form.addEventListener("input", () => {
    setStoredSettings(readFormPatch());
  });

  root.document.querySelector(".controls").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-command]");
    if (!button) {
      return;
    }

    const command = button.dataset.command;
    if (command === "slower") {
      sendToActiveTab({ type: "change-rate", delta: -Number(fields.rateStep.value || DEFAULT_SETTINGS.rateStep) });
    } else if (command === "default") {
      sendToActiveTab({ type: "apply-default" });
    } else if (command === "faster") {
      sendToActiveTab({ type: "change-rate", delta: Number(fields.rateStep.value || DEFAULT_SETTINGS.rateStep) });
    } else if (command === "skip") {
      sendToActiveTab({ type: "skip-ad" });
    }
  });

  getStoredSettings().then(render);
})(typeof globalThis !== "undefined" ? globalThis : window);
