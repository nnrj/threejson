import { marked } from "https://esm.sh/marked";
import DOMPurify from "https://esm.sh/dompurify";
import hljs from "https://esm.sh/highlight.js";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const JSON_EXTENSIONS = new Set(["json"]);
const SOURCE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "html", "htm", "vue", "css",
  "txt", "text", "yml", "yaml",
  "bash", "sh", "ps1", "cmd", "bat",
  "obj", "mtl", "csv"
]);

const TEXTUAL_EXTENSIONS = new Set([...MARKDOWN_EXTENSIONS, ...JSON_EXTENSIONS, ...SOURCE_EXTENSIONS]);

const EXTENSION_TO_LANGUAGE = {
  md: "markdown",
  markdown: "markdown",
  json: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "xml",
  htm: "xml",
  vue: "xml",
  css: "css",
  txt: "plaintext",
  text: "plaintext",
  yml: "yaml",
  yaml: "yaml",
  bash: "bash",
  sh: "bash",
  ps1: "powershell",
  cmd: "dos",
  bat: "dos",
  obj: "plaintext",
  mtl: "plaintext",
  csv: "plaintext"
};

const STORAGE_KEYS = {
  themeMode: "threejson-reader-theme-mode",
  tocPinned: "threejson-reader-toc-pinned",
  lineNumbersEnabled: "threejson-reader-line-numbers",
  collapsedHeadingIds: "threejson-reader-collapsed-headings"
};

const THEME_STYLES = {
  dark: {
    markdown: "https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-dark.min.css",
    highlight: "https://cdn.jsdelivr.net/npm/highlight.js/styles/github-dark.min.css"
  },
  light: {
    markdown: "https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown.min.css",
    highlight: "https://cdn.jsdelivr.net/npm/highlight.js/styles/github.min.css"
  }
};

const SYSTEM_THEME_QUERY = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;
const TOC_PEEK_HIDE_DELAY_MS = 140;
let tocPeekHideTimer = null;
const markdownCopyButtonTimers = new WeakMap();

const COPY_ICON_SVG = `
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <rect x="5.25" y="2.25" width="7.5" height="9.5" rx="1.6"></rect>
    <path d="M3.75 5H3.2A1.95 1.95 0 0 0 1.25 6.95v5.85c0 1.08.87 1.95 1.95 1.95h5.85A1.95 1.95 0 0 0 11 12.8v-.55"></path>
  </svg>
`;

const CHECK_ICON_SVG = `
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M3.5 8.4 6.6 11.5 12.5 4.9"></path>
  </svg>
`;

const els = {
  markdownThemeLink: document.getElementById("markdownThemeLink"),
  highlightThemeLink: document.getElementById("highlightThemeLink"),
  title: document.getElementById("readerTitle"),
  path: document.getElementById("readerPath"),
  themeSelect: document.getElementById("themeSelect"),
  modeBadge: document.getElementById("readerModeBadge"),
  actionsMenu: document.getElementById("actionsMenu"),
  actionsMenuButton: document.getElementById("actionsMenuButton"),
  actionsMenuPanel: document.getElementById("actionsMenuPanel"),
  statusBar: document.getElementById("statusBar"),
  lineNumbersButton: document.getElementById("lineNumbersButton"),
  toggleViewButton: document.getElementById("toggleViewButton"),
  copyButton: document.getElementById("copyButton"),
  reloadButton: document.getElementById("reloadButton"),
  openRawLink: document.getElementById("openRawLink"),
  tocFlyoutHost: document.getElementById("tocFlyoutHost"),
  tocPinButton: document.getElementById("tocPinButton"),
  tocEdgeHoverZone: document.getElementById("tocEdgeHoverZone"),
  tocPanel: document.getElementById("tocPanel"),
  tocNav: document.getElementById("tocNav"),
  contentHost: document.getElementById("contentHost"),
  emptyState: document.getElementById("emptyState"),
  errorState: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  layout: document.querySelector(".readerLayout")
};

const state = {
  sourceUrl: null,
  sourcePath: "",
  sourceExt: "",
  anchor: "",
  rawText: "",
  contentType: "",
  themeMode: "system",
  appliedTheme: "dark",
  viewMode: "rendered",
  headings: [],
  headingTree: [],
  headingParentById: new Map(),
  tocPinned: true,
  tocPeek: false,
  markdownCodeBlockCount: 0,
  lineNumbersEnabled: true,
  collapsedHeadingIds: new Set(),
  lastRenderKind: "empty"
};

marked.setOptions({
  gfm: true,
  breaks: false
});

function readStoredValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function writeStoredValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {
    /* ignore persistence failures */
  }
}

function readStoredBoolean(key, fallback) {
  const raw = readStoredValue(key);
  if (raw === null) {
    return fallback;
  }
  return raw === "1";
}

function writeStoredBoolean(key, value) {
  writeStoredValue(key, value ? "1" : "0");
}

function readStoredThemeMode() {
  const raw = readStoredValue(STORAGE_KEYS.themeMode);
  return raw === "dark" || raw === "light" || raw === "system"
    ? raw
    : "system";
}

function readStoredHeadingSet() {
  const raw = readStoredValue(STORAGE_KEYS.collapsedHeadingIds);
  if (!raw) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((item) => typeof item === "string"));
  } catch (_error) {
    return new Set();
  }
}

function writeStoredHeadingSet(values) {
  writeStoredValue(STORAGE_KEYS.collapsedHeadingIds, JSON.stringify([...values]));
}

function getActiveTheme() {
  if (state.themeMode === "system") {
    return SYSTEM_THEME_QUERY?.matches ? "dark" : "light";
  }
  return state.themeMode;
}

function applyTheme() {
  const activeTheme = getActiveTheme();
  state.appliedTheme = activeTheme;
  document.documentElement.dataset.theme = activeTheme;
  document.documentElement.style.colorScheme = activeTheme;
  if (els.markdownThemeLink) {
    els.markdownThemeLink.href = THEME_STYLES[activeTheme].markdown;
  }
  if (els.highlightThemeLink) {
    els.highlightThemeLink.href = THEME_STYLES[activeTheme].highlight;
  }
  if (els.themeSelect) {
    els.themeSelect.value = state.themeMode;
  }
}

function initializePreferences() {
  state.themeMode = readStoredThemeMode();
  state.tocPinned = readStoredBoolean(STORAGE_KEYS.tocPinned, true);
  state.lineNumbersEnabled = readStoredBoolean(STORAGE_KEYS.lineNumbersEnabled, true);
  state.collapsedHeadingIds = readStoredHeadingSet();
  applyTheme();
}

function getReaderPageUrl() {
  return new URL("./reader.html", window.location.href);
}

function getRequestedSource() {
  const url = new URL(window.location.href);
  const srcValue = url.searchParams.get("src") || "";
  const view = url.searchParams.get("view") || "";
  return {
    srcValue,
    hashAnchor: decodeURIComponent(url.hash.replace(/^#/, "")),
    view
  };
}

function splitSourceAndAnchor(rawValue, hashAnchor) {
  if (!rawValue) {
    return { sourceValue: "", anchor: hashAnchor || "" };
  }
  const hashIndex = rawValue.indexOf("#");
  if (hashIndex < 0) {
    return { sourceValue: rawValue, anchor: hashAnchor || "" };
  }
  return {
    sourceValue: rawValue.slice(0, hashIndex),
    anchor: hashAnchor || decodeURIComponent(rawValue.slice(hashIndex + 1))
  };
}

function normalizeSourceRequest() {
  const requested = getRequestedSource();
  const split = splitSourceAndAnchor(requested.srcValue, requested.hashAnchor);
  return {
    sourceValue: split.sourceValue,
    anchor: split.anchor,
    requestedView: requested.view
  };
}

function resolveSourceUrl(rawValue) {
  if (!rawValue) {
    return null;
  }
  const resolved = new URL(rawValue, window.location.href);
  const fetchUrl = new URL(resolved.href);
  fetchUrl.hash = "";
  return fetchUrl;
}

function getExtension(pathname) {
  const cleanPath = pathname.split("?")[0];
  const match = /\.([^.\/]+)$/.exec(cleanPath);
  return match ? match[1].toLowerCase() : "";
}

function isTextualPath(pathname) {
  return TEXTUAL_EXTENSIONS.has(getExtension(pathname));
}

function getDisplayModeForExtension(ext) {
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }
  if (JSON_EXTENSIONS.has(ext)) {
    return "json";
  }
  return "source";
}

function humanizeKind(kind) {
  if (kind === "markdown") {
    return "Markdown";
  }
  if (kind === "json") {
    return "JSON";
  }
  if (kind === "source") {
    return "源码";
  }
  return "文本";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugifyHeading(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/，。、《》？：；“”‘’！·（）【】]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function setStatus(message) {
  els.statusBar.textContent = message;
}

function setModeBadge(message) {
  els.modeBadge.textContent = message;
}

function setHeader(fileUrl, ext) {
  const fileName = fileUrl ? fileUrl.pathname.split("/").pop() || "未命名文件" : "项目文档阅读器";
  els.title.textContent = fileName || "项目文档阅读器";
  els.path.textContent = fileUrl ? decodeURIComponent(fileUrl.pathname) : "等待载入文件...";
  setModeBadge(ext ? `${humanizeKind(getDisplayModeForExtension(ext))} · .${ext}` : "待加载");
}

function getMarkdownContentRoot() {
  return els.contentHost.querySelector(".markdownArticle");
}

function showSection(sectionName) {
  els.emptyState.hidden = sectionName !== "empty";
  els.errorState.hidden = sectionName !== "error";
  els.contentHost.hidden = sectionName !== "content";
}

function clearToc() {
  state.headings = [];
  state.headingTree = [];
  state.headingParentById = new Map();
  state.markdownCodeBlockCount = 0;
  els.tocNav.innerHTML = "";
  syncTocDockClasses({ persist: false });
}

function getCopyPayload() {
  if (!state.rawText) {
    return {
      text: "",
      label: "内容"
    };
  }
  if (MARKDOWN_EXTENSIONS.has(state.sourceExt)) {
    return {
      text: "",
      label: ""
    };
  }
  if (JSON_EXTENSIONS.has(state.sourceExt)) {
    return {
      text: formatJsonText(state.rawText),
      label: "JSON"
    };
  }
  return {
    text: state.rawText,
    label: "源码"
  };
}

function closeAllReaderMenus() {
  document.querySelectorAll(".readerTopMenubar details[open]").forEach((node) => {
    node.removeAttribute("open");
  });
}

function updateActionButtons() {
  const copyPayload = getCopyPayload();
  const allowMenuCopy = Boolean(copyPayload.text) && state.lastRenderKind !== "markdown";
  els.copyButton.hidden = !allowMenuCopy;
  els.copyButton.disabled = !allowMenuCopy;
  els.copyButton.textContent = allowMenuCopy ? `复制${copyPayload.label}` : "复制内容";

  if (state.sourceUrl) {
    const rawHref = state.sourceUrl.pathname + state.sourceUrl.search + (state.anchor ? `#${encodeURIComponent(state.anchor)}` : "");
    els.openRawLink.href = rawHref;
    els.openRawLink.classList.remove("isDisabled");
  } else {
    els.openRawLink.href = "#";
    els.openRawLink.classList.add("isDisabled");
  }

  els.toggleViewButton.hidden = !state.sourceUrl;
  if (state.sourceUrl) {
    els.toggleViewButton.textContent = "查看源码";
  }

  const canToggleLineNumbers = Boolean(state.rawText) && (
    state.lastRenderKind === "json"
    || state.lastRenderKind === "source"
    || (state.lastRenderKind === "markdown" && state.markdownCodeBlockCount > 0)
  );
  els.lineNumbersButton.hidden = !canToggleLineNumbers;
  if (canToggleLineNumbers) {
    els.lineNumbersButton.textContent = state.lineNumbersEnabled ? "隐藏行号" : "显示行号";
    els.lineNumbersButton.classList.toggle("isActive", state.lineNumbersEnabled);
  }

  els.actionsMenuButton.setAttribute("aria-expanded", els.actionsMenu.hasAttribute("open") ? "true" : "false");
  syncTocDockClasses({ persist: false });
}

function buildReaderHref(targetUrl, anchor = "") {
  const readerUrl = getReaderPageUrl();
  const next = new URL(readerUrl.href);
  next.searchParams.set("src", targetUrl.pathname + targetUrl.search);
  if (MARKDOWN_EXTENSIONS.has(getExtension(targetUrl.pathname)) && state.viewMode === "source") {
    next.searchParams.set("view", "source");
  }
  if (anchor) {
    next.hash = encodeURIComponent(anchor);
  } else {
    next.hash = "";
  }
  return next.href;
}

function replaceReaderLocation(targetUrl, anchor = "", viewMode = "") {
  const readerUrl = getReaderPageUrl();
  const next = new URL(readerUrl.href);
  next.searchParams.set("src", targetUrl.pathname + targetUrl.search);
  if (viewMode === "source") {
    next.searchParams.set("view", "source");
  } else {
    next.searchParams.delete("view");
  }
  next.hash = anchor ? encodeURIComponent(anchor) : "";
  window.location.href = next.href;
}

function scrollToAnchor(anchor, behavior = "smooth") {
  if (!anchor) {
    return;
  }
  const target = document.getElementById(anchor);
  if (!target || !els.contentHost.contains(target)) {
    return;
  }
  state.anchor = anchor;
  target.scrollIntoView({
    block: "start",
    inline: "nearest",
    behavior
  });
}

function syncTocDockClasses(options = {}) {
  const persist = options.persist !== false;
  const hasToc = state.headings.length > 1;
  const shown = hasToc && (state.tocPinned || state.tocPeek);

  if (!hasToc) {
    state.tocPeek = false;
    clearTimeout(tocPeekHideTimer);
  }

  els.tocPinButton.hidden = !hasToc;
  if (hasToc) {
    els.tocPinButton.setAttribute("aria-pressed", state.tocPinned ? "true" : "false");
    els.tocPinButton.textContent = state.tocPinned ? "PIN" : "AUTO";
    els.tocPinButton.title = state.tocPinned
      ? "已钉住：鼠标移开仍显示"
      : "自动隐藏：移到屏幕左边缘唤出";
  }

  els.tocPanel.hidden = !shown;
  els.layout.classList.toggle("hasToc", shown && state.tocPinned);
  els.layout.classList.toggle("tocVisible", shown);
  els.layout.classList.toggle("tocFloating", shown && !state.tocPinned);
  els.layout.classList.toggle("tocPinned", hasToc && state.tocPinned);
  els.layout.classList.toggle("tocPeek", hasToc && state.tocPeek);
  els.tocFlyoutHost.classList.toggle("isActive", shown);

  if (persist) {
    writeStoredBoolean(STORAGE_KEYS.tocPinned, state.tocPinned);
  }
}

function showTocPeek() {
  if (state.headings.length <= 1) {
    return;
  }
  clearTimeout(tocPeekHideTimer);
  if (!state.tocPinned) {
    state.tocPeek = true;
  }
  syncTocDockClasses({ persist: false });
}

function scheduleTocPeekHide() {
  if (state.tocPinned) {
    return;
  }
  clearTimeout(tocPeekHideTimer);
  tocPeekHideTimer = setTimeout(() => {
    state.tocPeek = false;
    syncTocDockClasses({ persist: false });
  }, TOC_PEEK_HIDE_DELAY_MS);
}

function hideTocPeekImmediately() {
  clearTimeout(tocPeekHideTimer);
  if (state.tocPinned) {
    return;
  }
  state.tocPeek = false;
  syncTocDockClasses({ persist: false });
}

function buildHeadingTree(headings) {
  const root = [];
  const stack = [];
  const parentById = new Map();

  headings.forEach((item) => {
    const node = {
      ...item,
      children: []
    };

    while (stack.length && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    const parentNode = stack[stack.length - 1];
    if (parentNode) {
      parentNode.children.push(node);
      parentById.set(node.id, parentNode.id);
    } else {
      root.push(node);
    }

    stack.push(node);
  });

  return {
    tree: root,
    parentById
  };
}

function pruneCollapsedHeadingIds() {
  const validIds = new Set(state.headings.map((item) => item.id));
  let changed = false;
  [...state.collapsedHeadingIds].forEach((id) => {
    if (!validIds.has(id)) {
      state.collapsedHeadingIds.delete(id);
      changed = true;
    }
  });
  if (changed) {
    writeStoredHeadingSet(state.collapsedHeadingIds);
  }
}

function expandHeadingAncestors(anchor) {
  if (!anchor) {
    return;
  }
  let changed = false;
  let parentId = state.headingParentById.get(anchor) || "";
  while (parentId) {
    if (state.collapsedHeadingIds.has(parentId)) {
      state.collapsedHeadingIds.delete(parentId);
      changed = true;
    }
    parentId = state.headingParentById.get(parentId) || "";
  }
  if (changed) {
    writeStoredHeadingSet(state.collapsedHeadingIds);
  }
}

function toggleHeadingCollapse(anchorId) {
  if (state.collapsedHeadingIds.has(anchorId)) {
    state.collapsedHeadingIds.delete(anchorId);
  } else {
    state.collapsedHeadingIds.add(anchorId);
  }
  writeStoredHeadingSet(state.collapsedHeadingIds);
  renderTocTree();
}

function nodeContainsActiveAnchor(node, activeAnchor) {
  if (!activeAnchor) {
    return false;
  }
  if (node.id === activeAnchor) {
    return true;
  }
  return node.children.some((child) => nodeContainsActiveAnchor(child, activeAnchor));
}

function renderTocItems(nodes, parentList, activeAnchor) {
  nodes.forEach((node) => {
    const isCollapsed = state.collapsedHeadingIds.has(node.id);
    const isActive = node.id === activeAnchor;
    const isActivePath = nodeContainsActiveAnchor(node, activeAnchor);

    const item = document.createElement("li");
    item.className = "tocItem";
    item.dataset.level = String(node.level);
    if (isActivePath) {
      item.classList.add("isActivePath");
    }

    const row = document.createElement("div");
    row.className = "tocItemRow";

    if (node.children.length) {
      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "tocNodeToggle";
      toggleButton.textContent = isCollapsed ? "+" : "-";
      toggleButton.setAttribute("aria-label", isCollapsed ? `展开 ${node.text}` : `折叠 ${node.text}`);
      toggleButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleHeadingCollapse(node.id);
      });
      row.appendChild(toggleButton);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "tocNodeToggleSpacer";
      spacer.setAttribute("aria-hidden", "true");
      row.appendChild(spacer);
    }

    const anchor = document.createElement("a");
    anchor.href = `#${node.id}`;
    anchor.className = "tocLink";
    anchor.textContent = node.text;
    if (isActive) {
      anchor.classList.add("isActive");
    }
    if (isActivePath) {
      anchor.classList.add("isActivePath");
    }
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      history.replaceState(null, "", buildReaderHref(state.sourceUrl, node.id));
      scrollToAnchor(node.id, "smooth");
      syncActiveToc(node.id);
    });
    row.appendChild(anchor);
    item.appendChild(row);

    if (node.children.length && !isCollapsed) {
      const childList = document.createElement("ul");
      childList.className = "tocTree";
      renderTocItems(node.children, childList, activeAnchor);
      item.appendChild(childList);
    }

    parentList.appendChild(item);
  });
}

function renderTocTree() {
  els.tocNav.innerHTML = "";
  if (state.headings.length <= 1) {
    syncTocDockClasses({ persist: false });
    return;
  }

  const list = document.createElement("ul");
  list.className = "tocTree";
  renderTocItems(state.headingTree, list, state.anchor);
  els.tocNav.appendChild(list);
  syncTocDockClasses({ persist: false });
}

function buildTocFromHeadings() {
  clearToc();
  const contentRoot = getMarkdownContentRoot();
  if (!contentRoot) {
    return;
  }

  const headings = Array.from(contentRoot.querySelectorAll("h1, h2, h3, h4"))
    .map((heading) => ({
      id: heading.id,
      text: heading.textContent?.trim() || "",
      level: Number(heading.tagName.slice(1))
    }))
    .filter((item) => item.id && item.text);

  state.headings = headings;
  if (headings.length <= 1) {
    syncTocDockClasses({ persist: false });
    return;
  }

  const { tree, parentById } = buildHeadingTree(headings);
  state.headingTree = tree;
  state.headingParentById = parentById;
  pruneCollapsedHeadingIds();
  expandHeadingAncestors(state.anchor);
  renderTocTree();
}

function syncActiveToc(anchor) {
  if (anchor) {
    state.anchor = anchor;
  }
  expandHeadingAncestors(state.anchor);
  renderTocTree();
}

function toggleTocPinned() {
  if (state.headings.length <= 1) {
    return;
  }
  state.tocPinned = !state.tocPinned;
  if (state.tocPinned) {
    state.tocPeek = true;
    clearTimeout(tocPeekHideTimer);
  } else if (!els.tocFlyoutHost.matches(":hover")) {
    state.tocPeek = false;
  }
  syncTocDockClasses();
}

function assignHeadingIds() {
  const contentRoot = getMarkdownContentRoot();
  if (!contentRoot) {
    return;
  }

  const seen = new Map();
  const headings = contentRoot.querySelectorAll("h1, h2, h3, h4, h5, h6");
  headings.forEach((heading) => {
    const base = slugifyHeading(heading.textContent) || "section";
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    const nextId = count === 0 ? base : `${base}-${count + 1}`;
    heading.id = nextId;
    heading.dataset.anchorId = nextId;
  });
}

async function writeTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "true");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    helper.style.top = "0";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(helper);
    if (!copied) {
      throw new Error("execCommand copy failed");
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function setMarkdownCopyButtonState(button, state = "idle") {
  const isSuccess = state === "success";
  button.classList.toggle("isSuccess", isSuccess);
  button.setAttribute("aria-label", isSuccess ? "复制成功" : "复制代码块");
  button.title = isSuccess ? "复制成功" : "复制代码块";
  button.innerHTML = isSuccess ? CHECK_ICON_SVG : COPY_ICON_SVG;
}

function scheduleMarkdownCopyButtonReset(button, delayMs = 1200) {
  const existingTimer = markdownCopyButtonTimers.get(button);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }
  const timerId = window.setTimeout(() => {
    setMarkdownCopyButtonState(button, "idle");
    markdownCopyButtonTimers.delete(button);
  }, delayMs);
  markdownCopyButtonTimers.set(button, timerId);
}

function highlightMarkdownCodeBlocks() {
  const contentRoot = getMarkdownContentRoot();
  if (!contentRoot) {
    state.markdownCodeBlockCount = 0;
    return;
  }

  const blocks = contentRoot.querySelectorAll("pre code");
  state.markdownCodeBlockCount = blocks.length;
  blocks.forEach((code) => {
    const pre = code.closest("pre");
    if (!pre) {
      return;
    }

    const className = Array.from(code.classList).find((item) => item.startsWith("language-"));
    const rawLanguage = className ? className.replace(/^language-/, "") : "";
    const language = EXTENSION_TO_LANGUAGE[rawLanguage] || rawLanguage;
    const rawText = (code.textContent || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = rawText.split("\n");

    const wrapper = document.createElement("div");
    wrapper.className = "markdownCodeBlock";

    const toolbar = document.createElement("div");
    toolbar.className = "markdownCodeToolbar";

    if (rawLanguage) {
      const badge = document.createElement("span");
      badge.className = "markdownCodeLanguage";
      badge.textContent = rawLanguage;
      toolbar.appendChild(badge);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "markdownCodeLanguage markdownCodeLanguageEmpty";
      spacer.textContent = "代码块";
      toolbar.appendChild(spacer);
    }

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "markdownCodeCopyButton";
    setMarkdownCopyButtonState(copyButton, "idle");
    copyButton.addEventListener("click", async () => {
      const copied = await writeTextToClipboard(rawText);
      if (!copied) {
        setStatus("复制失败：当前环境不支持剪贴板写入。");
        return;
      }
      setStatus("已复制代码块。");
      setMarkdownCopyButtonState(copyButton, "success");
      scheduleMarkdownCopyButtonReset(copyButton);
    });
    toolbar.appendChild(copyButton);

    const body = document.createElement("div");
    body.className = "markdownCodeBody";
    body.innerHTML = lines.map((line, index) => `
      <div class="markdownCodeLine">
        <span class="markdownCodeLineNo">${index + 1}</span>
        <span class="markdownCodeLineCode"><code class="hljs">${highlightLine(line, language)}</code></span>
      </div>
    `).join("");

    wrapper.appendChild(toolbar);
    wrapper.appendChild(body);
    pre.replaceWith(wrapper);
  });
}

function resolveSourceRelativeUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || value.startsWith("#") || value.startsWith("/")) {
    return value;
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) {
    return value;
  }
  if (!state.sourceUrl) {
    return value;
  }
  try {
    return new URL(value, state.sourceUrl.href).href;
  } catch (_error) {
    return value;
  }
}

function rewriteMarkdownRelativeAssets() {
  const contentRoot = getMarkdownContentRoot();
  if (!contentRoot || !state.sourceUrl) {
    return;
  }

  contentRoot.querySelectorAll("img[src]").forEach((image) => {
    const rawSrc = image.getAttribute("src") || "";
    const resolvedSrc = resolveSourceRelativeUrl(rawSrc);
    if (resolvedSrc && resolvedSrc !== rawSrc) {
      image.setAttribute("src", resolvedSrc);
    }
  });

  contentRoot.querySelectorAll("a[href]").forEach((anchor) => {
    const rawHref = anchor.getAttribute("href") || "";
    const resolvedHref = resolveSourceRelativeUrl(rawHref);
    if (resolvedHref && resolvedHref !== rawHref) {
      anchor.setAttribute("href", resolvedHref);
    }
  });
}

function handleContentLinkClick(event) {
  const anchor = event.target.closest("a[href]");
  if (!anchor) {
    return;
  }
  const href = anchor.getAttribute("href") || "";
  if (!href) {
    return;
  }
  if (href.startsWith("#")) {
    event.preventDefault();
    const nextAnchor = decodeURIComponent(href.slice(1));
    history.replaceState(null, "", buildReaderHref(state.sourceUrl, nextAnchor));
    scrollToAnchor(nextAnchor, "smooth");
    syncActiveToc(nextAnchor);
    return;
  }

  let resolved;
  try {
    resolved = new URL(href, state.sourceUrl.href);
  } catch (_error) {
    return;
  }

  if (resolved.origin !== window.location.origin) {
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    return;
  }

  const nextAnchor = decodeURIComponent(resolved.hash.replace(/^#/, ""));
  resolved.hash = "";
  if (isTextualPath(resolved.pathname)) {
    event.preventDefault();
    const preserveView = state.viewMode === "source" && MARKDOWN_EXTENSIONS.has(getExtension(resolved.pathname))
      ? "source"
      : "";
    replaceReaderLocation(resolved, nextAnchor, preserveView);
    return;
  }

  anchor.target = "_blank";
  anchor.rel = "noreferrer";
}

function formatJsonText(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (_error) {
    return text;
  }
}

function highlightLine(line, language) {
  if (!line) {
    return "&nbsp;";
  }
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(line, { language, ignoreIllegals: true }).value || "&nbsp;";
    } catch (_error) {
      return escapeHtml(line);
    }
  }
  return escapeHtml(line);
}

function renderSourceContent(text, language, label) {
  state.markdownCodeBlockCount = 0;
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const renderedLines = lines.map((line, index) => `
    <div class="sourceLine">
      <span class="sourceLineNo">${index + 1}</span>
      <span class="sourceLineCode"><code class="hljs">${highlightLine(line, language)}</code></span>
    </div>
  `).join("");

  els.contentHost.className = "contentHost sourceMode";
  els.contentHost.innerHTML = `
    <section class="sourceViewer">
      <div class="sourceHeader">
        <span>${label}</span>
        <span>${lines.length} 行</span>
      </div>
      <div class="sourceLines">${renderedLines}</div>
    </section>
  `;
  applyLineNumberVisibility();
}

function applyLineNumberVisibility() {
  els.contentHost.classList.toggle("hideLineNumbers", !state.lineNumbersEnabled);
}

function renderMarkdown(text) {
  const rendered = marked.parse(text);
  const safeHtml = DOMPurify.sanitize(rendered);
  els.contentHost.className = "contentHost markdownMode";
  els.contentHost.innerHTML = `
    <div class="markdownViewport">
      <div class="markdownArticle markdown-body">${safeHtml}</div>
    </div>
  `;
  rewriteMarkdownRelativeAssets();
  assignHeadingIds();
  highlightMarkdownCodeBlocks();
  applyLineNumberVisibility();
  buildTocFromHeadings();
  if (state.anchor) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToAnchor(state.anchor, "auto");
        syncActiveToc(state.anchor);
      });
    });
  }
}

function renderCurrentDocument() {
  clearToc();
  showSection("content");

  const displayMode = getDisplayModeForExtension(state.sourceExt);
  const actualMode = displayMode === "markdown" && state.viewMode === "source" ? "source" : displayMode;
  state.lastRenderKind = actualMode;
  setModeBadge(displayMode === "markdown" && state.viewMode === "source" ? "Markdown 源码" : `${humanizeKind(displayMode)} · .${state.sourceExt}`);

  if (actualMode === "markdown") {
    renderMarkdown(state.rawText);
    setStatus(`已渲染 Markdown 文档，共 ${state.rawText.length} 个字符。`);
  } else if (actualMode === "json") {
    const pretty = formatJsonText(state.rawText);
    renderSourceContent(pretty, "json", "JSON 阅读模式");
    setStatus(`已格式化 JSON，共 ${pretty.length} 个字符。`);
  } else {
    const language = EXTENSION_TO_LANGUAGE[state.sourceExt] || "plaintext";
    renderSourceContent(state.rawText, language, `${state.sourceExt.toUpperCase() || "TEXT"} 源码阅读模式`);
    setStatus(`已载入源码文本，共 ${state.rawText.length} 个字符。`);
  }

  updateActionButtons();
  els.contentHost.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.addEventListener("click", handleContentLinkClick);
  });
}

async function loadDocument() {
  const request = normalizeSourceRequest();
  closeAllReaderMenus();
  if (!request.sourceValue) {
    state.sourceUrl = null;
    state.sourcePath = "";
    state.sourceExt = "";
    state.rawText = "";
    state.anchor = "";
    state.viewMode = "rendered";
    state.lastRenderKind = "empty";
    setHeader(null, "");
    setStatus("请通过 src 参数指定要阅读的文件。");
    updateActionButtons();
    clearToc();
    showSection("empty");
    return;
  }

  let resolvedUrl;
  try {
    resolvedUrl = resolveSourceUrl(request.sourceValue);
  } catch (error) {
    showError(`无法解析目标文件路径：${error.message}`);
    return;
  }

  if (!resolvedUrl || resolvedUrl.origin !== window.location.origin) {
    showError("当前阅读器仅支持读取同源项目内文件。");
    return;
  }

  const ext = getExtension(resolvedUrl.pathname);
  if (!TEXTUAL_EXTENSIONS.has(ext)) {
    showError(`当前文件类型 .${ext || "unknown"} 不适合在线阅读，请使用“打开原文件”查看。`);
    state.sourceUrl = resolvedUrl;
    state.sourceExt = ext;
    state.rawText = "";
    state.anchor = request.anchor;
    setHeader(resolvedUrl, ext);
    clearToc();
    updateActionButtons();
    return;
  }

  state.sourceUrl = resolvedUrl;
  state.sourcePath = resolvedUrl.pathname;
  state.sourceExt = ext;
  state.anchor = request.anchor;
  state.rawText = "";
  state.viewMode = request.requestedView === "source" ? "source" : "rendered";
  state.lastRenderKind = "loading";
  setHeader(resolvedUrl, ext);
  clearToc();
  updateActionButtons();
  setStatus("正在载入文件...");
  showSection("content");
  els.contentHost.className = "contentHost";
  els.contentHost.innerHTML = "";

  try {
    const response = await fetch(resolvedUrl.href, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.contentType = response.headers.get("content-type") || "";
    state.rawText = await response.text();
    renderCurrentDocument();
  } catch (error) {
    showError(`读取文件失败：${error.message}`);
  }
}

function showError(message) {
  state.rawText = "";
  state.lastRenderKind = "error";
  clearToc();
  els.errorMessage.textContent = message;
  setStatus(message);
  showSection("error");
  updateActionButtons();
}

async function copyCurrentContent() {
  const payload = getCopyPayload();
  if (!payload.text) {
    return;
  }
  const copied = await writeTextToClipboard(payload.text);
  if (copied) {
    setStatus(`已复制${payload.label}。`);
    return;
  }
  setStatus("复制失败：当前环境不支持剪贴板写入。");
}

function handleThemeModeChange() {
  state.themeMode = els.themeSelect.value === "dark" || els.themeSelect.value === "light"
    ? els.themeSelect.value
    : "system";
  writeStoredValue(STORAGE_KEYS.themeMode, state.themeMode);
  applyTheme();
}

function openCurrentSourceInBrowser() {
  if (!state.sourceUrl) {
    return;
  }
  openCurrentRawFile();
}

function toggleLineNumbers() {
  state.lineNumbersEnabled = !state.lineNumbersEnabled;
  writeStoredBoolean(STORAGE_KEYS.lineNumbersEnabled, state.lineNumbersEnabled);
  if (
    state.lastRenderKind === "json"
    || state.lastRenderKind === "source"
    || state.lastRenderKind === "markdown"
  ) {
    applyLineNumberVisibility();
  }
  updateActionButtons();
}

function reloadCurrentDocument() {
  setStatus("正在重新加载文件...");
  void loadDocument();
}

function openCurrentRawFile() {
  const href = els.openRawLink.href;
  if (!href || els.openRawLink.classList.contains("isDisabled")) {
    return;
  }
  window.open(href, "_blank", "noopener");
}

function bindEvents() {
  els.reloadButton.addEventListener("click", () => {
    closeAllReaderMenus();
    reloadCurrentDocument();
  });
  els.themeSelect.addEventListener("change", handleThemeModeChange);
  els.actionsMenu.addEventListener("toggle", () => {
    els.actionsMenuButton.setAttribute("aria-expanded", els.actionsMenu.open ? "true" : "false");
  });
  els.tocFlyoutHost.addEventListener("mouseenter", () => {
    showTocPeek();
  });
  els.tocFlyoutHost.addEventListener("mouseleave", () => {
    scheduleTocPeekHide();
  });
  els.tocEdgeHoverZone.addEventListener("mouseenter", () => {
    showTocPeek();
  });
  els.tocPinButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTocPinned();
  });
  els.lineNumbersButton.addEventListener("click", () => {
    closeAllReaderMenus();
    toggleLineNumbers();
  });
  els.copyButton.addEventListener("click", () => {
    closeAllReaderMenus();
    void copyCurrentContent();
  });
  els.toggleViewButton.addEventListener("click", () => {
    closeAllReaderMenus();
    openCurrentSourceInBrowser();
  });
  els.openRawLink.addEventListener("click", (event) => {
    event.preventDefault();
    closeAllReaderMenus();
    openCurrentRawFile();
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      const targetElement = event.target instanceof Element ? event.target : null;
      const targetNode = event.target instanceof Node ? event.target : null;
      if (!targetElement?.closest(".readerTopMenubar")) {
        closeAllReaderMenus();
      }
      if (!state.tocPinned && (!targetNode || !els.tocFlyoutHost.contains(targetNode))) {
        hideTocPeekImmediately();
      }
    },
    true
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllReaderMenus();
      hideTocPeekImmediately();
    }
  });
  if (SYSTEM_THEME_QUERY) {
    const onSystemThemeChange = () => {
      if (state.themeMode === "system") {
        applyTheme();
      }
    };
    if (typeof SYSTEM_THEME_QUERY.addEventListener === "function") {
      SYSTEM_THEME_QUERY.addEventListener("change", onSystemThemeChange);
    } else if (typeof SYSTEM_THEME_QUERY.addListener === "function") {
      SYSTEM_THEME_QUERY.addListener(onSystemThemeChange);
    }
  }
}

initializePreferences();
bindEvents();
void loadDocument();
