const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const contentScript = fs.readFileSync(
  path.join(__dirname, "..", "web-extension", "content.js"),
  "utf8"
);

test("applies the 2x YouTube default and handles S, D, and F shortcuts", async () => {
  const browser = await createBrowserWorld();

  assert.equal(browser.video.playbackRate, 2);

  const faster = browser.keydown("f");
  assert.equal(browser.video.playbackRate, 2.1);
  assert.equal(faster.prevented, true);
  assert.equal(faster.stopped, true);
  assert.equal(browser.hud().textContent, "2.1x");

  browser.keydown("s");
  assert.equal(browser.video.playbackRate, 2);

  browser.keydown("d");
  assert.equal(browser.video.playbackRate, 1);
  assert.equal(browser.hud().textContent, "1x");
});

test("does not steal shortcuts from editable fields or modified key presses", async () => {
  const browser = await createBrowserWorld();

  const editable = browser.keydown("f", { target: { tagName: "INPUT" } });
  assert.equal(browser.video.playbackRate, 2);
  assert.equal(editable.prevented, false);

  const modified = browser.keydown("f", { metaKey: true });
  assert.equal(browser.video.playbackRate, 2);
  assert.equal(modified.prevented, false);
});

test("controls generic HTML video without forcing the YouTube default", async () => {
  const browser = await createBrowserWorld({ hostname: "example.com" });

  assert.equal(browser.video.playbackRate, 1);
  browser.keydown("f");
  assert.equal(browser.video.playbackRate, 1.1);
  browser.keydown("s");
  assert.equal(browser.video.playbackRate, 1);
});

test("controls a Red Bull video inside an open shadow root", async () => {
  const browser = await createBrowserWorld({
    hostname: "www.redbull.tv",
    videoInShadowRoot: true
  });

  assert.equal(browser.video.playbackRate, 1);

  const faster = browser.keydown("f");
  assert.equal(browser.video.playbackRate, 1.1);
  assert.equal(faster.prevented, true);
  assert.equal(faster.stopped, true);

  browser.keydown("d");
  assert.equal(browser.video.playbackRate, 1);
});

test("relays Red Bull player-frame shortcuts to the parent page", async () => {
  const frame = await createBrowserWorld({
    hostname: "redbull.studio.easelive.tv",
    isEmbedded: true,
    noVideo: true
  });

  const faster = frame.keydown("f");
  assert.equal(faster.prevented, true);
  assert.equal(faster.stopped, true);
  assert.equal(frame.postedMessages.length, 1);
  assert.equal(frame.postedMessages[0].message.type, "video-flow-keys:shortcut");
  assert.equal(frame.postedMessages[0].message.action, "faster");
  assert.equal(frame.postedMessages[0].targetOrigin, "*");
});

test("applies relayed Red Bull shortcuts to the shadow-root video", async () => {
  const browser = await createBrowserWorld({
    hostname: "www.redbull.tv",
    videoInShadowRoot: true
  });

  browser.dispatchMessage({
    type: "video-flow-keys:shortcut",
    action: "faster"
  }, "https://redbull.studio.easelive.tv");

  assert.equal(browser.video.playbackRate, 1.1);
  assert.equal(browser.hud().textContent, "1.1x");
});

test("keeps auto-bypass disabled until E is pressed", async () => {
  const browser = await createBrowserWorld({
    adShowing: true,
    storedSettings: { autoSkipYouTubeAds: false }
  });

  assert.equal(browser.video.playbackRate, 1);
  assert.equal(browser.video.currentTime, 0);
  assert.equal(browser.skipButton.clickCount, 0);

  const skip = browser.keydown("e");
  assert.equal(skip.prevented, true);
  assert.equal(browser.video.playbackRate, 1);
  assert.equal(browser.video.currentTime, 0);
  assert.equal(browser.video.muted, false);
  assert.equal(browser.skipButton.clickCount, 1);
  assert.equal(browser.hud().textContent, "Skipping ad");
});

test("auto-bypasses a YouTube ad and restores the content rate and mute state", async () => {
  const browser = await createBrowserWorld({ skipButtonVisible: false });

  browser.keydown("s");
  browser.keydown("s");
  assert.equal(browser.video.playbackRate, 1.8);

  browser.setAdShowing(true);
  browser.runInterval(250);
  assert.equal(browser.video.playbackRate, 16);
  assert.equal(browser.video.currentTime, 99.95);
  assert.equal(browser.video.muted, true);
  assert.equal(browser.skipButton.clickCount, 0);
  assert.ok(browser.adBypassStyle());

  browser.setAdShowing(false);
  browser.runInterval(250);
  assert.equal(browser.video.playbackRate, 1.8);
  assert.equal(browser.video.muted, false);
  assert.equal(browser.adBypassStyle(), null);
});

test("does not seek content when YouTube swaps media after a skip click", async () => {
  const browser = await createBrowserWorld({ adShowing: true });

  assert.equal(browser.skipButton.clickCount, 1);
  assert.equal(browser.video.currentTime, 0);
  assert.equal(browser.video.playbackRate, 1);

  browser.video.currentSrc = "https://example.com/content.mp4";
  browser.video.duration = 300;
  browser.runInterval(250);

  assert.equal(browser.video.currentTime, 0);
  assert.equal(browser.video.playbackRate, 2);
  assert.equal(browser.video.muted, false);
  assert.equal(browser.adBypassStyle(), null);
});

test("reports no ad without suppressing the page key when E has nothing to bypass", async () => {
  const browser = await createBrowserWorld();
  const skip = browser.keydown("e");

  assert.equal(skip.prevented, false);
  assert.equal(skip.stopped, false);
  assert.equal(browser.hud().textContent, "No ad");
});

async function createBrowserWorld(options = {}) {
  let adShowing = Boolean(options.adShowing);
  const skipButtonVisible = options.skipButtonVisible !== false;
  let nextTimerId = 1;
  const listeners = new Map();
  const windowListeners = new Map();
  const intervals = new Map();
  const elementsById = new Map();
  const postedMessages = [];

  const video = {
    tagName: "VIDEO",
    paused: false,
    ended: false,
    duration: 100,
    currentTime: 0,
    currentSrc: "https://example.com/video.mp4",
    playbackRate: 1,
    defaultPlaybackRate: 1,
    muted: false,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, bottom: 720, width: 1280, height: 720 };
    }
  };

  const skipButton = fakeButton("ytp-skip-ad-button", "Skip ad");
  const closeButton = fakeButton("ytp-ad-overlay-close-button", "Close");
  const videoHost = {
    tagName: "RBUP-VIDEO-TV-STREAMING",
    shadowRoot: {
      querySelectorAll(selector) {
        return selector === "video" || selector === "*" ? [video] : [];
      }
    }
  };
  const player = {
    classList: {
      contains(name) {
        return name === "ad-showing" && adShowing;
      }
    },
    selectedRate: null,
    playCalls: 0,
    getAvailablePlaybackRates() {
      return [0.25, 0.5, 1, 1.5, 2];
    },
    setPlaybackRate(rate) {
      this.selectedRate = rate;
    },
    playVideo() {
      this.playCalls += 1;
    }
  };

  const body = fakeContainer("BODY");
  const documentElement = fakeContainer("HTML");
  const document = {
    body,
    documentElement,
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    createElement(tagName) {
      const element = fakeContainer(String(tagName).toUpperCase());
      const originalRemove = element.remove;
      element.remove = () => {
        originalRemove();
        if (element.id) {
          elementsById.delete(element.id);
        }
      };
      return element;
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelector(selector) {
      if (selector === "#movie_player, .html5-video-player") {
        return player;
      }
      if (selector === ".html5-video-player.ad-showing") {
        return adShowing ? player : null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "video") {
        return options.videoInShadowRoot || options.noVideo ? [] : [video];
      }
      if (selector === "*") {
        return options.videoInShadowRoot ? [videoHost] : [];
      }
      if (selector === ".ytp-ad-overlay-close-button") {
        return adShowing ? [closeButton] : [];
      }
      if (selector.includes("skip") || selector.includes("Skip")) {
        return adShowing && skipButtonVisible ? [skipButton] : [];
      }
      return [];
    }
  };

  for (const container of [body, documentElement]) {
    const originalAppend = container.appendChild;
    container.appendChild = (element) => {
      originalAppend.call(container, element);
      if (element.id) {
        elementsById.set(element.id, element);
      }
      if (element.attributes && element.attributes["data-video-flow-keys-hud"]) {
        elementsById.set("video-flow-keys-hud", element);
      }
      return element;
    };
  }

  const storedSettings = { ...(options.storedSettings || {}) };
  const storageListeners = [];
  const context = {
    URL,
    document,
    addEventListener(type, listener) {
      const registered = windowListeners.get(type) || [];
      registered.push(listener);
      windowListeners.set(type, registered);
    },
    location: {
      href: `https://${options.hostname || "www.youtube.com"}/watch?v=test`,
      hostname: options.hostname || "www.youtube.com"
    },
    browser: {
      storage: {
        local: {
          get(defaults, callback) {
            callback({ ...defaults, ...storedSettings });
          }
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          }
        }
      },
      runtime: {
        onMessage: { addListener() {} }
      }
    },
    MutationObserver: class MutationObserver {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
    },
    MouseEvent: class MouseEvent {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    },
    setInterval(callback, milliseconds) {
      const id = nextTimerId++;
      intervals.set(id, { callback, milliseconds });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(callback) {
      const id = nextTimerId++;
      intervals.set(id, { callback, milliseconds: "timeout" });
      return id;
    },
    clearTimeout(id) {
      intervals.delete(id);
    }
  };
  context.parent = options.isEmbedded ? {
    postMessage(message, targetOrigin) {
      postedMessages.push({ message, targetOrigin });
    }
  } : context;
  context.globalThis = context;
  context.window = context;

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "web-extension", "settings.js"), "utf8"), context);
  vm.runInNewContext(contentScript, context, { filename: "content.js" });
  await new Promise((resolve) => setImmediate(resolve));

  return {
    video,
    skipButton,
    closeButton,
    postedMessages,
    setAdShowing(value) {
      adShowing = Boolean(value);
    },
    runInterval(milliseconds) {
      for (const timer of intervals.values()) {
        if (timer.milliseconds === milliseconds) {
          timer.callback();
        }
      }
    },
    keydown(key, overrides = {}) {
      const state = { prevented: false, stopped: false };
      const event = {
        key,
        target: document.body,
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        preventDefault() {
          state.prevented = true;
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
          state.stopped = true;
        },
        ...overrides
      };
      for (const listener of listeners.get("keydown") || []) {
        listener(event);
      }
      return state;
    },
    dispatchMessage(data, origin) {
      for (const listener of windowListeners.get("message") || []) {
        listener({ data, origin });
      }
    },
    hud() {
      return elementsById.get("video-flow-keys-hud") || null;
    },
    adBypassStyle() {
      return elementsById.get("video-flow-keys-ad-bypass-style") || null;
    }
  };
}

function fakeContainer(tagName) {
  return {
    tagName,
    id: "",
    textContent: "",
    style: {},
    attributes: {},
    children: [],
    removed: false,
    appendChild(element) {
      this.children.push(element);
      element.parentElement = this;
      return element;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    remove() {
      this.removed = true;
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      }
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, bottom: 100, width: 100, height: 100 };
    }
  };
}

function fakeButton(className, ariaLabel) {
  return {
    className,
    innerText: ariaLabel,
    textContent: ariaLabel,
    disabled: false,
    clickCount: 0,
    dispatchedEvents: [],
    getAttribute(name) {
      if (name === "aria-label") return ariaLabel;
      if (name === "aria-disabled") return "false";
      return "";
    },
    getBoundingClientRect() {
      return { width: 100, height: 40 };
    },
    dispatchEvent(event) {
      this.dispatchedEvents.push(event.type);
    },
    click() {
      this.clickCount += 1;
    }
  };
}
