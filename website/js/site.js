const ROOT = new URL("../../", import.meta.url);
const READER = new URL("../../tools/reader/reader.html", import.meta.url);
const MANIFEST_URL = new URL("../../assets/json/demo-show/manifest.json", import.meta.url);
const PLACEHOLDER_IMG = new URL("../../assets/img/ThreeJSON.png", import.meta.url).href;
const STORAGE = {
  lang: "threejson.site.lang",
  theme: "threejson.site.theme"
};

const THUMB_CACHE_KEY = "threejson.examples.thumbCache.v1";
const THUMB_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 300;
const THUMB_LOAD_TIMEOUT_MS = 8000;
const AUTO_THUMB_CACHE_STORAGE_KEY = "threejson.examples.autoThumbCache";

let thumbObserver = null;
let thumbCanvas = null;
let thumbQueue = [];
let thumbQueueRunning = false;
let thumbCoreModulePromise = null;
let sectionScrollObserver = null;

const I18N = {
  "zh-CN": {
    "nav.home": "首页",
    "nav.docs": "文档",
    "nav.download": "下载",
    "nav.examples": "示例",
    "nav.tools": "工具",
    "nav.community": "社区",
    "docs.index": "索引",
    "docs.features": "特性",
    "docs.manual": "使用手册",
    "docs.api": "API",
    "docs.jsonConfig": "JSON 配置",
    "docs.changelog": "版本记录",
    "docs.faq": "常见问题",
    "download.download": "下载 ThreeJSON",
    "download.scenes": "下载模板",
    "tools.editor": "场景编辑器",
    "tools.player": "场景播放器",
    "tools.glossary": "术语手册",
    "tools.more": "案例展示",
    "community.contributors": "贡献者列表",
    "community.mail": "邮件列表",
    "community.contribute": "如何贡献",
    "community.dependencies": "依赖项",
    "community.codeStyle": "代码规范",
    "community.source": "源码（GitHub）",
    "community.issues": "Issues（GitHub）",
    "theme.label": "主题",
    "theme.auto": "自动",
    "theme.light": "浅色",
    "theme.dark": "深色",
    "lang.label": "语言",
    "lang.auto": "自动",
    "lang.zh": "简体中文",
    "lang.en": "English",
    "home.desc": "ThreeJSON 将 Three.js 场景表达为可读、可编辑、可生成的 JSON。它适合文档示例、低代码编辑器、AI 生成、运行时更新和业务域对象建模。",
    "home.quick": "快速入门",
    "home.quickEditor": "场景编辑器",
    "home.quickPlayer": "场景播放器",
    "home.quickThreeBox": "Chat With ThreeBox &gt;",
    "home.examples": "查看示例",
    "home.features": "核心能力",
    "examples.title": "示例",
    "examples.desc": "每个示例聚焦一个 JSON 能力点。点击卡片后进入 shower，在左侧编辑 JSON，右侧实时渲染 ThreeJSON 场景。",
    "examples.legacy": "案例教程",
    "examples.tools.rebuild": "重建示例缩略图缓存",
    "examples.tools.clear": "清除示例缩略图缓存",
    "examples.tools.autoBuild": "自动构建缩略图缓存",
    "download.title": "下载 ThreeJSON",
    "contributors.title": "贡献者",
    "deps.title": "依赖项"
  },
  "en-US": {
    "nav.home": "Home",
    "nav.docs": "Docs",
    "nav.download": "Download",
    "nav.examples": "Examples",
    "nav.tools": "Tools",
    "nav.community": "Community",
    "docs.index": "Index",
    "docs.features": "Features",
    "docs.manual": "Manual",
    "docs.api": "API",
    "docs.jsonConfig": "JSON Config",
    "docs.changelog": "Changelog",
    "docs.faq": "FAQ",
    "download.download": "Download ThreeJSON",
    "download.scenes": "Download Templates",
    "tools.editor": "Scene Editor",
    "tools.player": "Scene Player",
    "tools.glossary": "Glossary",
    "tools.more": "Case Gallery",
    "community.contributors": "Contributors",
    "community.mail": "Mailing List",
    "community.contribute": "How To Contribute",
    "community.dependencies": "Dependencies",
    "community.codeStyle": "Code Style",
    "community.source": "Source (GitHub)",
    "community.issues": "Issues (GitHub)",
    "theme.label": "Theme",
    "theme.auto": "Auto",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "lang.label": "Language",
    "lang.auto": "Auto",
    "lang.zh": "Simplified Chinese",
    "lang.en": "English",
    "home.desc": "ThreeJSON represents Three.js scenes as readable, editable, and generatable JSON. It fits documentation examples, low-code editors, AI generation, runtime updates, and domain object modeling.",
    "home.quick": "Quick Start",
    "home.quickEditor": "Scene Editor",
    "home.quickPlayer": "Scene Player",
    "home.quickThreeBox": "Chat With ThreeBox &gt;",
    "home.examples": "View Examples",
    "home.features": "Core Features",
    "examples.title": "Examples",
    "examples.desc": "Each example focuses on one JSON capability. Open a card in shower, edit JSON on the left, and render the ThreeJSON scene on the right.",
    "examples.legacy": "Case Tutorials",
    "examples.tools.rebuild": "Rebuild Thumbnail Cache",
    "examples.tools.clear": "Clear Thumbnail Cache",
    "examples.tools.autoBuild": "Auto-Build Thumbnail Cache",
    "download.title": "Download ThreeJSON",
    "contributors.title": "Contributors",
    "deps.title": "Dependencies"
  }
};

const DOCS = [
  ["quick-start.md", "快速入门", "Quick Start", "入门"],
  ["README.md", "使用手册", "Manual", "入门"],
  ["api.md", "API", "API", "参考"],
  ["json-format.md", "JSON 配置", "JSON Config", "参考"],
  ["runtime-object-commands.md", "运行时命令", "Runtime Commands", "运行时"],
  ["runtime-object-mutation-quickref.md", "运行时变更速查", "Runtime Mutation", "运行时"],
  ["event-mechanism.md", "事件机制", "Events", "运行时"],
  ["domains.md", "Domains", "Domains", "领域"],
  ["extensions.md", "扩展", "Extensions", "扩展"],
  ["tools.md", "工具", "Tools", "工具"],
  ["development.md", "开发", "Development", "社区"],
  ["design-principles.md", "设计原则", "Design Principles", "社区"],
  ["glossary.md", "术语", "Glossary", "参考"],
  ["features.md", "特性", "Features", "项目"],
  ["changelog.md", "版本记录", "Changelog", "项目"],
  ["faq.md", "常见问题", "FAQ", "项目"]
];

const app = document.getElementById("app");
const langSelect = document.getElementById("langSelect");
const themeSelect = document.getElementById("themeSelect");

let lang = resolveLang();
let theme = localStorage.getItem(STORAGE.theme) || "auto";
let manifestCache = null;
let hoverMenu = null;
let pinnedMenu = null;

init();

function init() {
  langSelect.value = localStorage.getItem(STORAGE.lang) || "auto";
  themeSelect.value = theme;
  applyTheme();
  applyI18n();
  wireMenuHoverBehavior();
  wireDocLinks();
  window.addEventListener("hashchange", renderRoute);
  langSelect.addEventListener("change", () => {
    localStorage.setItem(STORAGE.lang, langSelect.value);
    const previousLang = lang;
    lang = resolveLang();
    document.documentElement.lang = lang === "zh-CN" ? "zh-CN" : "en";
    applyI18n();
    wireDocLinks();
    syncReaderRouteLanguage(previousLang, lang);
    renderRoute();
  });
  themeSelect.addEventListener("change", () => {
    theme = themeSelect.value;
    localStorage.setItem(STORAGE.theme, theme);
    applyTheme();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  document.getElementById("openEditorTool").addEventListener("click", openEditorTool);
  document.getElementById("openPlayerTool").addEventListener("click", openPlayerTool);
  document.getElementById("downloadSceneJsons").addEventListener("click", downloadSceneJsons);
  renderRoute();
}

function resolveLang() {
  const selected = localStorage.getItem(STORAGE.lang) || "auto";
  if (selected === "zh-CN" || selected === "en-US") return selected;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function t(key) {
  return I18N[lang]?.[key] || I18N["zh-CN"][key] || key;
}

function applyI18n() {
  document.documentElement.lang = lang === "zh-CN" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
}

function applyTheme() {
  const actual = theme === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = actual;
}

function wireDocLinks() {
  document.querySelectorAll("[data-doc]").forEach((node) => {
    const doc = node.dataset.doc;
    node.href = `#/reader/${localizedDocPath(doc)}`;
  });
}

function localizedDocPath(file) {
  return lang === "en-US" ? `docs/en/${file}` : `docs/zh/${file}`;
}

function readerHref(file, targetLang = lang) {
  const readerUrl = new URL(READER.href);
  const src = targetLang === "en-US" ? `../../docs/en/${file}` : `../../docs/zh/${file}`;
  readerUrl.searchParams.set("src", src);
  return readerUrl.href;
}

function syncReaderRouteLanguage(previousLang, nextLang) {
  const route = decodeURIComponent(location.hash || "#/").replace(/^#/, "") || "/";
  if (!route.startsWith("/reader/")) {
    return;
  }
  const current = route.slice("/reader/".length);
  const switched = switchDocPathLanguage(current, nextLang);
  if (switched && switched !== current) {
    location.hash = `#/reader/${switched}`;
  }
}

function switchDocPathLanguage(path, targetLang) {
  const match = String(path || "").match(/^docs\/(?:zh|en)\/([^?#]+\.md)(.*)$/i);
  if (match) {
    const file = match[1];
    const suffix = match[2] || "";
    return `${targetLang === "en-US" ? "docs/en" : "docs/zh"}/${file}${suffix}`;
  }
  const legacyMatch = String(path || "").match(/^docs\/([^/][^?#]+\.md)(.*)$/i);
  if (!legacyMatch) {
    return path;
  }
  const file = legacyMatch[1];
  const suffix = legacyMatch[2] || "";
  return `${targetLang === "en-US" ? "docs/en" : "docs/zh"}/${file}${suffix}`;
}

function renderRoute() {
  closeOpenMenus({ includePinned: true });
  teardownExamplesThumbnails();
  const hash = decodeURIComponent(location.hash || "#/");
  const route = hash.replace(/^#/, "") || "/";
  updateActiveNav(route);
  if (route.startsWith("/reader/")) {
    renderReader(route.slice("/reader/".length));
    return;
  }
  if (route === "/" || route === "/home") renderHome();
  else if (route === "/docs-index") renderDocsIndex();
  else if (route === "/examples") renderExamples();
  else if (route === "/download") renderDownload();
  else if (route === "/contributors") renderContributors();
  else if (route === "/dependencies") renderDependencies();
  else renderHome();
}

function updateActiveNav(route) {
  document.querySelectorAll(".mainNav > a.navActive").forEach((el) => el.classList.remove("navActive"));
  document.querySelectorAll(".navMenu.navActive").forEach((el) => el.classList.remove("navActive"));

  function activateTopLink(hashSuffix) {
    document.querySelector(`.mainNav > a[href="${hashSuffix}"]`)?.classList.add("navActive");
  }
  function activateMenuByChildHref(hashSuffix) {
    document.querySelector(`.navMenu a[href="${hashSuffix}"]`)?.closest(".navMenu")?.classList.add("navActive");
  }

  if (route === "/" || route === "/home") {
    activateTopLink("#/");
    return;
  }
  if (route === "/examples") {
    activateTopLink("#/examples");
    return;
  }
  if (route === "/docs-index" || route === "/download" || route === "/contributors" || route === "/dependencies") {
    activateMenuByChildHref(`#${route}`);
    return;
  }
  if (route.startsWith("/reader/")) {
    document
      .querySelector(`.navMenu [data-doc][href="#${route}"]`)
      ?.closest(".navMenu")
      ?.classList.add("navActive");
  }
}

function renderHome() {
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>ThreeJSON</h1>
        <p>${t("home.desc")}</p>
        <div class="heroActions">
          <a class="primaryBtn" href="#/reader/${localizedDocPath("quick-start.md")}">${t("home.quick")}</a>
          <a class="secondaryBtn" href="#/examples">${t("home.examples")}</a>
        </div>
        <div class="heroQuickLinks">
          <a href="#" id="homeOpenEditor">${t("home.quickEditor")}</a>
          <a href="#" id="homeOpenPlayer">${t("home.quickPlayer")}</a>
          <a href="#" id="homeOpenThreeBox">${t("home.quickThreeBox")}</a>
        </div>
      </div>
      <div class="heroVisual">
        <pre class="codeCard">{
  "sceneConfig": {
    "camera": { "position": { "x": 18, "y": 14, "z": 22 } },
    "lights": [{ "type": "directional", "intensity": 1 }]
  },
  "worldInfo": {
    "boxModelList": [{
      "threeJsonId": "box-basic",
      "objType": "box",
      "material": { "color": "#5470c6" }
    }]
  }
}</pre>
      </div>
    </section>
    <section class="band">
      <h2 class="sectionTitle">${t("home.features")}</h2>
      <div class="featureGrid">
        ${featureCard("JSON Driven", "JSON 驱动场景配置、对象、材质、事件和动画。", "Scene config, objects, materials, events, and animations are data.", "json-format.md")}
        ${featureCard("AI Friendly", "结构化 JSON 便于生成、解释和增量 patch。", "Structured JSON is easy to generate, explain, and patch.", "features.md")}
        ${featureCard("Domains", "用 domain 描述业务对象和复合对象。", "Use domains for business objects and composed scene concepts.", "domains.md")}
        ${featureCard("Runtime Mutation", "支持运行时命令和局部更新。", "Supports runtime commands and partial updates.", "runtime-object-mutation-quickref.md")}
      </div>
    </section>`;
  document.getElementById("homeOpenEditor")?.addEventListener("click", openEditorTool);
  document.getElementById("homeOpenPlayer")?.addEventListener("click", openPlayerTool);
  document.getElementById("homeOpenThreeBox")?.addEventListener("click", openThreeBoxTool);
}

function featureCard(title, zh, en, docFile) {
  return `<a class="feature" href="${readerHref(docFile)}" target="_blank" rel="noreferrer"><h3>${title}</h3><p>${lang === "zh-CN" ? zh : en}</p></a>`;
}

function renderReader(src) {
  const readerUrl = new URL(READER.href);
  readerUrl.searchParams.set("src", `../../${src}`);
  app.innerHTML = `<iframe class="readerFrame" src="${readerUrl.href}" title="ThreeJSON Reader"></iframe>`;
}

function renderDocsIndex() {
  const groups = new Map();
  for (const [file, zh, en, group] of DOCS) {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ file, title: lang === "zh-CN" ? zh : en });
  }
  app.innerHTML = `
    <section class="page">
      <h1>${t("docs.index")}</h1>
      <div class="cardGrid">
        ${Array.from(groups, ([group, docs]) => `
          <article class="card">
            <h3>${group}</h3>
            <ul>${docs.map((doc) => `<li><a target="_blank" rel="noreferrer" href="${readerHref(doc.file)}">${doc.title}</a></li>`).join("")}</ul>
          </article>`).join("")}
      </div>
    </section>`;
}

async function loadManifest() {
  if (manifestCache) return manifestCache;
  const res = await fetch(MANIFEST_URL);
  manifestCache = await res.json();
  return manifestCache;
}

async function renderExamples() {
  const manifest = await loadManifest();
  app.innerHTML = `
    <div class="examplesToolsHover">
      <div class="examplesToolsTrigger" aria-hidden="true">&#9881;</div>
      <div class="examplesToolsPanel">
        <div class="examplesToolsButtonRow">
          <button type="button" id="rebuildThumbCacheBtn">${t("examples.tools.rebuild")}</button>
          <button type="button" id="clearThumbCacheBtn">${t("examples.tools.clear")}</button>
        </div>
        <label class="examplesToolsCheckboxRow">
          <input type="checkbox" id="autoThumbCacheCheckbox">
          <span>${t("examples.tools.autoBuild")}</span>
        </label>
      </div>
    </div>
    <section class="examplesPage">
      <aside class="examplesSideList">
        ${manifest.map((section, index) => `<a href="#section-${section.section}" class="${index === 0 ? "active" : ""}" data-section="${section.section}">${lang === "zh-CN" ? section.sectionTitle : section.sectionTitleEn}</a>`).join("")}
        <a class="legacyExamplesLink" href="../examples/html-demo/demo.html" target="_blank" rel="noreferrer">${t("examples.legacy")}</a>
      </aside>
      <div class="examplesContent">
        <h1>${t("examples.title")}</h1>
        <p>${t("examples.desc")}</p>
        ${manifest.map((section) => `
          <section id="section-${section.section}" class="exampleSection">
            <h2>${lang === "zh-CN" ? section.sectionTitle : section.sectionTitleEn}</h2>
            <div class="exampleGrid">
              ${section.items.map((item) => `
                <article class="card exampleCard${item.external ? " externalCard" : ""}" data-json="${item.json || ""}"${item.external ? ` data-external="${item.external}"` : ""}>
                  <div class="exampleThumb"><img src="${PLACEHOLDER_IMG}" alt=""></div>
                  <div class="exampleCardBody">
                    <h3>${lang === "zh-CN" ? item.title : item.titleEn}${item.external ? ' <span class="externalLinkGlyph" title="' + (lang === "zh-CN" ? "在新标签页打开" : "Opens in a new tab") + '">↗</span>' : ""}</h3>
                    <p>${lang === "zh-CN" ? item.desc : item.descEn}</p>
                  </div>
                </article>`).join("")}
            </div>
          </section>`).join("")}
      </div>
    </section>`;
  app.querySelectorAll(".examplesSideList a[data-section]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      app.querySelectorAll(".examplesSideList a").forEach((node) => node.classList.remove("active"));
      link.classList.add("active");
      app.querySelector(`#section-${CSS.escape(link.dataset.section)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  app.querySelectorAll(".exampleCard").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.external) {
        window.open(resolveRootAssetUrl(card.dataset.external), "_blank", "noreferrer");
        return;
      }
      const shower = new URL("../../tools/scene-host/shower/index.html", import.meta.url);
      shower.searchParams.set("json", card.dataset.json);
      shower.searchParams.set("lang", lang);
      window.open(shower.href, "_blank", "noreferrer");
    });
  });
  const autoThumbCheckbox = document.getElementById("autoThumbCacheCheckbox");
  if (autoThumbCheckbox) {
    autoThumbCheckbox.checked = isAutoThumbCacheEnabled();
    autoThumbCheckbox.addEventListener("change", () => {
      try {
        localStorage.setItem(AUTO_THUMB_CACHE_STORAGE_KEY, autoThumbCheckbox.checked ? "1" : "0");
      } catch {
        /* ignore */
      }
    });
  }
  document.getElementById("rebuildThumbCacheBtn")?.addEventListener("click", rebuildAllThumbnails);
  document.getElementById("clearThumbCacheBtn")?.addEventListener("click", clearAllThumbnails);
  initExamplesThumbnails();
  initExamplesScrollSpy();
}

// --- Example card thumbnail capture pipeline -------------------------------

function teardownExamplesThumbnails() {
  thumbObserver?.disconnect();
  thumbObserver = null;
  thumbQueue = [];
  thumbQueueRunning = false;
  if (thumbCanvas) {
    thumbCanvas.remove();
    thumbCanvas = null;
  }
  sectionScrollObserver?.disconnect();
  sectionScrollObserver = null;
}

function isAutoThumbCacheEnabled() {
  try {
    return localStorage.getItem(AUTO_THUMB_CACHE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function initExamplesThumbnails() {
  if (!isAutoThumbCacheEnabled()) return;
  const cards = Array.from(app.querySelectorAll(".exampleCard"));
  if (!cards.length || typeof IntersectionObserver === "undefined") return;
  thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      thumbObserver.unobserve(entry.target);
      enqueueThumbnail(entry.target);
    }
  }, { rootMargin: "200px" });
  cards.forEach((card) => thumbObserver.observe(card));
}

function rebuildAllThumbnails() {
  const cards = Array.from(app.querySelectorAll(".exampleCard")).filter((card) => card.dataset.json);
  thumbQueue = cards.map((card) => ({ card, jsonPath: card.dataset.json }));
  void runThumbQueue();
}

function clearAllThumbnails() {
  try {
    localStorage.removeItem(THUMB_CACHE_KEY);
  } catch {
    /* ignore */
  }
  thumbQueue = [];
  app.querySelectorAll(".exampleThumb img").forEach((img) => {
    img.src = PLACEHOLDER_IMG;
    img.classList.remove("captured");
  });
}

function initExamplesScrollSpy() {
  const sections = Array.from(app.querySelectorAll(".exampleSection"));
  if (!sections.length || typeof IntersectionObserver === "undefined") return;
  sectionScrollObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting);
    if (!visible.length) return;
    visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    const sectionId = visible[0].target.id.replace(/^section-/, "");
    app.querySelectorAll(".examplesSideList a[data-section]").forEach((node) => {
      node.classList.toggle("active", node.dataset.section === sectionId);
    });
  }, { rootMargin: "-72px 0px -70% 0px", threshold: [0, 1] });
  sections.forEach((section) => sectionScrollObserver.observe(section));
}

function readThumbCache() {
  try {
    const raw = localStorage.getItem(THUMB_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeThumbCache(cache) {
  try {
    localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(cache));
  } catch {
    try {
      const entries = Object.entries(cache).sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0));
      const trimmed = Object.fromEntries(entries.slice(Math.ceil(entries.length / 2)));
      localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(trimmed));
    } catch {
      /* give up caching silently, thumbnail already applied in-memory */
    }
  }
}

function enqueueThumbnail(card) {
  const jsonPath = card.dataset.json;
  if (!jsonPath) return;
  const cache = readThumbCache();
  const cached = cache[jsonPath];
  if (cached?.dataUrl && Date.now() - (cached.ts || 0) < THUMB_CACHE_TTL_MS) {
    applyThumbnail(card, cached.dataUrl);
    return;
  }
  thumbQueue.push({ card, jsonPath });
  void runThumbQueue();
}

function applyThumbnail(card, dataUrl) {
  const img = card.querySelector(".exampleThumb img");
  if (!img) return;
  img.src = dataUrl;
  img.classList.add("captured");
}

async function runThumbQueue() {
  if (thumbQueueRunning) return;
  thumbQueueRunning = true;
  try {
    while (thumbQueue.length) {
      const task = thumbQueue.shift();
      if (!task.card.isConnected) continue;
      try {
        const dataUrl = await withTimeout(captureExampleThumbnail(task.jsonPath), THUMB_LOAD_TIMEOUT_MS);
        if (dataUrl) {
          const cache = readThumbCache();
          cache[task.jsonPath] = { dataUrl, ts: Date.now() };
          writeThumbCache(cache);
          if (task.card.isConnected) applyThumbnail(task.card, dataUrl);
        }
      } catch (error) {
        console.warn("[examples] thumbnail capture failed for", task.jsonPath, error);
      }
    }
  } finally {
    thumbQueueRunning = false;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("thumbnail capture timed out")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function getThumbCanvas() {
  if (thumbCanvas && thumbCanvas.isConnected) return thumbCanvas;
  thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = THUMB_WIDTH;
  thumbCanvas.height = THUMB_HEIGHT;
  thumbCanvas.style.position = "fixed";
  thumbCanvas.style.left = "-99999px";
  thumbCanvas.style.top = "0";
  thumbCanvas.style.width = `${THUMB_WIDTH}px`;
  thumbCanvas.style.height = `${THUMB_HEIGHT}px`;
  document.body.appendChild(thumbCanvas);
  return thumbCanvas;
}

async function loadThumbCoreModule() {
  if (!thumbCoreModulePromise) {
    thumbCoreModulePromise = import("../../core/index.js");
  }
  return thumbCoreModulePromise;
}

function withReducedQuality(payload) {
  const clone = structuredClone(payload || {});
  clone.sceneConfig = {
    ...clone.sceneConfig,
    renderer: { ...clone.sceneConfig?.renderer, antialias: false, ratioRate: 0.75 },
    textureDefaults: {
      ...clone.sceneConfig?.textureDefaults,
      ui: { generateMipmaps: false, anisotropy: 1, ...clone.sceneConfig?.textureDefaults?.ui },
      imageMap: { generateMipmaps: false, anisotropy: 1, ...clone.sceneConfig?.textureDefaults?.imageMap }
    }
  };
  return clone;
}

function resolveRepoRelativeUrl(value, baseUrl = ROOT) {
  const clean = String(value || "").trim()
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
  return new URL(clean, baseUrl).href;
}

async function captureExampleThumbnail(jsonPath) {
  const { createJsonScene, captureSceneFrame } = await loadThumbCoreModule();
  const jsonUrl = resolveRepoRelativeUrl(jsonPath);
  const payload = await fetch(jsonUrl).then((response) => {
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    return response.json();
  });
  const canvas = getThumbCanvas();
  let captured = null;
  const runtime = await createJsonScene(withReducedQuality(payload), {
    canvas,
    resetScene: true,
    assetsBase: new URL("assets/", ROOT).href,
    onSceneReady: async (ctx) => {
      captured = await captureSceneFrame(ctx, {
        as: "dataUrl",
        mimeType: "image/jpeg",
        quality: 0.72,
        offscreen: true,
        offscreenWidth: THUMB_WIDTH,
        offscreenHeight: THUMB_HEIGHT
      });
    }
  });
  runtime?.dispose?.();
  return captured?.dataUrl || null;
}

function renderDownload() {
  app.innerHTML = `
    <section class="page">
      <h1>${t("download.title")}</h1>
      <div class="cardGrid">
        <article class="card">
          <h3>threejson</h3>
          <p>${lang === "zh-CN" ? "核心运行时和内置能力。" : "Core runtime and built-in capabilities."}</p>
          <pre><code>npm install threejson</code></pre>
        </article>
        <article class="card">
          <h3>@threejson/assets</h3>
          <p>${lang === "zh-CN" ? "可选本地资源包，用于示例、纹理和演示场景。" : "Optional local assets for examples, textures, and demo scenes."}</p>
          <pre><code>npm install @threejson/assets</code></pre>
        </article>
      </div>
    </section>`;
}

function renderContributors() {
  app.innerHTML = `
    <section class="page">
      <h1>${t("contributors.title")}</h1>
      <article class="card">
        <img class="avatar" src="https://github.com/nnrj.png" alt="nnrj">
        <h3><a href="https://github.com/nnrj" target="_blank" rel="noreferrer">nnrj</a></h3>
        <p>ThreeJSON maintainer.</p>
      </article>
    </section>`;
}

const DEP_REPOS = {
  "three": { label: "Three.js", url: "https://github.com/mrdoob/three.js" },
  "@tweenjs/tween.js": { url: "https://github.com/tweenjs/tween.js" },
  "html2canvas-pro": { url: "https://github.com/yorickshan/html2canvas-pro" },
  "gifuct-js": { url: "https://github.com/matt-way/gifuct-js" },
  "@dimforge/rapier3d-compat": { url: "https://github.com/dimforge/rapier.js" },
  "three-mesh-bvh": { url: "https://github.com/gkjohnson/three-mesh-bvh" },
  "three-bvh-csg": { url: "https://github.com/gkjohnson/three-bvh-csg" },
  "troika-three-text": { url: "https://github.com/protectwise/troika" },
  "echarts": { url: "https://github.com/apache/echarts" },
  "CodeMirror": { url: "https://github.com/codemirror" },
  "fflate": { url: "https://github.com/101arrowz/fflate" },
  "Three.js examples": { url: "https://github.com/mrdoob/three.js/tree/dev/examples/jsm" }
};

function renderDependencies() {
  app.innerHTML = `
    <section class="page">
      <h1>${t("deps.title")}</h1>
      <div class="cardGrid">
        <article class="card"><h3>${lang === "zh-CN" ? "内核依赖" : "Core"}</h3><div class="pillList">${["three", "@tweenjs/tween.js", "html2canvas-pro", "gifuct-js"].map(pill).join("")}</div></article>
        <article class="card"><h3>${lang === "zh-CN" ? "扩展依赖" : "Extensions"}</h3><div class="pillList">${["@dimforge/rapier3d-compat", "three-mesh-bvh", "three-bvh-csg", "troika-three-text", "echarts"].map(pill).join("")}</div></article>
        <article class="card"><h3>${lang === "zh-CN" ? "工具依赖" : "Tools"}</h3><div class="pillList">${["CodeMirror", "fflate", "Three.js examples", "browser APIs"].map(pill).join("")}</div></article>
      </div>
      <article class="card threeSpotlight">
        <h3>Three.js</h3>
        <p>${lang === "zh-CN"
          ? "ThreeJSON 的 3D 渲染能力构建在 <a href=\"https://threejs.org/\" target=\"_blank\" rel=\"noreferrer\">Three.js</a> 之上：ThreeJSON 是一个 JSON 驱动的中间层，负责把配置数据转换为场景图、对象与生命周期管理，最终仍由 Three.js 完成几何、材质、光照与渲染。"
          : "ThreeJSON's 3D rendering is built on top of <a href=\"https://threejs.org/\" target=\"_blank\" rel=\"noreferrer\">Three.js</a>: ThreeJSON is a JSON-driven middle layer that turns configuration data into a scene graph, objects, and lifecycle management, while Three.js still handles geometry, materials, lighting, and rendering underneath."}</p>
        <div class="pillList">
          <a class="pill" href="https://threejs.org/" target="_blank" rel="noreferrer">${lang === "zh-CN" ? "Three.js 官网" : "Three.js homepage"}</a>
          <a class="pill" href="https://github.com/mrdoob/three.js" target="_blank" rel="noreferrer">${lang === "zh-CN" ? "Three.js 仓库（GitHub）" : "Three.js repo (GitHub)"}</a>
          <a class="pill" href="https://discourse.threejs.org/t/i-built-threejson-a-json-driven-declarative-scene-runtime-for-three-js-does-this-abstraction-make-sense/92662/8" target="_blank" rel="noreferrer">${lang === "zh-CN" ? "three.js forum 讨论帖" : "three.js forum thread"}</a>
        </div>
      </article>
    </section>`;
}

function pill(name) {
  const repo = DEP_REPOS[name];
  const label = repo?.label || name;
  if (repo?.url) {
    return `<a class="pill" href="${repo.url}" target="_blank" rel="noreferrer">${label}</a>`;
  }
  return `<span class="pill">${label}</span>`;
}

function openEditorTool(event) {
  event.preventDefault();
  window.open(new URL("../../tools/scene-host/editor/index.html", import.meta.url), "_blank", "noreferrer");
}

function openPlayerTool(event) {
  event.preventDefault();
  window.open(new URL("../../tools/scene-host/player/index.html", import.meta.url), "_blank", "noreferrer");
}

function openThreeBoxTool(event) {
  event.preventDefault();
  window.open(new URL("../../tools/scene-host/three-box/index.html", import.meta.url), "_blank", "noreferrer");
}

async function downloadSceneJsons(event) {
  event.preventDefault();
  const { zipSync, strToU8 } = await import("https://esm.sh/fflate@0.8.3");
  const manifest = await loadManifest();
  const files = {};
  for (const section of manifest) {
    for (const item of section.items) {
      const url = resolveRootAssetUrl(item.json);
      const text = await fetch(url).then((res) => res.text());
      files[`demo-scene-jsons/${new URL(url).pathname.split("/").pop()}`] = [strToU8(text), { level: 6 }];
    }
  }
  const blob = new Blob([zipSync(files)], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "demo-scene-jsons.zip";
  a.click();
  URL.revokeObjectURL(a.href);
}

function resolveRootAssetUrl(raw) {
  const value = String(raw || "").trim();
  if (/^(?:[a-z]+:)?\/\//i.test(value)) return value;
  const clean = value.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "").replace(/^\//, "");
  return new URL(clean, ROOT).href;
}

function wireMenuHoverBehavior() {
  const header = document.querySelector(".siteHeader");
  const menus = Array.from(document.querySelectorAll(".navMenu"));
  menus.forEach((menu) => {
    const button = menu.querySelector("button");
    button.addEventListener("mouseenter", () => {
      if (pinnedMenu) return;
      setHoverMenu(menu);
    });
    button.addEventListener("click", () => {
      pinnedMenu = pinnedMenu === menu ? null : menu;
      setHoverMenu(null);
      menus.forEach((node) => node.classList.toggle("pinnedOpen", node === pinnedMenu));
    });
    menu.querySelector(".dropdown")?.addEventListener("click", () => {
      setHoverMenu(null);
      pinnedMenu?.classList.remove("pinnedOpen");
      pinnedMenu = null;
    });
  });
  header.addEventListener("mousemove", (event) => {
    if (pinnedMenu) return;
    const menu = event.target.closest?.(".navMenu");
    if (menu && menus.includes(menu)) {
      setHoverMenu(menu);
      return;
    }
    const topLink = event.target.closest?.(".mainNav > a");
    if (topLink) {
      setHoverMenu(null);
    }
  });
  header.addEventListener("mouseleave", () => {
    if (!pinnedMenu) {
      setHoverMenu(null);
    }
  });
  app.addEventListener("pointerenter", () => {
    if (!pinnedMenu) {
      setHoverMenu(null);
    }
  });
  document.addEventListener("pointermove", (event) => {
    if (pinnedMenu || !hoverMenu) return;
    if (!header.contains(event.target)) {
      setHoverMenu(null);
    }
  });
  document.addEventListener("click", (event) => {
    if (pinnedMenu && !pinnedMenu.contains(event.target)) {
      pinnedMenu.classList.remove("pinnedOpen");
      pinnedMenu = null;
    }
    if (event.target.closest?.(".mainNav > a")) {
      setHoverMenu(null);
    }
  });
}

function closeOpenMenus(options = {}) {
  setHoverMenu(null);
  if (options.includePinned && pinnedMenu) {
    pinnedMenu.classList.remove("pinnedOpen");
    pinnedMenu = null;
  }
}

function setHoverMenu(menu) {
  if (hoverMenu === menu) return;
  document.querySelectorAll(".navMenu.hoverOpen").forEach((node) => node.classList.remove("hoverOpen"));
  hoverMenu = menu;
  hoverMenu?.classList.add("hoverOpen");
}
