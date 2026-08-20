/**
 * ThreeBox — AI scene workbench, built on the published @threejson/* packages, reproducing the
 * original tools/scene-host/threebox UI faithfully (same DOM structure + verbatim threebox.css).
 *
 *   @threejson/host-kit → AI turn orchestration, built-in trial provider, privacy gate, session store
 *   @threejson/react    → useHostI18n, useConversations
 *   threejson           → the engine (createJsonScene per scene card), envelope building, .tjz
 *
 * The chrome (left dock, hero, composer, modals) mirrors the original's markup so the same CSS
 * applies, and each generated scene renders in its own live canvas inside its chat card
 * (SceneCard.jsx), exactly as the original does — there is no shared viewport.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHostI18n } from "@threejson/react/i18n";
import { useSceneConversations } from "@threejson/react-scene-agent/conversations";
import {
  runSceneAgentGenerateTurn as runAiGenerateTurn,
  runSceneAgentAdjustTurn as runAiAdjustTurn,
  negotiateSceneAgentTurn,
  resolveSceneAgentAdjustContext as resolveAiAdjustContextPayload,
  buildSceneAgentResultDigest as buildResultDigest,
  runSceneAgentTitle as runAiSceneTitle,
  runSceneAgentSummary as runAiTurnSummary,
  reconstructSceneAgentTurn,
  createSceneAgentTurnContext,
  projectSceneAgentJsonString,
  isProviderVisionCapable
} from "@threejson/scene-agent-kit/controller";
import { resolveSceneAgentOptions, resolveSceneAgentTokenOptions } from "@threejson/scene-agent-kit/settings";
import { createUnsuccessfulTurnRecord, isUnsuccessfulTurn } from "@threejson/scene-agent-kit/turn-state";
import { buildStructuredTurnEnvelope } from "threejson/ai";
import { getAiErrorFeedback } from "@threejson/host-kit/js/aiErrorFeedback.js";
import { resolveSceneHostUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import {
  sceneAgentRepository,
  getAllProjects,
  putProject,
  createProjectId,
  createTurnId,
  getTurn,
  putTurn,
  getConversation,
  putConversation
} from "./lib/sceneAgentRepository.js";
import { normalizeLocale, t } from "@threejson/host-kit/i18n/index.js";
import { BUILTIN_PROVIDER_TYPE, getDisplayDeviceId } from "@threejson/host-kit/js/builtinAiProvider.js";
import { formatAgentProgressLabel } from "@threejson/host-kit/js/aiAgentProgressLabels.js";
import { findChangedTextureObjectIds, runHostSceneTexturePipeline } from "@threejson/host-kit/js/sceneTextureOrchestrator.js";
import { createTextureProxyUrl } from "@threejson/host-kit/js/textureProviderClient.js";
import { getCachedTextureBlob, putCachedTextureBlob } from "@threejson/host-kit/js/browserTextureCache.js";
import { renderMarkdownToSafeHtml } from "./lib/markdown.js";
import { useAiProvider } from "./useAiProvider.js";
import { useResources } from "./useResources.js";
import {
  useThreeBoxSettings,
  getThreeBoxSettings,
  setThreeBoxSettings,
  threeBoxSettingsController,
  updateThreeBoxSettings
} from "./useThreeBoxSettings.js";
import { cloneThreeBoxSettings } from "./lib/threeBoxSettingsStore.js";
import { ensureBuiltinApiKey } from "./lib/threeBoxBuiltinProvider.js";
import { createThreeBoxBuiltinNotifications } from "./lib/threeBoxBuiltinNotifications.js";
import { requestBuiltinNotificationConsent } from "./lib/threeBoxBuiltinNotificationConsentDialog.js";
import { createThreeBoxSelfHostedSync } from "./lib/threeBoxSelfHostedSync.js";
import { createThreeBoxCloudMigration } from "./lib/threeBoxCloudMigration.js";

// Optional self-hosted sync — a module singleton (its settingsProvider reads live via
// getThreeBoxSettings), shared by the post-turn scheduleSync and the settings "立即同步" button.
const selfHostedSync = createThreeBoxSelfHostedSync(getThreeBoxSettings);
import { PrivacyDialog } from "./PrivacyDialog.jsx";
import { SettingsModal } from "./SettingsModal.jsx";
import { SceneAgentSceneCard } from "@threejson/react-scene-agent/scene-card";
import { openThreeBoxMeshExportDialog, showThreeBoxMeshExportWarningDialog } from "./lib/threeBoxMeshExportDialog.js";
import { openSceneInEditor, openSceneInPlayer, THREEBOX_PEER_URLS } from "./sceneBridgeProtocol.js";
import { JsonCollapse, SceneJsonCollapse, AdjustDiffCollapse } from "./JsonCollapse.jsx";
import { useAttachedContext } from "./useAttachedContext.js";
import { AttachedContextRow } from "./AttachedContextRow.jsx";
import { useComposerAttach, ATTACH_KIND_ORDER } from "./useComposerAttach.js";
import { TemplateCard } from "./TemplateCard.jsx";
import { AiErrorFeedback } from "./AiErrorFeedback.jsx";

/**
 * Ported from threeBoxApp.js's createAgentProgressUpdater. Shows the current stage in the existing
 * compact spinning activity block; `{kind:"stream", previewDelta}` progress is appended as raw
 * stream text. When a draft scene arrives (`stage_preview`/`scene_ready` with a
 * sceneJsonString), `onScenePreview` renders it into the card so the user watches the scene build up.
 */
function createAgentProgressUpdater(setStream, onScenePreview) {
  let streamBuffer = "";
  return (progress) => {
    if (!progress) {
      return;
    }
    if (progress.kind === "stream" && progress.previewDelta) {
      streamBuffer += progress.previewDelta;
      setStream(streamBuffer);
      return;
    }
    if (
      typeof onScenePreview === "function" &&
      typeof progress.sceneJsonString === "string" &&
      (progress.kind === "stage_preview" || progress.kind === "scene_ready")
    ) {
      onScenePreview(progress.sceneJsonString, progress);
    }
    // core/ai/sceneAgent.js's progress messages are plain English — always run `kind` through the
    // shared localized-label mapping instead of showing progress.message directly (see
    // aiAgentProgressLabels.js and threeBoxApp.js's matching fix).
    const label = formatAgentProgressLabel(progress, t);
    if (!label) {
      return;
    }
    setStream(label);
  };
}

/** Ported from threeBoxApp.js's buildAgentProcessSummary — a compact markdown recap of the agent's
 * steps, appended to the assistant message when the agent actually ran. */
function buildAgentProcessSummary(agentResult, heading, budgetMessage) {
  if (!agentResult?.agentUsed || !Array.isArray(agentResult.steps)) {
    return "";
  }
  const noteworthy =
    agentResult.completed === false ||
    agentResult.steps.some((step) =>
      step.ok === false ||
      /(?:repair|fallback|budget)/i.test(String(step.kind || "")) ||
      (step.kind === "capability_review" && step.attempt)
    );
  if (!noteworthy) {
    return "";
  }
  const lines = agentResult.steps.slice(0, 10).map((step, index) => {
    const kind = step.kind || "step";
    const state = step.ok === false ? "failed" : "ok";
    const extra = step.error ? `: ${step.error}` : step.count != null ? ` (${step.count})` : "";
    return `${index + 1}. ${kind} - ${state}${extra}`;
  });
  if (agentResult.completed === false && agentResult.stopReason === "budget_exhausted") {
    lines.unshift(budgetMessage);
  }
  const more =
    agentResult.steps.length > lines.length ? `\n... ${agentResult.steps.length - lines.length} more step(s)` : "";
  return [`**${heading}**`, ...lines, more].filter(Boolean).join("\n");
}

const TEMPLATE_MANIFEST = "assets/json/other/threebox/manifest.json";
const LOGO_URL = resolveSceneHostUrl("assets/img/logo/threejson-logo-256.png");
const LEFT_DOCK_PINNED_STORAGE_KEY = "threejson.threebox.leftDockPinned";
const TEMPLATE_GALLERY_EXPANDED_STORAGE_KEY = "threejson.threebox.templateGalleryExpanded";
const MOBILE_MEDIA_QUERY = "(max-width: 720px)";

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia?.(MOBILE_MEDIA_QUERY).matches;
}

function readStoredBoolean(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function formatRelativeTime(timestamp, zh) {
  const age = Math.max(0, Date.now() - Number(timestamp || 0));
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (age < minute) return zh ? "刚刚" : "Just now";
  if (age < hour) {
    const count = Math.floor(age / minute);
    return zh ? `${count} 分钟前` : `${count} min ago`;
  }
  if (age < day) {
    const count = Math.floor(age / hour);
    return zh ? `${count} 小时前` : `${count} hr ago`;
  }
  if (age < 7 * day) {
    const count = Math.floor(age / day);
    return zh ? `${count} 天前` : `${count} d ago`;
  }
  return new Date(timestamp).toLocaleDateString(zh ? "zh-CN" : "en-US");
}

function formatFileSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** Hero suggestion chips, matching the original's data-prompt / data-prompt-en. */
const HERO_SUGGESTIONS = [
  { zh: "添加一个立方体", en: "Add a cube", promptZh: "创建一个蓝色的立方体", promptEn: "Create a blue cube" },
  {
    zh: "智慧园区场景",
    en: "Smart campus",
    promptZh: "一个智慧园区场景，包含建筑、道路和绿化",
    promptEn: "A smart campus scene with buildings, roads, and greenery"
  },
  {
    zh: "数据中心机房",
    en: "Data center room",
    promptZh: "一个数据中心机房，包含多排机柜",
    promptEn: "A data center room with multiple rows of server racks"
  }
];

const RESOURCE_CATEGORIES = [
  ["all", "全部", "All"],
  ["json", "ThreeJSON", "ThreeJSON"],
  ["tjz", ".tjz", ".tjz"],
  ["model", "三方模型", "Model"],
  ["image", "图片", "Image"],
  ["other", "其他", "Other"]
];

function ResourceIcon({ kind }) {
  if (kind === "tjz") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" /><path fill="none" stroke="currentColor" strokeWidth="1.1" d="M8 3v10" /></svg>;
  }
  if (kind === "model") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" d="M8 2 14 5.5v5L8 14 2 10.5v-5z" /><path fill="none" stroke="currentColor" strokeWidth="1" d="M2 5.5 8 9l6-3.5M8 9v5" /></svg>;
  }
  if (kind === "image") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="5.6" cy="6.6" r="1.1" fill="currentColor" /><path fill="none" stroke="currentColor" strokeWidth="1.1" d="m3 11.5 3.3-3.3 2.3 2.1L12.5 7 14 8.5" /></svg>;
  }
  if (kind === "json") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.2" d="M3 2h7l3 3v9H3z" /><path fill="none" stroke="currentColor" strokeWidth="1.1" d="M6 8.5h4M6 10.8h4" /></svg>;
  }
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.2" d="M4 2h5l3 3v9H4z" /></svg>;
}

export function App() {
  const { locale, setLocale } = useHostI18n();
  const zh = locale !== "en-US";
  const L = (cn, en) => (zh ? cn : en);
  const provider = useAiProvider();
  const settings = useThreeBoxSettings();

  // Apply the persisted UI-language preference: "auto" leaves whatever the browser resolved to,
  // "zh-CN"/"en-US" force that locale (matching the original's general.locale setting).
  const localeSetting = settings.general.locale;
  useEffect(() => { document.documentElement.lang = zh ? "zh-CN" : "en"; }, [zh]);
  useEffect(() => {
    if (localeSetting === "zh-CN" || localeSetting === "en-US") {
      setLocale(localeSetting);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localeSetting]);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search || "").get("lang")
      || new URLSearchParams(window.location.search || "").get("locale")
      || "";
    if (!raw) return;
    const requested = normalizeLocale(raw);
    if (!["zh-CN", "en-US"].includes(localeSetting) || requested === localeSetting) return;
    const name = (value, language) => value === "zh-CN"
      ? language === "zh-CN" ? "中文" : "Chinese"
      : language === "zh-CN" ? "英文" : "English";
    const accepted = window.confirm([
      `官网当前为${name(requested, "zh-CN")}，但 ThreeBox 当前为${name(localeSetting, "zh-CN")}。是否将 ThreeBox 切换为${name(requested, "zh-CN")}？`,
      "",
      `The website is currently in ${name(requested, "en-US")}, but ThreeBox is currently in ${name(localeSetting, "en-US")}. Switch ThreeBox to ${name(requested, "en-US")}?`
    ].join("\n"));
    if (accepted) updateThreeBoxSettings((next) => { next.general.locale = requested; });
    // URL hand-off is evaluated once at boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The composer's model picker chooses among the saved providers; default to the configured
  // default provider, falling back to the first available.
  const providers = settings.ai.providers || [];
  const selectableProviders = useMemo(
    () => providers.filter((entry) => entry.provider !== BUILTIN_PROVIDER_TYPE || provider.privacyAccepted),
    [providers, provider.privacyAccepted]
  );
  const [selectedProviderId, setSelectedProviderId] = useState(settings.ai.defaultProviderId || "");
  useEffect(() => {
    if (!selectableProviders.some((p) => p.id === selectedProviderId)) {
      const configuredDefault = selectableProviders.find((p) => p.id === settings.ai.defaultProviderId);
      setSelectedProviderId(configuredDefault?.id || selectableProviders[0]?.id || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ai.providers, settings.ai.defaultProviderId, provider.privacyAccepted]);

  // Dev-only: adopt a gitignored settings.test.json as a saved provider so the generate/adjust
  // loops can be exercised against a real model locally. Its credentials are served by a dev-server
  // middleware at request time (never bundled) and routed through the Vite proxy (LLM APIs block
  // browser CORS — see vite.config.js). Production builds have neither the endpoint nor the proxy.
  useEffect(() => {
    if (!import.meta.env?.DEV) {
      return;
    }
    let cancelled = false;
    void fetch("/__ai-test-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled || !s?.apiKey) {
          return;
        }
        const DEV_ID = "dev-test-provider";
        const next = cloneThreeBoxSettings(getThreeBoxSettings());
        const entry = {
          id: DEV_ID,
          label: `Dev · ${s.provider || "deepseek"} (settings.test.json)`,
          provider: s.provider || "deepseek",
          baseUrl: "/ai-test-proxy",
          apiKey: s.apiKey,
          model: s.model || ""
        };
        const rest = (next.ai.providers || []).filter((p) => p.id !== DEV_ID);
        next.ai.providers = [entry, ...rest];
        next.ai.defaultProviderId = DEV_ID;
        setThreeBoxSettings(next);
        setSelectedProviderId(DEV_ID);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Include archived so the dock can render the separate "已归档" section (they're filtered out of
  // the main list below).
  const history = useSceneConversations({ repository: sceneAgentRepository, includeArchived: true });
  const resources = useResources();

  const [projects, setProjects] = useState([]);
  const [historyMenu, setHistoryMenu] = useState(null); // { conv, x, y }

  useEffect(() => {
    if (typeof indexedDB === "undefined") {
      return;
    }
    void getAllProjects().then((list) => setProjects(Array.isArray(list) ? list : []));
  }, []);

  // Issue/refresh the built-in trial key + quota at boot (a no-op until the privacy agreement is
  // accepted; written into the ai.providers[builtin] entry). Not awaited — never blocks first paint.
  useEffect(() => {
    void ensureBuiltinApiKey(threeBoxSettingsController, {
      onUnavailable: () => setToast({
        text: L("内置供应商无法访问，请配置供应商。", "The built-in provider is unavailable; configure another provider."),
        kind: "info"
      })
    });
    // Boot-only availability notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Device-scoped built-in notifications: a raw-DOM bell+panel widget with its own polling
  // lifecycle, created once and torn down on unmount (poll() no-ops unless enabled + a trial key
  // exists). It reads settings live via getThreeBoxSettings.
  const notificationsRef = useRef(null);
  useEffect(() => {
    const instance = createThreeBoxBuiltinNotifications(getThreeBoxSettings);
    notificationsRef.current = instance;
    instance.start();
    return () => {
      instance.stop();
      notificationsRef.current = null;
    };
  }, []);
  // Re-poll whenever the enable toggle flips so the bell reflects the new state promptly.
  useEffect(() => {
    void notificationsRef.current?.refresh();
  }, [settings.general.builtinNotificationsEnabled]);

  // One-time consent prompt: after the built-in privacy agreement is accepted and no notification
  // decision has been recorded yet, ask once and persist the choice (matching the original's boot
  // flow). `provider.privacyAccepted` comes from useAiProvider.
  const notifDecisionMade = settings.general.builtinNotificationsDecisionMade;
  useEffect(() => {
    if (!provider.privacyAccepted || notifDecisionMade) {
      return;
    }
    let cancelled = false;
    void requestBuiltinNotificationConsent().then((enabled) => {
      if (cancelled) {
        return;
      }
      updateThreeBoxSettings((next) => {
        next.general.builtinNotificationsEnabled = enabled;
        next.general.builtinNotificationsDecisionMade = true;
      });
      void notificationsRef.current?.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [provider.privacyAccepted, notifDecisionMade]);

  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyStoppable, setBusyStoppable] = useState(false);
  const [stream, setStream] = useState("");
  const [activeAssistantId, setActiveAssistantId] = useState(null);
  const [shownSceneJson, setShownSceneJson] = useState(null);
  const [shownTurnId, setShownTurnId] = useState(null);
  const shownTurnIdRef = useRef(null);
  useEffect(() => {
    shownTurnIdRef.current = shownTurnId;
  }, [shownTurnId]);
  const [modeOverride, setModeOverride] = useState(null);

  // Chrome state.
  const [sidebarPinned, setSidebarPinned] = useState(() => (
    isMobileViewport() ? false : readStoredBoolean(LEFT_DOCK_PINNED_STORAGE_KEY, true)
  ));
  const [mobilePeek, setMobilePeek] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState("general");
  const [showPrivacy, setShowPrivacy] = useState(false);

  const openSettings = useCallback((section = "general") => {
    setSettingsSection(section);
    setShowSettings(true);
  }, []);

  const [showSearch, setShowSearch] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [resourceCategory, setResourceCategory] = useState("all");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateGalleryExpanded, setTemplateGalleryExpanded] = useState(() =>
    readStoredBoolean(TEMPLATE_GALLERY_EXPANDED_STORAGE_KEY, false)
  );
  const [templates, setTemplates] = useState([]);
  const [templateBusyId, setTemplateBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const abortRef = useRef(null);
  const activeOutputStreamIdRef = useRef("");
  const rawOutputRef = useRef("");
  const messagesEndRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const leftDockRef = useRef(null);
  const mobileMenuBtnRef = useRef(null);
  const userMenuRef = useRef(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const composerRef = useRef(null);
  const peekHideTimer = useRef(null);
  const sceneCardsByMessageIdRef = useRef(new Map());
  const sceneCardWaitersRef = useRef(new Map());
  const textureJobsByTurnIdRef = useRef(new Map());
  const turnMutationQueuesRef = useRef(new Map());

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(200, textarea.scrollHeight)}px`;
  }, [prompt]);

  const registerSceneCard = useCallback((messageId, card) => {
    if (!card) {
      sceneCardsByMessageIdRef.current.delete(messageId);
      return;
    }
    sceneCardsByMessageIdRef.current.set(messageId, card);
    const waiters = sceneCardWaitersRef.current.get(messageId) || [];
    sceneCardWaitersRef.current.delete(messageId);
    for (const resolve of waiters) resolve(card);
  }, []);

  const waitForSceneCard = useCallback((messageId, timeoutMs = 3000) => {
    const existing = sceneCardsByMessageIdRef.current.get(messageId);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const waiters = sceneCardWaitersRef.current.get(messageId) || [];
      const finish = (card) => {
        clearTimeout(timer);
        resolve(card || null);
      };
      waiters.push(finish);
      sceneCardWaitersRef.current.set(messageId, waiters);
      const timer = window.setTimeout(() => {
        const current = sceneCardWaitersRef.current.get(messageId) || [];
        sceneCardWaitersRef.current.set(messageId, current.filter((entry) => entry !== finish));
        finish(null);
      }, timeoutMs);
    });
  }, []);

  useEffect(() => () => {
    for (const controller of textureJobsByTurnIdRef.current.values()) controller.abort();
    textureJobsByTurnIdRef.current.clear();
    sceneCardWaitersRef.current.clear();
  }, []);

  // Desktop hover-peek: when the dock is unpinned, hovering the left edge/flyout reveals it and
  // moving away hides it after a short delay (matching the original's leftFlyoutHost mouseenter/
  // mouseleave). Touch devices don't fire hover, so this is naturally desktop-only.
  const onFlyoutEnter = useCallback(() => {
    if (sidebarPinned || isMobileViewport()) {
      return;
    }
    clearTimeout(peekHideTimer.current);
    setMobilePeek(true);
  }, [sidebarPinned]);
  const onFlyoutLeave = useCallback(() => {
    if (sidebarPinned || isMobileViewport()) {
      return;
    }
    clearTimeout(peekHideTimer.current);
    peekHideTimer.current = setTimeout(() => setMobilePeek(false), 220);
  }, [sidebarPinned]);

  const closeLeftDock = useCallback(() => {
    if (sidebarPinned && !isMobileViewport()) return;
    clearTimeout(peekHideTimer.current);
    setMobilePeek(false);
  }, [sidebarPinned]);

  useEffect(() => {
    if (!isMobileViewport()) {
      try {
        localStorage.setItem(LEFT_DOCK_PINNED_STORAGE_KEY, sidebarPinned ? "1" : "0");
      } catch {
        /* storage may be unavailable */
      }
    }
    window.dispatchEvent(new Event("resize"));
  }, [sidebarPinned, mobilePeek]);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleChange = () => {
      if (query.matches) {
        setSidebarPinned(false);
        setMobilePeek(false);
      } else {
        setSidebarPinned(readStoredBoolean(LEFT_DOCK_PINNED_STORAGE_KEY, true));
        setMobilePeek(false);
      }
      window.dispatchEvent(new Event("resize"));
    };
    query.addEventListener?.("change", handleChange);
    return () => query.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (mobileMenuBtnRef.current?.contains(event.target)) return;
      if (!sidebarPinned && leftDockRef.current && !leftDockRef.current.contains(event.target)) {
        setMobilePeek(false);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeLeftDock();
        setUserMenuOpen(false);
        setShowSearch(false);
        setShowHelp(false);
        setShowSettings(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarPinned, userMenuOpen, closeLeftDock]);

  const refreshScrollButton = useCallback(() => {
    const node = chatMessagesRef.current;
    if (!node) return;
    setShowScrollToBottom(node.scrollHeight - node.scrollTop - node.clientHeight > 72);
  }, []);

  const scrollToBottom = useCallback((behavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior });
    setShowScrollToBottom(false);
  }, []);

  const pinMessageNearTop = useCallback((messageId) => {
    window.setTimeout(() => {
      const container = chatMessagesRef.current;
      const row = container?.querySelector?.(`[data-message-id="${CSS.escape(String(messageId))}"]`);
      if (!container || !row) return;
      container.scrollTo({ top: Math.max(0, row.offsetTop - 14), behavior: "smooth" });
    }, 0);
  }, []);

  useEffect(() => {
    if (!busy) scrollToBottom("auto");
  }, [busy, scrollToBottom]);

  useEffect(() => {
    refreshScrollButton();
    if (busy && activeAssistantId) {
      const container = chatMessagesRef.current;
      const row = container?.querySelector?.(`[data-message-id="${CSS.escape(String(activeAssistantId))}"]`);
      row?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    }
  }, [messages, stream, busy, activeAssistantId, refreshScrollButton]);

  // Template manifest (rendered into the sidebar's template-gallery section, like the original).
  useEffect(() => {
    let cancelled = false;
    fetch(resolveSceneHostUrl(TEMPLATE_MANIFEST))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) {
          setTemplates(Array.isArray(data?.items) ? data.items : []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const showToast = useCallback((text, kind = "info") => setToast({ text, kind }), []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.general.theme === "light" ? "light" : "dark";
  }, [settings.general.theme]);

  useEffect(() => {
    if (!provider.privacyDecided) setShowPrivacy(true);
  }, [provider.privacyDecided]);

  useEffect(() => {
    if (String(settings.general.assetGatewayUrl || "").trim()) return;
    const hasBuiltin = settings.ai.providers?.some((entry) => entry.provider === BUILTIN_PROVIDER_TYPE);
    if (!hasBuiltin || !String(settings.ai.builtinBackendUrl || "").trim()) return;
    updateThreeBoxSettings((next) => {
      if (!String(next.general.assetGatewayUrl || "").trim()) {
        next.general.assetGatewayUrl = String(next.ai.builtinBackendUrl || "").trim();
      }
    });
  }, [settings.general.assetGatewayUrl, settings.ai.providers, settings.ai.builtinBackendUrl]);

  useEffect(() => {
    if (!selfHostedSync.isConfigured()) return;
    let cancelled = false;
    void selfHostedSync.syncNow()
      .then(() => { if (!cancelled) return history.refresh(); })
      .catch((error) => console.warn("[threebox-react] initial self-hosted sync failed:", error));
    return () => { cancelled = true; };
    // Synchronize once on boot; subsequent local mutations use scheduleSync().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const append = useCallback((msg) => setMessages((prev) => [...prev, msg]), []);

  /** Patch a message in place by id (used to fill in the async scene title / recap after the card
   * has already rendered — the original never blocks the visible card on those AI round-trips). */
  const updateMessage = useCallback(
    (id, patch) => setMessages((prev) => prev.map((m) => {
      if (m.id !== id) return m;
      const resolvedPatch = typeof patch === "function" ? patch(m) : patch;
      return resolvedPatch ? { ...m, ...resolvedPatch } : m;
    })),
    []
  );

  // Human-readable language name for the recap/title AI prompts (core/ai's `responseLanguage`),
  // matching the original's resolveSummaryResponseLanguage / resolveSceneTitleLanguage.
  const summaryResponseLanguage = zh ? "Simplified Chinese" : "English";
  const resolveTitleLanguage = () => {
    const pref = settings.ai.sceneTitleLanguage || "auto";
    if (pref === "zh-CN") return "Simplified Chinese";
    if (pref === "en-US") return "English";
    return summaryResponseLanguage;
  };

  // Attached-scene context row above the composer (a template/resource/upload consumed as context
  // for the next message). Which provider is active drives the image-upload vision gate.
  const attachedContext = useAttachedContext();
  const [attachMenuPos, setAttachMenuPos] = useState(null); // { x, y } for the attach-type menu

  const activeProvider = useMemo(() => {
    const list = selectableProviders;
    return (
      list.find((p) => p.id === selectedProviderId) ||
      list.find((p) => p.id === settings.ai.defaultProviderId) ||
      list[0] ||
      null
    );
  }, [selectableProviders, settings.ai.defaultProviderId, selectedProviderId]);

  const composerAttach = useComposerAttach({
    attachedContext,
    showToast,
    onResourceAdded: () => void resources.refresh(),
    getVisionCapable: () => isProviderVisionCapable({ provider: activeProvider?.provider })
  });

  const resolveTextureServiceSettings = useCallback((bundle = getThreeBoxSettings()) => {
    const customUrl = String(bundle?.ai?.textureServiceUrl || "").trim();
    const customKey = String(bundle?.ai?.textureServiceApiKey || "").trim();
    const builtin = bundle?.ai?.providers?.find((entry) => entry.provider === BUILTIN_PROVIDER_TYPE);
    const mayUseBuiltin = provider.privacyAccepted === true;
    return {
      baseUrl: customUrl || (mayUseBuiltin ? String(bundle?.ai?.builtinBackendUrl || "").trim() : ""),
      apiKey: customKey || (mayUseBuiltin ? String(builtin?.apiKey || "").trim() : "")
    };
  }, [provider.privacyAccepted]);

  // Scene-card behaviour driven by settings: auxiliary preview lights, the post-mesh-export warning
  // dialog, and the export-JSON indent.
  const sceneCardOptions = useMemo(
    () => ({
      previewAuxiliaryLights: settings.general.previewAuxiliaryLights,
      showMeshExportWarnings: settings.io.showMeshExportWarnings,
      exportJsonIndent: settings.io.exportJsonIndent,
      selectMeshFormat: openThreeBoxMeshExportDialog,
      showMeshWarnings: showThreeBoxMeshExportWarningDialog,
      openInEditor: openSceneInEditor,
      openInPlayer: openSceneInPlayer,
      assetGateway: () => {
        const bundle = getThreeBoxSettings();
        const baseUrl = String(bundle?.general?.assetGatewayUrl || "").trim();
        if (!baseUrl) return null;
        const builtinBackend = String(bundle?.ai?.builtinBackendUrl || "").replace(/\/$/, "");
        const builtin = bundle?.ai?.providers?.find((entry) => entry.provider === BUILTIN_PROVIDER_TYPE);
        const apiKey = provider.privacyAccepted && builtinBackend === baseUrl.replace(/\/$/, "")
          ? String(builtin?.apiKey || "").trim()
          : "";
        return apiKey ? { baseUrl, apiKey } : { baseUrl };
      },
      archiveOptions: async () => {
        const bundle = getThreeBoxSettings();
        const assetPolicy = bundle?.io?.tjzAssetPolicy === "tryPack" ? "tryPack" : "preserve";
        if (assetPolicy !== "tryPack") return { assetPolicy };
        const service = resolveTextureServiceSettings(bundle);
        return {
          assetPolicy,
          fetchExternalUrls: false,
          resolveAsset: async (sourceUrl) => {
            const cached = await getCachedTextureBlob(sourceUrl, { dbName: "threejson-threebox-textures" });
            if (cached) return cached;
            if (!/^https?:\/\//i.test(String(sourceUrl || ""))) return null;
            const runtimeUrl = createTextureProxyUrl(service.baseUrl, service.apiKey, sourceUrl);
            try {
              const response = await fetch(runtimeUrl);
              if (!response.ok) return null;
              const blob = await response.blob();
              if (!blob.size) return null;
              await putCachedTextureBlob(sourceUrl, blob, { source: "tjz-export" }, { dbName: "threejson-threebox-textures" });
              return blob;
            } catch {
              return null;
            }
          }
        };
      },
      translate: (key, fallback, params) => t(key.replace(/^sceneAgent\./, "threebox."), fallback, params)
    }),
    [settings.general.previewAuxiliaryLights, settings.io.showMeshExportWarnings, settings.io.exportJsonIndent, provider.privacyAccepted, resolveTextureServiceSettings]
  );

  useEffect(() => {
    for (const card of sceneCardsByMessageIdRef.current.values()) {
      card.setPreviewAuxiliaryLightsEnabled?.(settings.general.previewAuxiliaryLights !== false);
    }
  }, [settings.general.previewAuxiliaryLights]);

  const updateStoredTurn = useCallback((turnId, updater) => {
    const queues = turnMutationQueuesRef.current;
    const previous = queues.get(turnId) || Promise.resolve();
    const mutation = previous.catch(() => {}).then(async () => {
      const current = await getTurn(turnId);
      if (!current) return null;
      const next = updater(current);
      return next ? putTurn(next) : current;
    });
    const tracked = mutation.finally(() => {
      if (queues.get(turnId) === tracked) queues.delete(turnId);
    });
    queues.set(turnId, tracked);
    return tracked;
  }, []);

  const abortTextureJob = useCallback((turnId) => {
    const jobs = textureJobsByTurnIdRef.current;
    jobs.get(turnId)?.abort();
    jobs.delete(turnId);
  }, []);

  const abortAllTextureJobs = useCallback(() => {
    for (const controller of textureJobsByTurnIdRef.current.values()) controller.abort();
    textureJobsByTurnIdRef.current.clear();
  }, []);

  const startTurnTexturePipeline = useCallback(({
    turnId,
    messageId,
    prompt: texturePrompt,
    scene,
    sceneCard,
    aiProviderOptions,
    changedObjectIds
  }) => {
    const bundle = getThreeBoxSettings();
    if (!turnId || bundle?.ai?.texturePipelineEnabled === false || !sceneCard?.getRuntime?.()) return;
    abortTextureJob(turnId);
    const controller = new AbortController();
    textureJobsByTurnIdRef.current.set(turnId, controller);
    const revision = Symbol(turnId);
    void runHostSceneTexturePipeline({
      scene,
      runtime: sceneCard.getRuntime(),
      prompt: texturePrompt,
      aiProviderOptions,
      textureService: resolveTextureServiceSettings(bundle),
      enabled: true,
      strategy: bundle.ai?.textureStrategy || "semantic-hybrid",
      pbr: bundle.ai?.texturePbr !== false,
      allowUnknownLicense: bundle.ai?.textureAllowUnknownLicense === true,
      persistenceMode: bundle.ai?.texturePersistenceMode || "remote",
      cache: bundle.ai?.textureLocalCache !== false,
      cacheDbName: "threejson-threebox-textures",
      changedObjectIds,
      signal: controller.signal,
      revision,
      isCurrent: (candidate) => candidate === revision && textureJobsByTurnIdRef.current.get(turnId) === controller,
      onProgress: (event) => sceneCard.setTextureProgress(event),
      onAssignment: async (_assignment, updatedScene) => {
        if (textureJobsByTurnIdRef.current.get(turnId) !== controller) return;
        const updatedJson = JSON.stringify(updatedScene, null, 2);
        sceneCard.updateSceneJson(updatedScene);
        updateMessage(messageId, { sceneJson: updatedJson });
        if (shownTurnIdRef.current === turnId) setShownSceneJson(updatedJson);
        await updateStoredTurn(turnId, (turn) => (
          textureJobsByTurnIdRef.current.get(turnId) === controller
            ? { ...turn, sceneJson: updatedJson }
            : null
        ));
      }
    }).catch((error) => {
      if (error?.name !== "AbortError") console.warn("[threebox-react] texture pipeline failed:", error);
    }).finally(() => {
      if (textureJobsByTurnIdRef.current.get(turnId) === controller) {
        textureJobsByTurnIdRef.current.delete(turnId);
      }
    });
  }, [abortTextureJob, resolveTextureServiceSettings, updateMessage, updateStoredTurn]);

  const openConversation = useCallback(
    async (id) => {
      abortAllTextureJobs();
      abortRef.current?.abort();
      history.setActiveId(id);
      closeLeftDock();
      attachedContext.clear();
      setModeOverride(null);
      setActiveAssistantId(null);
      setStream("");
      const turns = await history.loadTurns(id);
      const replayed = [];
      for (const turn of turns) {
        replayed.push({ id: `${turn.id}-u`, role: "user", text: turn.userPrompt || "" });
        if (isUnsuccessfulTurn(turn) || turn.stage === "error") {
          const stopped = turn.status === "stopped";
          const stoppedText = turn.mode === "adjust"
            ? L("已停止调整。", "Adjustment stopped.")
            : L("已停止生成。", "Generation stopped.");
          const message = turn.errorMessage || L("处理失败，发生错误。", "Processing failed.");
          replayed.push({
            id: `${turn.id}-e`,
            role: "error",
            text: stopped ? stoppedText : message,
            stopped,
            errorFeedback: stopped ? null : {
              tone: "error",
              message,
              code: turn.errorCode || "",
              detail: [turn.errorCode ? `error: ${turn.errorCode}` : "", message].filter(Boolean).join("\n")
            },
            configureProvider: ["QUOTA_EXCEEDED", "BUILTIN_QUOTA_EXCEEDED"].includes(turn.errorCode),
            retry: {
              conversationId: id,
              turnId: turn.id,
              userPrompt: turn.userPrompt || "",
              mode: turn.mode || "generate",
              targetTurnId: turn.targetTurnId || null
            }
          });
        } else {
          // Parse the stored snapshot once here so each card gets a stable object reference (a fresh
          // parse on every React render would re-render the live canvas every frame).
          let sceneObj = null;
          let replaySceneJson = turn.sceneJson || null;
          try {
            if (!replaySceneJson && Array.isArray(turn.commands) && turn.commands.length) {
              replaySceneJson = await reconstructSceneAgentTurn(turns, turn.id);
            }
            sceneObj = replaySceneJson ? JSON.parse(replaySceneJson) : null;
          } catch {
            sceneObj = null;
            replaySceneJson = null;
          }
          replayed.push({
            id: `${turn.id}-a`,
            role: "assistant",
            text: turn.sceneTitle || L("场景已生成。", "Scene generated."),
            sceneObj,
            sceneJson: replaySceneJson,
            label: turn.sceneTitle || turn.userPrompt || "",
            summary: turn.recapSummary || null,
            turnId: turn.id,
            mode: turn.mode || "generate",
            diff: turn.commands?.length
              ? { kind: "commands", text: JSON.stringify(turn.commands, null, 2) }
              : turn.patch?.length
                ? { kind: "patch", text: JSON.stringify(turn.patch, null, 2) }
                : null
          });
        }
      }
      setMessages(replayed);

      // The scene an adjust targets is the conversation's latest stored snapshot.
      const latest = [...turns].reverse().find((turn) => turn.sceneJson || (Array.isArray(turn.commands) && turn.commands.length));
      if (latest) {
        const latestSceneJson = latest.sceneJson || await reconstructSceneAgentTurn(turns, latest.id);
        setShownSceneJson(latestSceneJson);
        setShownTurnId(latest.id);
        shownTurnIdRef.current = latest.id;
      } else {
        setShownSceneJson(null);
        setShownTurnId(null);
        shownTurnIdRef.current = null;
      }
      window.setTimeout(() => scrollToBottom("auto"), 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, abortAllTextureJobs, closeLeftDock, attachedContext, scrollToBottom, zh]
  );

  const resetConversationView = useCallback(() => {
    abortAllTextureJobs();
    abortRef.current?.abort();
    history.setActiveId(null);
    setMessages([]);
    setShownSceneJson(null);
    setShownTurnId(null);
    shownTurnIdRef.current = null;
    setModeOverride(null);
    setActiveAssistantId(null);
    setStream("");
    attachedContext.clear();
    closeLeftDock();
  }, [history, abortAllTextureJobs, attachedContext, closeLeftDock]);

  const startNewConversation = useCallback(async () => {
    resetConversationView();
    await history.create({ title: L("新聊天", "New chat") });
    showToast(L("已新建聊天。", "New chat created."), "success");
  }, [history, resetConversationView, showToast, zh]);

  /** Attach a saved resource (a loadable json/tjz/model scene) to the composer context row, like
   * the original's resource library. Non-scene resources (image/other) aren't attachable. */
  const attachResource = useCallback(
    (res) => {
      if (!res.sceneJson) {
        showToast(
          L("该资源已保存，但不是可直接加载的场景。可通过输入框的附件功能交给支持相应类型的模型处理。", "This resource is saved but is not a directly loadable scene."),
          "warning"
        );
        return;
      }
      let sceneObj = null;
      try {
        sceneObj = JSON.parse(res.sceneJson);
      } catch {
        showToast(L("资源中的场景 JSON 无法解析。", "The resource scene JSON could not be parsed."), "error");
        return;
      }
      attachedContext.setTemplate({ id: res.id, title: res.name }, sceneObj);
      showToast(L(`已附加：${res.name}`, `Attached: ${res.name}`));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachedContext, zh]
  );

  const pickTemplate = useCallback(
    async (item) => {
      const title = (zh ? item.title : item.titleEn) || item.title || item.id;
      setTemplateBusyId(item.id);
      try {
        const text = await fetch(resolveSceneHostUrl(item.json)).then((r) =>
          r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))
        );
        // Faithful to the original: picking a template attaches it to the composer's context row
        // (consumed as a seed on the next send), rather than loading it as the current chat.
        attachedContext.setTemplate({ id: item.id, title }, JSON.parse(text));
        showToast(L(`已附加模板：${title}`, `Attached template: ${title}`));
      } catch (error) {
        showToast(L(`模板载入失败：${error.message}`, `Could not load template: ${error.message}`), "error");
      } finally {
        setTemplateBusyId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachedContext, zh]
  );

  const togglePin = useCallback(
    async (conv) => {
      await history.update(conv.id, { pinned: !conv.pinned });
      showToast(conv.pinned ? L("已取消置顶", "Unpinned") : L("已置顶", "Pinned"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history]
  );

  const toggleArchive = useCallback(
    async (conv) => {
      await history.update(conv.id, { archived: !conv.archived });
      showToast(conv.archived ? L("已取消归档", "Unarchived") : L("已归档", "Archived"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history]
  );

  const moveToProject = useCallback(
    async (conv, projectId) => {
      await history.update(conv.id, { projectId });
      showToast(L("已移动。", "Moved."));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history]
  );

  const removeConversation = useCallback(
    async (conv) => {
      if (!window.confirm(L(`确定删除聊天"${conv.title || "未命名"}"吗？此操作无法撤销。`, `Delete "${conv.title || "Untitled"}"? This cannot be undone.`))) {
        return;
      }
      await history.remove(conv.id);
      if (history.activeId === conv.id) {
        resetConversationView();
      }
      showToast(L("聊天已删除。", "Conversation deleted."));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, resetConversationView]
  );

  const createProject = useCallback(async () => {
    const name = (window.prompt(L("新建项目名称：", "New project name:"), "") || "").trim();
    if (!name) {
      return;
    }
    const project = { id: createProjectId(), name };
    await putProject(project);
    setProjects((prev) => [...prev, project]);
    showToast(L(`已新建项目「${name}」。`, `Created project "${name}".`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zh]);

  // Split conversations for the dock: the main list is unarchived; archived get their own section.
  const activeConversations = useMemo(
    () => history.conversations.filter((c) => !c.archived),
    [history.conversations]
  );
  const archivedConversations = useMemo(
    () => history.conversations.filter((c) => c.archived),
    [history.conversations]
  );

  // An attached scene also makes the next turn an adjust (it becomes the current scene as a seed).
  const canAdjust = Boolean(shownSceneJson) || Boolean(attachedContext.current);
  const isAdjust = canAdjust && modeOverride === "adjust";
  const isAutoIntent = canAdjust && modeOverride == null;

  /**
   * Resolves providerOptions for the currently-selected saved provider (composer picker → default →
   * first). The built-in trial provider is device-bound (privacy gate + issued key) so it delegates
   * to useAiProvider; the user's own providers resolve straight from their settings entry.
   * @returns {Promise<{ready:boolean, reason?:string, options?:object}>}
   */
  const resolveActiveProviderOptions = useCallback(async () => {
    const list = selectableProviders;
    const active =
      list.find((p) => p.id === selectedProviderId) ||
      list.find((p) => p.id === settings.ai.defaultProviderId) ||
      list[0];
    if (!active) {
      return { ready: false, reason: "no-provider" };
    }
    if (active.provider === BUILTIN_PROVIDER_TYPE) {
      // The built-in trial key/quota live in the settings provider entry, auto-managed by
      // threeBoxBuiltinProvider. Ensure it's issued (privacy-gated), then read the fresh key.
      if (!provider.privacyAccepted) {
        return { ready: false, reason: "privacy" };
      }
      await ensureBuiltinApiKey(threeBoxSettingsController);
      const fresh = (getThreeBoxSettings().ai.providers || []).find((p) => p.id === active.id);
      const key = String(fresh?.apiKey || "").trim();
      if (!key) {
        return { ready: false, reason: "issue-failed" };
      }
      return {
        ready: true,
        options: {
          provider: BUILTIN_PROVIDER_TYPE,
          apiKey: key,
          baseUrl: settings.ai.builtinBackendUrl || undefined,
          thinkingPreference: settings.ai.thinkingPreference || "disabled"
        }
      };
    }
    if (!String(active.apiKey || "").trim()) {
      return { ready: false, reason: "missing-key" };
    }
    const options = {
      provider: active.provider || "chatgpt",
      apiKey: String(active.apiKey).trim(),
      baseUrl: String(active.baseUrl || "").trim() || undefined,
      model: String(active.model || "").trim() || undefined,
      thinkingPreference: settings.ai.thinkingPreference || "disabled"
    };
    if (options.provider === "deepseek") {
      options.userId = await getDisplayDeviceId();
    }
    return {
      ready: true,
      options
    };
  }, [selectableProviders, settings.ai.defaultProviderId, settings.ai.builtinBackendUrl, settings.ai.thinkingPreference, selectedProviderId, provider]);

  const send = useCallback(
    async (text, retryOptions = null) => {
      const userPrompt = String(text || "").trim();
      if (!userPrompt || busy) {
        return;
      }

      const retrying = Boolean(retryOptions?.turnId);
      const userMessageId = crypto?.randomUUID?.() ?? `u-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (!retrying) {
        append({ id: userMessageId, role: "user", text: userPrompt });
        pinMessageNearTop(userMessageId);
      }
      setPrompt("");
      setBusy(true);
      setBusyStoppable(false);
      setStream(L("正在分析请求并准备场景…", "Analyzing the request and preparing the scene…"));
      rawOutputRef.current = "";
      const assistantId = crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setActiveAssistantId(assistantId);
      append({
        id: assistantId,
        role: "assistant",
        text: "",
        sceneObj: null,
        sceneJson: null,
        renderSceneCard: false,
        managedSceneCard: true,
        label: userPrompt,
        summary: null,
        mode: retryOptions?.mode || (shownSceneJson && modeOverride !== "generate" ? "adjust" : "generate")
      });

      let resolved;
      try {
        resolved = await resolveActiveProviderOptions();
      } catch (error) {
        const feedback = getAiErrorFeedback(error);
        updateMessage(assistantId, { role: "error", text: feedback.message, errorFeedback: feedback });
        setStream("");
        setActiveAssistantId(null);
        setBusy(false);
        setBusyStoppable(false);
        return;
      }
      if (!resolved.ready) {
        if (resolved.reason === "privacy") {
          setShowPrivacy(true);
        }
        const missingMessage = resolved.reason === "issue-failed"
          ? `${L("无法连接内置供应商", "Could not reach the built-in provider")}${
              provider.issueError ? `: ${provider.issueError.message}` : "."
            } ${L("请在设置中配置您自己的供应商。", "Configure your own provider in Settings.")}`
          : L(
              "尚未配置可用的 AI 供应商。请点击左侧「AI 配置」，添加一个供应商并填写 API Key 后再试。",
              "No usable AI provider is configured. Open AI config, add a provider and enter its API key."
            );
        updateMessage(assistantId, {
          role: "assistant",
          text: missingMessage,
          configureProvider: resolved.reason !== "privacy"
        });
        setStream("");
        setActiveAssistantId(null);
        setBusy(false);
        setBusyStoppable(false);
        return;
      }

      let conversationId = retryOptions?.conversationId || history.activeId;
      if (!conversationId) {
        try {
          const created = await history.create({
            title: userPrompt.length > 24 ? `${userPrompt.slice(0, 24)}…` : userPrompt
          });
          conversationId = created.id;
        } catch (error) {
          const feedback = getAiErrorFeedback(error);
          updateMessage(assistantId, { role: "error", text: feedback.message, errorFeedback: feedback });
          setStream("");
          setActiveAssistantId(null);
          setBusy(false);
          setBusyStoppable(false);
          return;
        }
      }

      // Consume an attached scene as a seed turn: render it verbatim (no AI call), cache it, and
      // make it the scene the user's message adjusts — exactly like the original's
      // consumeAttachedContextAsSeedTurn.
      let seedSceneJson = null;
      let seedTurnId = null;
      const attached = retrying ? null : attachedContext.get();
      try {
        if (attached) {
          attachedContext.clear();
          seedSceneJson = JSON.stringify(attached.sceneJson, null, 2);
          append({
            role: "assistant",
            text: L(`已应用「${attached.label}」作为上下文。`, `Applied "${attached.label}" as context.`),
            sceneObj: attached.sceneJson,
            sceneJson: seedSceneJson,
            label: attached.label
          });
          const seedTurn = await history.appendTurn(conversationId, {
            userPrompt: L(`(模板) ${attached.label}`, `(template) ${attached.label}`),
            mode: "template",
            stage: "template",
            sceneJson: seedSceneJson,
            sceneTitle: attached.label,
            recapSummary: L(`已应用模板「${attached.label}」。`, `Applied template "${attached.label}".`)
          });
          seedTurnId = seedTurn?.id || null;
          setShownSceneJson(seedSceneJson);
          setShownTurnId(seedTurnId);
          shownTurnIdRef.current = seedTurnId;
        }
      } catch (error) {
        const feedback = getAiErrorFeedback(error);
        updateMessage(assistantId, { role: "error", text: feedback.message, errorFeedback: feedback });
        setStream("");
        setActiveAssistantId(null);
        setBusy(false);
        setBusyStoppable(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setBusyStoppable(true);
      const currentTurnId = retryOptions?.turnId || createTurnId();
      const turnContext = createSceneAgentTurnContext(currentTurnId, userPrompt);
      const turnDeadlineAt = Date.now() + 180000;
      const sceneProviderOptions = { ...resolved.options, threeBoxTurnContext: turnContext, turnDeadlineAt };
      let adjustTargetString = seedSceneJson || shownSceneJson;
      let adjustTargetTurnId = retryOptions?.targetTurnId || (seedSceneJson ? seedTurnId : shownTurnId);
      const requestedMode = retryOptions?.mode || modeOverride;
      let adjusting = requestedMode === "adjust" || (requestedMode !== "generate" && Boolean(adjustTargetString));
      let negotiation = null;

      // Direct generation is the default. This budget is only a runaway guard when core/ai
      // escalates a genuinely complex/output-limited scene to incremental construction.
      const agentOptions = resolveSceneAgentOptions(settings);
      // The assistant card is always appended up-front now (so drafts can stream into it) and
      // finalized in place after the turn — there is no more "append once at the end" path.
      let previewRenderQueue = Promise.resolve();
      let previewQueueOpen = true;
      let lastQueuedPreviewJson = "";
      let adjustmentUsesSceneCardRuntime = false;
      const onScenePreview = (draftString, progress = {}) => {
        if (!draftString || draftString === lastQueuedPreviewJson) return previewRenderQueue;
        let obj = null;
        try {
          obj = JSON.parse(draftString);
        } catch {
          return previewRenderQueue;
        }
        lastQueuedPreviewJson = draftString;
        updateMessage(assistantId, (message) => ({
          sceneObj: message.sceneObj || obj,
          sceneJson: draftString
        }));
        previewRenderQueue = previewRenderQueue
          .catch((error) => console.warn("[threebox-react] previous preview render failed:", error))
          .then(async () => {
            if (!previewQueueOpen) return null;
            const sceneCard = await waitForSceneCard(assistantId);
            if (!sceneCard) return null;
            if (
              progress.outputMode === "commands" &&
              Array.isArray(progress.commands) &&
              progress.commands.length > 0 &&
              sceneCard.getRuntime?.()
            ) {
              if (adjustmentUsesSceneCardRuntime) return null;
              return sceneCard.applyCommands(progress.commands, { sceneJson: obj, label: userPrompt, draft: true });
            }
            return sceneCard.render(obj, {
              label: userPrompt,
              draft: progress.stage !== "direct_scene",
              authoritative: adjustmentUsesSceneCardRuntime
            });
          });
        return previewRenderQueue;
      };
      const onAgentProgress = createAgentProgressUpdater(setStream, onScenePreview);
      activeOutputStreamIdRef.current = "";
      const onOutputDelta = (delta, metadata = {}) => {
        const streamId = String(metadata?.streamId || "");
        setStream((previous) => {
          const startsNewOutput = metadata?.reset === true || (
            streamId && streamId !== activeOutputStreamIdRef.current
          );
          if (streamId) {
            activeOutputStreamIdRef.current = streamId;
          }
          const previousOutput = startsNewOutput ? "" : rawOutputRef.current;
          const nextOutput = `${previousOutput}${String(delta || "")}`;
          rawOutputRef.current = nextOutput;
          return nextOutput;
        });
      };
      updateMessage(assistantId, {
        text: L("正在生成…", "Generating…"),
        renderSceneCard: true,
        mode: adjusting ? "adjust" : "generate"
      });

      try {
        const allPriorTurns = await history.loadTurns(conversationId);
        const priorSceneTurns = allPriorTurns.filter((turn) => (
          !["failed", "stopped"].includes(String(turn?.status || "").toLowerCase()) &&
          (Boolean(turn?.sceneJson) || (Array.isArray(turn?.commands) && turn.commands.length > 0))
        ));
        const negotiationHistory = priorSceneTurns.map((turn) => ({
          turnId: turn.id,
          summary: turn.recapSummary || turn.userPrompt || "",
          userPrompt: turn.userPrompt || "",
          mode: turn.mode,
          targetTurnId: turn.targetTurnId,
          sceneTitle: turn.sceneTitle || ""
        }));
        negotiation = await negotiateSceneAgentTurn(
          {
            userPrompt,
            history: requestedMode === "generate" ? [] : negotiationHistory,
            priorTurns: requestedMode === "generate" ? [] : priorSceneTurns
          },
          {
            ...sceneProviderOptions,
            signal: controller.signal,
            animationCapabilityMode: settings.ai.animationCapabilityMode || "auto",
            sceneGenerationMode: settings.ai.sceneGenerationMode || "auto"
          }
        );

        if (seedSceneJson) {
          adjusting = true;
        } else if (requestedMode === "generate") {
          adjusting = false;
        } else if (requestedMode === "adjust") {
          adjusting = Boolean(adjustTargetString);
          if (adjustTargetTurnId && adjustTargetTurnId !== shownTurnId) {
            adjustTargetString = await reconstructSceneAgentTurn(allPriorTurns, adjustTargetTurnId);
            adjusting = Boolean(adjustTargetString);
          }
        } else {
          adjusting = negotiation.route?.intent === "adjust";
          adjustTargetTurnId = negotiation.route?.targetTurnId || shownTurnId;
          if (adjusting && adjustTargetTurnId && adjustTargetTurnId !== shownTurnId) {
            adjustTargetString = await reconstructSceneAgentTurn(allPriorTurns, adjustTargetTurnId);
          }
        }
        if (adjusting && !adjustTargetString) adjusting = false;
        updateMessage(assistantId, { mode: adjusting ? "adjust" : "generate" });

        let sceneJson;
        let sceneJsonString;
        let stage = "generate";
        // For adjust turns, the raw output the model applied (operation commands or a JSON Patch),
        // surfaced under the card in a collapse — exactly like the original's diff collapse.
        let diff = null;
        let commands = null;
        let patch = null;
        let agentResult = null;

        if (adjusting) {
          // Adjust behaviour follows the persisted AI settings: which output form to try first
          // (operation commands / JSON Patch / full JSON) and how much of the target scene to
          // attach as context (spatial summary and/or full JSON).
          const adjustContextSettings = {
            includeSpatialSummary: settings.ai.includeSpatialSummary,
            includeFullJson: settings.ai.includeFullJson
          };
          const targetSceneJson = JSON.parse(adjustTargetString);
          adjustmentUsesSceneCardRuntime = true;
          const initialScenePreviewPromise = onScenePreview(adjustTargetString, { stage: "adjust_base" });
          const envelope = buildStructuredTurnEnvelope({
            userPrompt,
            intent: "adjust",
            targetTurnId: adjustTargetTurnId,
            contextPayload: resolveAiAdjustContextPayload(targetSceneJson, adjustContextSettings),
            includeReferenceLinks: settings.ai.attachReferenceLinks,
            globalPromptPrefix: settings.ai.globalPromptPrefix || undefined,
            selectedCapabilityIds: negotiation.selectedCapabilityIds,
            requiresAnimation: negotiation.requiresAnimation
          });
          const result = await runAiAdjustTurn({
            userPrompt,
            envelope,
            targetSceneJsonString: adjustTargetString,
            providerOptions: sceneProviderOptions,
            updateOutputMode: settings.ai.updateOutputMode,
            resolveContextPayload: (json) => resolveAiAdjustContextPayload(json, adjustContextSettings),
            agentOptions,
            ...resolveSceneAgentTokenOptions(settings),
            capabilityLookup: settings.ai.capabilityLookupEnabled,
            selectedCapabilityIds: negotiation.selectedCapabilityIds,
            animationCapabilities: negotiation.requiresAnimation === true,
            generationStrategy: negotiation.generationStrategy,
            estimatedSegments: negotiation.estimatedSegments,
            onAgentProgress,
            onDelta: onOutputDelta,
            applyCommands: async (commands, meta = {}) => {
              await initialScenePreviewPromise;
              const sceneCard = await waitForSceneCard(assistantId);
              if (!sceneCard) throw new Error("Scene adjustment preview is not ready.");
              return sceneCard.applyCommandsWithResult(commands, {
                label: userPrompt,
                draft: true,
                readOnly: meta.readOnly === true
              });
            },
            refreshContext: async () => {
              await initialScenePreviewPromise;
              const sceneCard = await waitForSceneCard(assistantId);
              const currentSceneJsonString = await sceneCard?.exportSceneJsonString({ label: userPrompt, draft: true });
              if (!currentSceneJsonString) throw new Error("Scene adjustment preview is not ready.");
              const currentSceneJson = JSON.parse(currentSceneJsonString);
              return {
                ...resolveAiAdjustContextPayload(currentSceneJson, adjustContextSettings),
                currentSceneJsonString
              };
            },
            locale,
            signal: controller.signal
          });
          sceneJson = result.sceneJson;
          sceneJsonString = result.sceneJsonString;
          stage = result.stage;
          agentResult = result.agentResult || null;
          if (result.stage === "commands" && Array.isArray(result.commands)) {
            commands = result.commands;
            diff = { kind: "commands", text: JSON.stringify(result.commands, null, 2) };
          } else if (Array.isArray(result.patch) && result.patch.length > 0) {
            patch = result.patch;
            diff = { kind: "patch", text: JSON.stringify(result.patch, null, 2) };
          }
        } else {
          const result = await runAiGenerateTurn({
            userPrompt,
            providerOptions: sceneProviderOptions,
            locale,
            signal: controller.signal,
            // Persisted AI settings: a global prompt prefix prepended to every request, whether to
            // attach ThreeJSON doc/example reference links, online-texture hints, and the segmented
            // continuation cap.
            globalPromptPrefix: settings.ai.globalPromptPrefix || undefined,
            includeReferenceLinks: settings.ai.attachReferenceLinks,
            capabilityLookup: settings.ai.capabilityLookupEnabled,
            maxSceneSegments: settings.ai.maxSceneSegments,
            generationStrategy: negotiation.generationStrategy,
            executionMode: negotiation.executionMode,
            refinementGoals: negotiation.refinementGoals,
            estimatedSegments: negotiation.estimatedSegments,
            estimatedOutputTokens: negotiation.estimatedOutputTokens,
            selectedCapabilityIds: negotiation.selectedCapabilityIds,
            requiresAnimation: negotiation.requiresAnimation,
            agentOptions,
            ...resolveSceneAgentTokenOptions(settings),
            onAgentProgress,
            // Every visible authoring request carries its own stream id, so JSON, commands and
            // Patch rounds replace one another instead of being concatenated into invalid text.
            onDelta: onOutputDelta,
            onSceneDraft: (draftString) => onScenePreview(draftString, { stage: "scene_draft" }),
            onGenerationPhase: (phase) => {
              if (phase?.phase === "compact-retry" || phase?.phase === "segmented-recovery") {
                activeOutputStreamIdRef.current = "";
                rawOutputRef.current = "";
                setStream(phase?.phase === "segmented-recovery"
                  ? L("输出过长，正在切换为分段生成…", "Output too long — switching to segmented generation…")
                  : L("输出过长，正在简化场景并重新生成…", "Output too long — simplifying and regenerating the scene…"));
              } else if (phase?.phase === "processing") {
                setStream(L("正在解析生成的 JSON 并准备场景…", "Parsing the generated JSON and preparing the scene…"));
              } else if (phase?.phase === "capability-review") {
                setStream(L("正在校验场景是否充分使用相关能力…", "Checking whether the scene makes full use of relevant capabilities…"));
              }
            }
          });
          sceneJson = result.sceneJson;
          sceneJsonString = result.sceneJsonString;
          agentResult = result.agentResult || null;
        }

        setStream("");
        const rawSnapshot = sceneJsonString ?? JSON.stringify(sceneJson);
        const snapshot = projectSceneAgentJsonString(
          rawSnapshot,
          settings.io.sceneJsonFormat === "friendly" ? "friendly" : "standard"
        );
        sceneJson = JSON.parse(snapshot);
        previewQueueOpen = false;
        await previewRenderQueue.catch((error) => {
          console.warn("[threebox-react] superseded preview render failed:", error);
        });
        const finalSceneCard = await waitForSceneCard(assistantId);
        await finalSceneCard?.finalize(sceneJson, { label: userPrompt });
        const verifiedAdjustSummary = adjusting && settings.ai.includeTurnSummary
          ? L(`已通过 ${stage} 调整了场景。`, `Adjusted the scene via ${stage}.`)
          : "";
        const useDiffCache = adjusting && settings.io.turnCacheMode === "diff" && stage === "commands" && commands?.length;
        const turnRecord = await history.appendTurn(conversationId, {
          id: currentTurnId,
          userPrompt,
          mode: adjusting ? "adjust" : "generate",
          targetTurnId: adjusting ? adjustTargetTurnId : undefined,
          stage,
          sceneJson: useDiffCache ? null : snapshot,
          commands,
          patch,
          sceneTitle: "",
          recapSummary: verifiedAdjustSummary
        });
        const baseText = adjusting ? L(`场景已调整（${stage}）。`, `Scene adjusted (${stage}).`) : L("场景已生成。", "Scene generated.");
        // Only show a recap when adaptive execution actually performed meaningful extra work.
        const agentProcess = buildAgentProcessSummary(
          agentResult,
          L("Agent 过程", "Agent process"),
          L(
            "已达到自动细化轮数上限；当前场景可用，但 AI 未明确确认已经完善完成。",
            "The automatic refinement limit was reached. The scene is usable, but the AI did not explicitly confirm completion."
          )
        );
        const finalFields = {
          text: agentProcess ? `${baseText}\n\n${agentProcess}` : baseText,
          // The orchestrator already handed us the parsed scene object; the message's own SceneCard
          // renders it into its own live canvas (there is no shared viewport).
          sceneJson: snapshot,
          diff,
          label: userPrompt,
          turnId: currentTurnId,
          mode: adjusting ? "adjust" : "generate",
          summary: verifiedAdjustSummary || undefined
        };
        // The card was appended early and streamed drafts (see above) — finalize it in place so
        // the last draft is superseded by the real result.
        updateMessage(assistantId, (message) => ({
          ...finalFields,
          sceneObj: message.sceneObj || null
        }));
        setShownSceneJson(snapshot);
        setShownTurnId(currentTurnId);
        shownTurnIdRef.current = currentTurnId;
        // Debounced push to the user's self-hosted sync server (no-op unless configured).
        selfHostedSync.scheduleSync();
        if (finalSceneCard) {
          const previousScene = adjusting
            ? JSON.parse(projectSceneAgentJsonString(
                adjustTargetString,
                settings.io.sceneJsonFormat === "friendly" ? "friendly" : "standard"
              ))
            : null;
          startTurnTexturePipeline({
            turnId: currentTurnId,
            messageId: assistantId,
            prompt: userPrompt,
            scene: sceneJson,
            sceneCard: finalSceneCard,
            aiProviderOptions: sceneProviderOptions,
            changedObjectIds: previousScene ? findChangedTextureObjectIds(previousScene, sceneJson) : undefined
          });
        }

        // Generation title/recap remain best-effort background calls. Adjustments use the verified
        // stage above instead of asking another model call to guess what changed from a thin digest.
        if (!adjusting && (settings.ai.autoGenerateSceneTitle || settings.ai.includeTurnSummary)) {
          const digest = buildResultDigest(sceneJson);
          const providerOptions = sceneProviderOptions;
          const turnMode = adjusting ? "adjust" : "generate";
          const summaryTargetTurnId = adjusting ? adjustTargetTurnId : undefined;
          void (async () => {
            const [title, recap] = await Promise.all([
              settings.ai.autoGenerateSceneTitle
                ? runAiSceneTitle({
                    userPrompt,
                    resultDigest: digest,
                    providerOptions,
                    responseLanguage: resolveTitleLanguage()
                  }).catch(() => "")
                : Promise.resolve(""),
              settings.ai.includeTurnSummary
                ? runAiTurnSummary({
                    userPrompt,
                    mode: turnMode,
                    targetTurnId: summaryTargetTurnId,
                    turnId: currentTurnId,
                    resultDigest: digest,
                    providerOptions,
                    responseLanguage: summaryResponseLanguage,
                    selfName: settings.ai.selfName || "ThreeBox"
                  }).catch(() => "")
                : Promise.resolve("")
            ]);
            const recapText = settings.ai.includeTurnSummary
              ? recap || L("已根据您的描述生成场景。", "Generated a scene from your description.")
              : "";
            const patch = {};
            if (title) {
              patch.label = title;
              sceneCardsByMessageIdRef.current.get(assistantId)?.setLabel?.(title);
            }
            if (recapText) {
              patch.summary = recapText;
            }
            if (Object.keys(patch).length) {
              updateMessage(assistantId, patch);
            }
            if (title) {
              // Write straight to the store (read-merge-write) rather than history.update: that
              // hook method bails when the conversation isn't in its in-memory list, and this async
              // block runs seconds later against a `history` captured before the conversation was
              // created. Refresh afterwards so the sidebar reflects the new title.
              try {
                const conv = await getConversation(conversationId);
                if (conv) {
                  await putConversation({ ...conv, title, updatedAt: Date.now() });
                  await history.refresh();
                }
              } catch {
                /* best-effort */
              }
            }
            if (turnRecord && (title || recapText)) {
              void updateStoredTurn(currentTurnId, (current) => ({
                ...current,
                sceneTitle: title || current.sceneTitle || "",
                recapSummary: recapText
              })).catch(() => {});
            }
          })();
        }
      } catch (error) {
        previewQueueOpen = false;
        setStream("");
        const stopped = error?.name === "AbortError";
        const feedback = stopped ? null : getAiErrorFeedback(error);
        const stoppedText = adjusting
          ? L("已停止调整。", "Adjustment stopped.")
          : L("已停止生成。", "Generation stopped.");
        const retry = {
          conversationId,
          turnId: currentTurnId,
          userPrompt,
          mode: adjusting ? "adjust" : "generate",
          targetTurnId: adjusting ? adjustTargetTurnId : null
        };
        updateMessage(assistantId, {
          role: "error",
          text: stopped ? stoppedText : feedback.message,
          stopped,
          errorFeedback: feedback,
          retry,
          configureProvider: ["QUOTA_EXCEEDED", "BUILTIN_QUOTA_EXCEEDED"].includes(feedback?.code),
          failedOutput: rawOutputRef.current || null,
          sceneObj: null,
          sceneJson: null,
          diff: null,
          renderSceneCard: false
        });
        await history.appendTurn(conversationId, createUnsuccessfulTurnRecord({
          id: currentTurnId,
          conversationId,
          userPrompt,
          mode: adjusting ? "adjust" : "generate",
          targetTurnId: adjusting ? adjustTargetTurnId : null,
          stopped,
          errorMessage: feedback?.message || "",
          errorCode: error?.code || feedback?.code || null
        })).catch((cacheError) => {
          console.error("[threebox-react] failed to persist unsuccessful turn:", cacheError);
        });
      } finally {
        setBusy(false);
        setBusyStoppable(false);
        setActiveAssistantId(null);
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, provider, locale, append, updateMessage, history, isAdjust, modeOverride, shownSceneJson, shownTurnId, zh, resolveActiveProviderOptions, settings.ai, settings.io.sceneJsonFormat, attachedContext]
  );

  const onComposerKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(prompt);
    }
  };

  const filteredResources = useMemo(
    () =>
      resourceCategory === "all"
        ? resources.resources
        : resources.resources.filter((r) => r.kind === resourceCategory),
    [resources.resources, resourceCategory]
  );

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) {
      return templates;
    }
    return templates.filter((t) =>
      `${t.title || ""} ${t.titleEn || ""} ${t.id}`.toLowerCase().includes(q)
    );
  }, [templates, templateSearch]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return history.conversations;
    }
    return history.conversations.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [history.conversations, searchQuery]);

  const hasMessages = messages.length > 0;
  const rootClass = [
    "rootContainer",
    sidebarPinned ? "leftDockPinned" : "",
    mobilePeek ? "leftDockPeek" : ""
  ]
    .filter(Boolean)
    .join(" ");

  /** One history row, shared by the main list, project groups, and the archived section. The ⋯ menu
   * button opens a context menu positioned at the button (pin / archive / move-to-project / delete). */
  const renderHistoryItem = (conv) => (
    <div
      key={conv.id}
      className={`historyItem${history.activeId === conv.id ? " active" : ""}${conv.pinned ? " pinned" : ""}`}
      onClick={() => void openConversation(conv.id)}
    >
      {conv.pinned && (
        <svg viewBox="0 0 16 16" className="historyItemPin" aria-hidden="true">
          <path fill="currentColor" d="M8 1.6 9.4 5.5 13.3 6.4 9.4 7.3 8 11.2 6.6 7.3 2.7 6.4 6.6 5.5 8 1.6z" />
        </svg>
      )}
      <div className="historyItemBody">
        <div className="historyItemTitle">{conv.title || L("未命名", "Untitled")}</div>
        <div className="historyItemMeta">
          {formatRelativeTime(conv.updatedAt, zh)}
          {conv.projectId && projects.find((project) => project.id === conv.projectId)?.name
            ? ` · ${projects.find((project) => project.id === conv.projectId).name}`
            : ""}
        </div>
      </div>
      <button
        className="historyItemMenuBtn"
        type="button"
        title={L("更多", "More")}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setHistoryMenu({ conv, x: rect.right, y: rect.bottom });
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="3.4" r="1.2" fill="currentColor" />
          <circle cx="8" cy="8" r="1.2" fill="currentColor" />
          <circle cx="8" cy="12.6" r="1.2" fill="currentColor" />
        </svg>
      </button>
    </div>
  );

  return (
    <div id="rootContainer" className={rootClass}>
      <div
        className="flyoutHost flyoutHostLeft"
        id="leftFlyoutHost"
        onMouseEnter={onFlyoutEnter}
        onMouseLeave={onFlyoutLeave}
      >
        <div className="edgeHoverZone edgeHoverZoneLeft" />
        <aside
          className="leftDock"
          id="leftDock"
          ref={leftDockRef}
          aria-hidden={sidebarPinned || mobilePeek ? "false" : "true"}
        >
          <div className="sidebarHeaderRow">
            <a className="brand" href="https://threejson.org/website/#/examples" target="_blank" rel="noreferrer">
              <img src={LOGO_URL} alt="ThreeJSON" />
              <span className="brandText">
                <span className="brandTitle">ThreeBox</span>
                <span className="brandSubtitle">{L("由 ThreeJSON 驱动", "Powered by ThreeJSON")}</span>
              </span>
            </a>
          </div>
          <div className="sidebarPinRow">
            <button
              className="sidebarPinBtn"
              type="button"
              aria-pressed={sidebarPinned}
              aria-label={L("钉住侧栏", "Pin sidebar")}
              title={sidebarPinned
                ? L("已钉住：鼠标移开仍显示", "Pinned: stays visible")
                : L("未钉住：移到屏幕左边缘唤出", "Unpinned: move to the left edge to reveal")}
              onClick={() => {
                if (!isMobileViewport()) setSidebarPinned((v) => !v);
              }}
            >
              <svg className="sidebarPinIcon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 1.6 9.4 5.5 13.3 6.4 9.4 7.3 8 11.2 6.6 7.3 2.7 6.4 6.6 5.5 8 1.6z"
                />
                <path fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" d="M8 10.2v4.2" />
              </svg>
            </button>
          </div>

          <div className="sidebarBody">
            <nav className="sidebarNav">
              <button className="sidebarNavBtn" type="button" onClick={() => { closeLeftDock(); openSettings("ai"); }}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8 3.6 3.6"
                  />
                </svg>
                <span>{L("AI 配置", "AI config")}</span>
              </button>
              <button className="sidebarNavBtn" type="button" onClick={() => void startNewConversation()}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" d="M8 2.5v11M2.5 8h11" />
                </svg>
                <span>{L("新聊天", "New chat")}</span>
              </button>
              <button className="sidebarNavBtn" type="button" onClick={() => { closeLeftDock(); setShowSearch(true); }}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="6.8" cy="6.8" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <path stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" d="m9.8 9.8 3.3 3.3" />
                </svg>
                <span>{L("搜索聊天", "Search")}</span>
              </button>
            </nav>

            <details className="sidebarSection" id="resourceLibrarySection">
              <summary className="sidebarSectionTitle">{L("资源库", "Library")}</summary>
              <div className="sidebarSectionBody">
                <div className="resourceCategoryTabs">
                  {RESOURCE_CATEGORIES.map(([key, cn, en]) => (
                    <button
                      key={key}
                      type="button"
                      className={`resourceCategoryTab${resourceCategory === key ? " active" : ""}`}
                      onClick={() => setResourceCategory(key)}
                    >
                      {L(cn, en)}
                    </button>
                  ))}
                </div>
                <div className="resourceList">
                  {filteredResources.length === 0 && (
                    <div className="historyEmpty">{L("暂无资源。点击输入框左侧的 + 上传文件。", "No resources yet. Use + beside the composer to upload one.")}</div>
                  )}
                  {filteredResources.map((res) => (
                    <div
                      key={res.id}
                      className={`resourceItem${res.sceneJson ? " resourceItemLoadable" : ""}`}
                      title={res.sceneJson ? res.name : L("该类型暂不支持直接加载为场景上下文", "This type cannot yet be loaded directly as scene context")}
                      onClick={() => attachResource(res)}
                    >
                      <div className="resourceItemIcon" aria-hidden="true">
                        <ResourceIcon kind={res.kind} />
                      </div>
                      <div className="resourceItemInfo">
                        <div className="resourceItemName">{res.name}</div>
                        <div className="resourceItemMeta">
                          {res.sceneJson
                            ? formatFileSize(new Blob([res.sceneJson]).size)
                            : res.blob?.size
                              ? formatFileSize(res.blob.size)
                              : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="resourceItemRemoveBtn"
                        title={L("删除", "Delete")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void resources.remove(res.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </details>

            <details
              className="sidebarSection"
              open={templateGalleryExpanded}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setTemplateGalleryExpanded(open);
                try { localStorage.setItem(TEMPLATE_GALLERY_EXPANDED_STORAGE_KEY, open ? "1" : "0"); } catch { /* ignore */ }
              }}
            >
              <summary className="sidebarSectionTitle">{L("模板库", "Templates")}</summary>
              <div className="sidebarSectionBody">
                <input
                  type="search"
                  className="sidebarSearchInput"
                  placeholder={L("搜索模板...", "Search templates...")}
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                />
                <div className="templateGrid">
                  {filteredTemplates.length === 0 && (
                    <div className="historyEmpty">{L("没有匹配的模板。", "No matching templates.")}</div>
                  )}
                  {filteredTemplates.map((item) => (
                    <TemplateCard
                      key={item.id}
                      item={item}
                      label={(zh ? item.title : item.titleEn) || item.title}
                      busy={templateBusyId === item.id}
                      onSelect={() => void pickTemplate(item)}
                    />
                  ))}
                </div>
              </div>
            </details>

            <details className="sidebarSection">
              <summary className="sidebarSectionTitle">{L("应用", "Apps")}</summary>
              <div className="sidebarSectionBody">
                <a className="appLinkCard" href={THREEBOX_PEER_URLS.editor} target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2 12.5 10.5 4 12 5.5 3.5 14H2v-1.5z"
                    />
                    <path fill="none" stroke="currentColor" strokeWidth="1.3" d="m9.3 5.2 1.5 1.5" />
                  </svg>
                  <span>{L("场景编辑器", "Scene editor")}</span>
                </a>
                <a className="appLinkCard" href={THREEBOX_PEER_URLS.player} target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    <path fill="currentColor" d="M6.6 5.4 11 8l-4.4 2.6V5.4z" />
                  </svg>
                  <span>{L("场景播放器", "Scene player")}</span>
                </a>
              </div>
            </details>

            <details className="sidebarSection">
              <summary className="sidebarSectionTitle">{L("项目", "Projects")}</summary>
              <div className="sidebarSectionBody">
                <div className="projectList">
                  {projects.length === 0 && <div className="historyEmpty">{L("暂无项目。", "No projects yet.")}</div>}
                  {projects.map((proj) => {
                    const inProject = activeConversations.filter((c) => c.projectId === proj.id);
                    return (
                      <details className="projectItem" key={proj.id}>
                        <summary className="projectItemTitle">
                          {proj.name} <span className="projectItemCount">{inProject.length}</span>
                        </summary>
                        {inProject.map((conv) => renderHistoryItem(conv))}
                      </details>
                    );
                  })}
                </div>
                <button className="sidebarInlineBtn" type="button" onClick={() => void createProject()}>
                  {L("+ 新建项目", "+ New project")}
                </button>
              </div>
            </details>

            <div className="sidebarSectionTitle sidebarHistoryTitle">{L("聊天历史", "History")}</div>
            <div className="historyList">
              {history.loading && <div className="historyEmpty">{L("加载历史…", "Loading history…")}</div>}
              {!history.loading && activeConversations.length === 0 && (
                <div className="historyEmpty">
                  {history.persistent
                    ? L("暂无对话。", "No conversations yet.")
                    : L("此浏览器模式下历史不可用。", "History unavailable in this browser mode.")}
                </div>
              )}
              {activeConversations.filter((c) => !c.projectId).map((conv) => renderHistoryItem(conv))}
            </div>

            {archivedConversations.length > 0 && (
              <details className="sidebarSection sidebarArchiveSection">
                <summary className="sidebarSectionTitle">{L("已归档", "Archived")}</summary>
                <div className="historyList">
                  {archivedConversations.map((conv) => renderHistoryItem(conv))}
                </div>
              </details>
            )}
          </div>

          <div className="sidebarFooter" ref={userMenuRef}>
            <button className="userMenuBtn" type="button" onClick={() => setUserMenuOpen((v) => !v)}>
              <span className="userAvatar">U</span>
              <span className="userName">{L("访客用户", "Guest")}</span>
            </button>
            {userMenuOpen && (
              <div className="userMenuPanel">
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    closeLeftDock();
                    openSettings("general");
                  }}
                >
                  {L("设置", "Settings")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    closeLeftDock();
                    const migration = createThreeBoxCloudMigration({
                      apiBaseUrl: "https://api.threebox.org",
                      cloudUrl: "https://cloud.threebox.org",
                      settingsProvider: getThreeBoxSettings
                    });
                    void migration.open().catch((error) => showToast(error?.message || String(error), "error"));
                  }}
                >
                  {L("切换到 ThreeBox Cloud", "Switch to ThreeBox Cloud")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    closeLeftDock();
                    setShowHelp(true);
                  }}
                >
                  {L("帮助", "Help")}
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <main id="mainArea" className="mainArea">
        <button
          ref={mobileMenuBtnRef}
          type="button"
          className="mobileMenuBtn"
          aria-label={L("菜单", "Menu")}
          aria-expanded={mobilePeek}
          onClick={() => setMobilePeek((v) => !v)}
        >
          <svg viewBox="0 0 18 14" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M1 1.5h16M1 7h16M1 12.5h16" />
          </svg>
        </button>

        <div className="chatMessages" ref={chatMessagesRef} hidden={!hasMessages} onScroll={refreshScrollButton}>
          {messages.map((m, i) => {
            const role = m.role === "user" ? "user" : "assistant";
            return (
              <div
                key={m.id ?? i}
                data-message-id={m.id ?? undefined}
                className={`chatMessage chatMessage${role === "user" ? "User" : "Assistant"}`}
              >
                <div className={`chatMessageAvatar chatMessageAvatar${role === "user" ? "User" : "Assistant"}`}>
                  {role === "user" ? "U" : <img src={LOGO_URL} alt="ThreeBox" />}
                </div>
                <div className="chatMessageBody">
                  {m.role === "error" ? (
                    <AiErrorFeedback
                      feedback={m.errorFeedback}
                      stoppedText={m.stopped ? m.text : ""}
                      retrying={busy}
                      onRetry={m.retry ? () => void send(m.retry.userPrompt, m.retry) : null}
                      onConfigureProvider={m.configureProvider ? () => openSettings("ai") : null}
                    />
                  ) : m.role === "assistant" ? (
                    // Assistant text may embed AI-authored (untrusted) content — render it as
                    // sanitized markdown, exactly like the original (renderMarkdownToSafeHtml).
                    <div
                      className="chatMessageText markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(m.text) }}
                    />
                  ) : (
                    <div className="chatMessageText">{m.text}</div>
                  )}
                  {m.configureProvider && m.role !== "error" && (
                    <button type="button" className="chatRetryBtn" onClick={() => openSettings("ai")}>
                      {L("点此配置供应商", "Configure provider")}
                    </button>
                  )}
                  {busy && m.id === activeAssistantId && (
                    <pre
                      className={`streamingPreview${["{", "[", "`"].includes(stream.trim().charAt(0)) ? "" : " streamingPreviewPending streamingPreviewProcessing"}`}
                      role="status"
                      aria-live="polite"
                      aria-busy="true"
                      onClick={(event) => event.currentTarget.classList.toggle("expanded")}
                    >
                      {stream || L("正在生成…", "Generating…")}
                    </pre>
                  )}
                  {(m.renderSceneCard || m.sceneObj) && (
                    <SceneAgentSceneCard
                      sceneJson={m.sceneObj}
                      label={m.label}
                      showToast={showToast}
                      options={sceneCardOptions}
                      managed={m.managedSceneCard === true}
                      onReady={(card) => registerSceneCard(m.id ?? `message-${i}`, card)}
                    />
                  )}
                  {/* Diff collapse (adjust turns) sits above the final-JSON collapse, per the original. */}
                  {m.diff && (
                    <AdjustDiffCollapse
                      kind={m.diff.kind}
                      text={m.diff.text}
                      lineNumbers={settings.io.jsonViewerLineNumbers}
                      highlight={settings.io.jsonViewerHighlight}
                      showToast={showToast}
                    />
                  )}
                  {m.sceneJson && (
                    <SceneJsonCollapse
                      rawJsonString={m.sceneJson}
                      format={settings.io.sceneJsonFormat}
                      lineNumbers={settings.io.jsonViewerLineNumbers}
                      highlight={settings.io.jsonViewerHighlight}
                      showToast={showToast}
                    />
                  )}
                  {m.failedOutput && (
                    <JsonCollapse
                      failed
                      text={m.failedOutput}
                      label={L("查看失败时的 JSON", "View output at failure")}
                      copyTitle={L("复制失败输出", "Copy failed output")}
                      lineNumbers={settings.io.jsonViewerLineNumbers}
                      highlight={settings.io.jsonViewerHighlight}
                      showToast={showToast}
                    />
                  )}
                  {/* Post-turn recap (ai.includeTurnSummary), rendered as markdown below the card. */}
                  {m.summary && (
                    <div
                      className="sceneSummaryText markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(m.summary) }}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {busy && <div className="chatTurnSpacer" aria-hidden="true" />}
          <div ref={messagesEndRef} />
        </div>

        <button
          type="button"
          className="scrollToBottomBtn"
          hidden={!showScrollToBottom}
          aria-label={L("滚动到底部", "Scroll to bottom")}
          onClick={() => scrollToBottom()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" d="m3.2 6 4.8 4.8L12.8 6" />
          </svg>
        </button>

        <div className="chatHero" hidden={hasMessages}>
          <div className="chatHeroInner">
            <img src={LOGO_URL} alt="ThreeBox" className="chatHeroLogo" />
            <h1 className="chatHeroTitle">{L("打开盒子，看见世界", "Open the box, see a world")}</h1>
            <p className="chatHeroSubtitle">{L("描述一个世界，看它成为现实。", "Describe a world. Watch it become real.")}</p>
            <div className="chatHeroSuggestions">
              {HERO_SUGGESTIONS.map((s) => (
                <button
                  key={s.en}
                  type="button"
                  className="chatSuggestionChip"
                  onClick={() => {
                    const p = zh ? s.promptZh : s.promptEn;
                    setPrompt(p);
                    composerRef.current?.focus();
                  }}
                >
                  {L(s.zh, s.en)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="chatComposerBar">
          <div
            className={`chatComposer${composerAttach.dragOver ? " dragOver" : ""}`}
            id="chatComposer"
            onDragEnter={composerAttach.handleDragEnter}
            onDragOver={composerAttach.handleDragOver}
            onDragLeave={composerAttach.handleDragLeave}
            onDrop={composerAttach.handleDrop}
          >
            <AttachedContextRow attachedContext={attachedContext} showToast={showToast} sceneCardOptions={sceneCardOptions} />
            {canAdjust && (
              <div className="composerModeRow">
                <label className={`composerModeOpt${isAutoIntent ? " active" : ""}`}>
                  <input type="radio" name="turnMode" checked={isAutoIntent} onChange={() => setModeOverride(null)} />
                  {L("自动判断", "Auto")}
                </label>
                <label className={`composerModeOpt${isAdjust ? " active" : ""}`}>
                  <input type="radio" name="turnMode" checked={isAdjust} onChange={() => setModeOverride("adjust")} />
                  {L("调整当前场景", "Adjust this scene")}
                </label>
                <label className={`composerModeOpt${modeOverride === "generate" ? " active" : ""}`}>
                  <input type="radio" name="turnMode" checked={modeOverride === "generate"} onChange={() => setModeOverride("generate")} />
                  {L("生成新场景", "New scene")}
                </label>
              </div>
            )}
            <div className="composerInputRow">
              <button
                type="button"
                className="composerIconBtn"
                title={L("上传文件或图片", "Attach")}
                aria-haspopup="menu"
                aria-expanded={composerAttach.attachMenuOpen}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setAttachMenuPos({ x: Math.round(rect.left), y: Math.round(rect.top) });
                  composerAttach.toggleAttachMenu();
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M10 4v12M4 10h12" />
                </svg>
              </button>
              <input
                ref={composerAttach.fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={composerAttach.handleFileInputChange}
              />
              <textarea
                ref={composerRef}
                className="composerInput"
                rows={1}
                value={prompt}
                placeholder={
                  isAdjust
                    ? L('描述你想要的改动，例如"把盒子改成红色"…', 'Describe the change, e.g. "make the box red"…')
                    : L("描述你想创造的 3D 世界...", "Describe the 3D world you want to create...")
                }
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <div className="composerActions">
                <select
                  className="composerModelSelect"
                  aria-label={L("模型", "Model")}
                  value={selectedProviderId}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                >
                  {selectableProviders.length === 0 && <option value="">{L("默认模型", "Default model")}</option>}
                  {selectableProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label || p.id}
                    </option>
                  ))}
                </select>
                {busy ? (
                  <button
                    type="button"
                    className="composerSendBtn composerSendBtnStop"
                    title={busyStoppable ? L("停止", "Stop") : L("正在准备…", "Preparing…")}
                    disabled={!busyStoppable}
                    onClick={() => abortRef.current?.abort()}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="composerSendBtn"
                    title={L("发送", "Send")}
                    disabled={!prompt.trim()}
                    onClick={() => void send(prompt)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path fill="currentColor" d="M10 3.5 16.5 16h-13L10 3.5z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="composerHint">
            {L("ThreeBox 可能会生成不准确的场景，请检查生成结果。", "ThreeBox may produce inaccurate scenes; please review the result.")}
          </div>
        </div>

      </main>

      {composerAttach.attachMenuOpen && attachMenuPos && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={composerAttach.closeAttachMenu}
          />
          <div
            id="attachTypeMenu"
            className="contextMenu"
            style={{
              position: "fixed",
              left: Math.max(8, attachMenuPos.x),
              // Anchor the menu's bottom just above the attach button.
              bottom: Math.max(8, window.innerHeight - attachMenuPos.y + 8),
              zIndex: 41
            }}
          >
            {ATTACH_KIND_ORDER.map(({ kind, labelKey, fallback }) => (
              <button key={kind} type="button" onClick={() => composerAttach.chooseKind(kind)}>
                {t(labelKey, fallback)}
              </button>
            ))}
            <button type="button" onClick={() => composerAttach.chooseKind("library")}>
              {t("threebox.shell.attachKindLibrary", "从资源库选择")}
            </button>
          </div>
        </>
      )}

      {historyMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setHistoryMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setHistoryMenu(null);
            }}
          />
          <div
            className="contextMenu"
            style={{
              position: "fixed",
              left: Math.min(historyMenu.x, window.innerWidth - 200),
              top: Math.min(historyMenu.y, window.innerHeight - 200),
              zIndex: 41
            }}
          >
            <button
              type="button"
              onClick={() => {
                void togglePin(historyMenu.conv);
                setHistoryMenu(null);
              }}
            >
              {historyMenu.conv.pinned ? L("取消置顶", "Unpin") : L("置顶", "Pin")}
            </button>
            <button
              type="button"
              onClick={() => {
                void toggleArchive(historyMenu.conv);
                setHistoryMenu(null);
              }}
            >
              {historyMenu.conv.archived ? L("取消归档", "Unarchive") : L("归档", "Archive")}
            </button>
            {projects.length > 0 && <div className="contextMenuSubLabel">{L("移入项目", "Move to project")}</div>}
            <div className="contextMenuSubList">
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => {
                    void moveToProject(historyMenu.conv, proj.id);
                    setHistoryMenu(null);
                  }}
                >
                  {proj.name}
                </button>
              ))}
              {historyMenu.conv.projectId && (
                <button
                  type="button"
                  onClick={() => {
                    void moveToProject(historyMenu.conv, null);
                    setHistoryMenu(null);
                  }}
                >
                  {L("移出项目", "Remove from project")}
                </button>
              )}
            </div>
            <button
              type="button"
              className="contextMenuDanger"
              onClick={() => {
                const c = historyMenu.conv;
                setHistoryMenu(null);
                void removeConversation(c);
              }}
            >
              {L("删除", "Delete")}
            </button>
          </div>
        </>
      )}

      {toast && (
        <div className={`messageToast show ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}

      {showPrivacy && (
        <PrivacyDialog
          onAccept={() => {
            provider.acceptPrivacy();
            setShowPrivacy(false);
            // Now that the agreement is accepted, issue the trial key + quota.
            void ensureBuiltinApiKey(threeBoxSettingsController);
          }}
          onDecline={() => {
            provider.declinePrivacy();
            setShowPrivacy(false);
            openSettings("ai");
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          initialSectionId={settingsSection}
          privacyAccepted={provider.privacyAccepted}
          showToast={showToast}
          onSyncNow={() => selfHostedSync.syncNow()}
          onClose={() => setShowSettings(false)}
          onOpenPrivacy={() => {
            setShowSettings(false);
            setShowPrivacy(true);
          }}
        />
      )}

      {showSearch && (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setShowSearch(false)}>
          <div className="modalDialog">
            <div className="modalHeader">{L("搜索聊天", "Search chats")}</div>
            <div className="modalBody">
              <input
                type="search"
                className="sidebarSearchInput"
                placeholder={L("按标题搜索...", "Search by title...")}
                value={searchQuery}
                autoFocus
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="searchChatResults">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="searchChatResult"
                    onClick={() => {
                      setShowSearch(false);
                      void openConversation(c.id);
                    }}
                  >
                    {c.title || L("未命名", "Untitled")}
                  </button>
                ))}
                {searchResults.length === 0 && <div className="historyEmpty">{L("无匹配。", "No matches.")}</div>}
              </div>
            </div>
            <div className="modalFooter">
              <button type="button" onClick={() => setShowSearch(false)}>
                {L("关闭", "Close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setShowHelp(false)}>
          <div className="modalDialog">
            <div className="modalHeader">{L("帮助", "Help")}</div>
            <div className="modalBody">
              <p>{L("遇到问题？欢迎通过以下方式联系我们：", "Having trouble? Reach us via:")}</p>
              <ul className="helpContactList">
                <li>
                  <span>{L("邮箱反馈：", "Email: ")}</span>
                  <a href="mailto:threejson@outlook.com">threejson@outlook.com</a>
                </li>
                <li>
                  <span>{L("或提交 GitHub Issue：", "Or file a GitHub issue: ")}</span>
                  <a href="https://github.com/nnrj/threejson/issues" target="_blank" rel="noreferrer">
                    github.com/nnrj/threejson/issues
                  </a>
                </li>
              </ul>
            </div>
            <div className="modalFooter">
              <button type="button" onClick={() => setShowHelp(false)}>
                {L("关闭", "Close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
