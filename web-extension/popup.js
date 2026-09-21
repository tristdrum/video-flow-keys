(function initPopup(root) {
  "use strict";

  const { DEFAULT_SETTINGS, normalizeSettings } = root.VideoFlowSettings;

  const extensionApi = root.browser || root.chrome;
  const form = root.document.getElementById("settings-form");
  const fields = {
    defaultRate: root.document.getElementById("defaultRate"),
    rateStep: root.document.getElementById("rateStep"),
    autoApplyDefaultOnYouTube: root.document.getElementById("autoApplyDefaultOnYouTube"),
    autoSkipYouTubeAds: root.document.getElementById("autoSkipYouTubeAds"),
    showHud: root.document.getElementById("showHud"),
    skipSponsors: root.document.getElementById("skipSponsors")
  };

  function getStoredSettings() {
    return new Promise((resolve) => {
      extensionApi.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        resolve(normalizeSettings(stored));
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

        extensionApi.tabs.sendMessage(tab.id, message, (response) => {
          if (extensionApi.runtime && extensionApi.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      });
    });
  }

  function render(settings) {
    fields.defaultRate.value = Number(settings.defaultRate).toFixed(1);
    fields.rateStep.value = Number(settings.rateStep).toFixed(2);
    fields.autoApplyDefaultOnYouTube.checked = Boolean(settings.autoApplyDefaultOnYouTube);
    fields.autoSkipYouTubeAds.checked = Boolean(settings.autoSkipYouTubeAds);
    fields.showHud.checked = Boolean(settings.showHud);
    if (fields.skipSponsors) fields.skipSponsors.checked = settings.skipSponsors;
  }

  function readFormPatch() {
    const patch = {
      defaultRate: Number(fields.defaultRate.value),
      rateStep: Number(fields.rateStep.value),
      autoApplyDefaultOnYouTube: fields.autoApplyDefaultOnYouTube.checked,
      autoSkipYouTubeAds: fields.autoSkipYouTubeAds.checked,
      showHud: fields.showHud.checked
    };
    if (fields.skipSponsors) patch.skipSponsors = fields.skipSponsors.checked;
    return patch;
  }

  form.addEventListener("input", () => {
    setStoredSettings(readFormPatch());
  });
  if (fields.skipSponsors) fields.skipSponsors.addEventListener("change", () => {
    setStoredSettings({ skipSponsors: fields.skipSponsors.checked });
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

  const keyField = root.document.getElementById("typesafe-key");
  const keyStatus = root.document.getElementById("key-status");
  const analysisStatus = root.document.getElementById("analysis-status");
  const saveButton = root.document.getElementById("save-key");
  const removeButton = root.document.getElementById("remove-key");
  const undoButton = root.document.getElementById("undo-sponsor");
  const retryButton = root.document.getElementById("retry-analysis");
  const statuses = {
    disabled: "Sponsor analysis is off.", "unsupported-page": "Open a YouTube video to analyze sponsors.",
    "reading-captions": "Reading captions…", analyzing: "Looking for sponsors…",
    "captions-unavailable": "Captions unavailable. Playback is unchanged.", live: "Live streams are not analyzed.",
    "key-unavailable": "Save a TypeSafe key to analyze sponsors.", authentication: "TypeSafe rejected the key. Replace it and try again.",
    "rate-limited": "TypeSafe is busy. Try again later.", timeout: "Analysis timed out. Playback is unchanged.",
    "invalid-response": "Analysis could not be verified. Playback is unchanged.",
    "request-too-large": "This caption track is too large to analyze.", unavailable: "Analysis unavailable. Playback is unchanged."
  };
  function native(message) {
    return new Promise((resolve) => {
      try {
        extensionApi.runtime.sendNativeMessage("com.tristdrum.VideoFlowKeys", message, (response) => {
          if (extensionApi.runtime.lastError) resolve({ ok: false });
          else resolve(response || { ok: false });
        });
      } catch (_) { resolve({ ok: false }); }
    });
  }
  async function refreshStatus() {
    if (!analysisStatus) return;
    const response = await sendToActiveTab({ type: "sponsor:status" });
    analysisStatus.textContent = response?.status === "ready" ?
      (response.count ? `${response.count} likely sponsor segment${response.count === 1 ? "" : "s"} marked in amber.` : "No confident sponsor segments found.") :
      statuses[response?.status] || "Sponsor analysis needs Safari 18+ and a YouTube watch page.";
    if (undoButton) undoButton.disabled = !response?.canUndo;
  }
  if (keyField && saveButton && removeButton) {
    void native({ type: "typesafe:key-status" }).then((response) => {
      keyStatus.textContent = response.ok ? (response.configured ? "Key saved securely on this Mac." : "No key saved.") : "Open the signed Video Flow Keys app to connect.";
      removeButton.disabled = !response.configured;
    });
    saveButton.addEventListener("click", async () => {
      const key = keyField.value.trim();
      if (!key) { keyStatus.textContent = "Enter your TypeSafe API key."; return; }
      saveButton.disabled = true;
      const response = await native({ type: "typesafe:save-key", key });
      keyField.value = "";
      saveButton.disabled = false;
      keyStatus.textContent = response.ok ? "Key saved securely on this Mac." : "Could not save the key. Check the app installation.";
      removeButton.disabled = !response.ok;
      if (response.ok) await sendToActiveTab({ type: "sponsor:retry" });
      void refreshStatus();
    });
    removeButton.addEventListener("click", async () => {
      const response = await native({ type: "typesafe:remove-key" });
      if (response.ok) {
        keyField.value = "";
        removeButton.disabled = true;
        fields.skipSponsors.checked = false;
        await setStoredSettings({ skipSponsors: false });
      }
      keyStatus.textContent = response.ok ? "Key removed. Sponsor analysis is off." : "Could not remove the key.";
      void refreshStatus();
    });
  }
  if (undoButton) undoButton.addEventListener("click", async () => { await sendToActiveTab({ type: "sponsor:undo" }); void refreshStatus(); });
  if (retryButton) retryButton.addEventListener("click", async () => { await sendToActiveTab({ type: "sponsor:retry" }); void refreshStatus(); });
  if (analysisStatus) { void refreshStatus(); root.setInterval(refreshStatus, 1000); }
})(typeof globalThis !== "undefined" ? globalThis : window);
