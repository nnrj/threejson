import assert from "node:assert/strict";
import { test } from "node:test";

import { applyAssetsBaseForLoad } from "../core/util/assetsBase.js";
import {
  isIntroEnabled,
  isIntroExcludedFromLoadWait,
  normalizeIntroConfig,
  resolveIntroMountRoot
} from "../core/runtime/sceneIntroConfig.js";
import {
  runPostLoadIntro,
  runScenePostLoadIntroIfConfigured
} from "../core/runtime/sceneIntroOverlay.js";

test("normalizeIntroConfig accepts postLoad slides and defaults blockInteraction true", () => {
  const intro = normalizeIntroConfig({
    enabled: true,
    backgroundColor: "#101820",
    postLoad: {
      slides: [
        { type: "text", content: "Hello", durationMs: 100 },
        { type: "image", url: "/assets/img/ThreeJSON.png", durationMs: 200 }
      ],
      skipOnClick: false
    }
  });
  assert.ok(intro);
  assert.equal(intro.backgroundColor, "#101820");
  assert.equal(intro.postLoad.slides.length, 2);
  assert.equal(intro.postLoad.blockInteraction, true);
  assert.equal(intro.postLoad.excludeFromLoadWait, false);
  assert.equal(intro.postLoad.skipOnClick, false);
});

test("excludeFromLoadWait true defaults blockInteraction false when omitted", () => {
  const intro = normalizeIntroConfig({
    enabled: true,
    postLoad: {
      slides: [{ type: "text", content: "Credit", durationMs: 100 }],
      excludeFromLoadWait: true
    }
  });
  assert.ok(intro);
  assert.equal(intro.postLoad.blockInteraction, false);
  assert.equal(intro.postLoad.excludeFromLoadWait, true);
});

test("excludeFromLoadWait true still respects explicit blockInteraction true", () => {
  const intro = normalizeIntroConfig({
    enabled: true,
    postLoad: {
      slides: [{ type: "text", content: "Credit", durationMs: 100 }],
      excludeFromLoadWait: true,
      blockInteraction: true
    }
  });
  assert.ok(intro);
  assert.equal(intro.postLoad.blockInteraction, true);
});

test("normalizeIntroConfig accepts excludeFromLoadWait and blockInteraction false", () => {
  const intro = normalizeIntroConfig({
    enabled: true,
    postLoad: {
      slides: [{ type: "text", content: "Credit", durationMs: 100 }],
      blockInteraction: false,
      excludeFromLoadWait: true
    }
  });
  assert.ok(intro);
  assert.equal(intro.postLoad.blockInteraction, false);
  assert.equal(intro.postLoad.excludeFromLoadWait, true);
  assert.equal(isIntroExcludedFromLoadWait(intro), true);
});

test("normalizeIntroConfig returns null when disabled or no valid slides", () => {
  assert.equal(normalizeIntroConfig({ enabled: false }), null);
  assert.equal(normalizeIntroConfig({ enabled: true, postLoad: { slides: [] } }), null);
  assert.equal(
    normalizeIntroConfig({
      enabled: true,
      postLoad: { slides: [{ type: "text", content: "", durationMs: 100 }] }
    }),
    null
  );
});

test("isIntroEnabled reflects normalized config", () => {
  const intro = normalizeIntroConfig({
    enabled: true,
    postLoad: {
      slides: [{ type: "text", content: "Go", durationMs: 50 }]
    }
  });
  assert.equal(isIntroEnabled(intro), true);
  assert.equal(isIntroEnabled(null), false);
});

test("resolveIntroMountRoot prefers introRoot then canvas parent", () => {
  const root = { nodeType: 1 };
  const canvas = { parentElement: { nodeType: 1, tag: "parent" } };
  assert.equal(resolveIntroMountRoot({ introRoot: root }), root);
  assert.equal(resolveIntroMountRoot({ canvas }), canvas.parentElement);
  assert.equal(resolveIntroMountRoot({}), null);
});

test("runPostLoadIntro with blockInteraction false uses pointer-events none on overlay", async () => {
  const priorDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        className: "",
        children: [],
        parentElement: null,
        replaceChildren() {
          this.children = [];
        },
        appendChild(child) {
          child.parentElement = this;
          this.children.push(child);
        },
        remove() {
          if (this.parentElement?.children) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx >= 0) {
              this.parentElement.children.splice(idx, 1);
            }
          }
          this.parentElement = null;
        },
        addEventListener() {},
        setAttribute() {}
      };
      return el;
    }
  };
  globalThis.getComputedStyle = () => ({ position: "static" });

  try {
    const host = document.createElement("div");
    const intro = normalizeIntroConfig({
      enabled: true,
      postLoad: {
        slides: [{ type: "text", content: "Credit", durationMs: 5000 }],
        blockInteraction: false,
        skipOnClick: true,
        fadeInMs: 0,
        fadeOutMs: 0
      }
    });
    void runPostLoadIntro(intro, host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(host.children.length, 1);
    const overlay = host.children[0];
    assert.equal(overlay.style.pointerEvents, "none");
    assert.equal(overlay.children[0].style.pointerEvents, "auto");
  } finally {
    globalThis.document = priorDocument;
    delete globalThis.getComputedStyle;
  }
});

test("runPostLoadIntro resolves /assets image slides through active assetsBase", async () => {
  const priorDocument = globalThis.document;
  const priorImage = globalThis.Image;
  const preloadedUrls = [];

  globalThis.document = {
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        className: "",
        children: [],
        parentElement: null,
        _src: "",
        set src(value) {
          this._src = value;
        },
        get src() {
          return this._src;
        },
        replaceChildren() {
          this.children = [];
        },
        appendChild(child) {
          child.parentElement = this;
          this.children.push(child);
        },
        remove() {
          if (this.parentElement?.children) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx >= 0) {
              this.parentElement.children.splice(idx, 1);
            }
          }
          this.parentElement = null;
        },
        addEventListener() {},
        setAttribute() {}
      };
      return el;
    }
  };
  globalThis.Image = class {
    set src(value) {
      preloadedUrls.push(value);
      queueMicrotask(() => this.onload?.());
    }
  };
  globalThis.getComputedStyle = () => ({ position: "static" });
  const restoreAssetsBase = applyAssetsBaseForLoad({}, { assetsBase: "../../../assets" });

  try {
    const host = document.createElement("div");
    const intro = normalizeIntroConfig({
      enabled: true,
      postLoad: {
        slides: [{ type: "image", url: "/assets/img/ThreeJSON.png", durationMs: 1 }],
        fadeInMs: 0,
        fadeOutMs: 0,
        skipOnClick: false
      }
    });
    await runPostLoadIntro(intro, host);
    assert.deepEqual(preloadedUrls, ["../../../assets/img/ThreeJSON.png"]);
  } finally {
    restoreAssetsBase();
    globalThis.document = priorDocument;
    globalThis.Image = priorImage;
    delete globalThis.getComputedStyle;
  }
});
test("runPostLoadIntro shows text slide then removes overlay", async () => {
  const priorDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        className: "",
        children: [],
        parentElement: null,
        replaceChildren() {
          this.children = [];
        },
        replaceChildren() {
          this.children = [];
        },
        appendChild(child) {
          child.parentElement = this;
          this.children.push(child);
        },
        remove() {
          if (this.parentElement?.children) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx >= 0) {
              this.parentElement.children.splice(idx, 1);
            }
          }
          this.parentElement = null;
        },
        addEventListener() {},
        setAttribute() {}
      };
      return el;
    }
  };
  globalThis.Image = class {
    set src(_value) {
      queueMicrotask(() => this.onload?.());
    }
  };
  globalThis.getComputedStyle = () => ({ position: "static" });

  try {
    const host = document.createElement("div");
    const intro = normalizeIntroConfig({
      enabled: true,
      postLoad: {
        slides: [{ type: "text", content: "Intro", durationMs: 10 }],
        fadeInMs: 0,
        fadeOutMs: 0,
        skipOnClick: false
      }
    });
    await runPostLoadIntro(intro, host);
    assert.equal(host.children.length, 0);
  } finally {
    globalThis.document = priorDocument;
    delete globalThis.Image;
    delete globalThis.getComputedStyle;
  }
});
