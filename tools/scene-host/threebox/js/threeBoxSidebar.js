import { showToast } from "./threeBoxUiFeedback.js";
import {
  putConversation,
  getAllConversations,
  deleteConversation,
  deleteTurnsForConversation,
  putProject,
  getAllProjects
} from "./threeBoxSessionStore.js";
import { t } from "../../shared/i18n/index.js";

/**
 * ThreeBox keeps its own conversation/project history, entirely independent from the Scene
 * Editor's session storage (different localStorage/IndexedDB namespace — see
 * threeBoxSessionStore.js). A fresh ThreeBox session therefore starts with a genuinely empty
 * history list (no seeded placeholder conversations) until the user actually creates chats.
 * `conversations`/`projects` are hydrated from IndexedDB on init() and every mutation site below
 * calls putConversation/putProject to persist it — the underlying turn data was always cached,
 * but this metadata (title, pin/archive state, project grouping) previously lived in memory only
 * and vanished on every page refresh.
 */
const TEMPLATE_GALLERY_EXPANDED_KEY = "threejson.threebox.templateGallery.expanded";

function formatRelativeTime(ts) {
  const diffMs = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) {
    return t("threebox.sidebar.timeJustNow", "刚刚");
  }
  if (diffMs < hour) {
    return t("threebox.sidebar.timeMinutesAgo", "{n} 分钟前", { n: Math.floor(diffMs / minute) });
  }
  if (diffMs < day) {
    return t("threebox.sidebar.timeHoursAgo", "{n} 小时前", { n: Math.floor(diffMs / hour) });
  }
  return t("threebox.sidebar.timeDaysAgo", "{n} 天前", { n: Math.floor(diffMs / day) });
}

/**
 * @param {{ openAiConfig?: () => void, openSettings?: () => void, closeLeftDock?: () => void, onNewChat?: (conv: object) => void, onSelectConversation?: (id: string) => void, onDeleteConversation?: (conv: object, detail: { wasActive: boolean }) => void|Promise<void> }} [host]
 */
export function createThreeBoxSidebar(host = {}) {
  const templateSearchInput = document.getElementById("templateSearchInput");
  const projectListEl = document.getElementById("projectList");
  const newProjectBtn = document.getElementById("newProjectBtn");
  const historyListEl = document.getElementById("historyList");
  const archivedListEl = document.getElementById("archivedHistoryList");
  const archivedSection = document.getElementById("archivedSection");
  const navAiConfigBtn = document.getElementById("navAiConfigBtn");
  const navNewChatBtn = document.getElementById("navNewChatBtn");
  const navSearchChatBtn = document.getElementById("navSearchChatBtn");
  const userMenuBtn = document.getElementById("userMenuBtn");
  const userMenuPanel = document.getElementById("userMenuPanel");
  const searchChatModal = document.getElementById("searchChatModal");
  const searchChatInput = document.getElementById("searchChatInput");
  const searchChatResults = document.getElementById("searchChatResults");
  const searchChatCloseBtn = document.getElementById("searchChatCloseBtn");
  const helpModal = document.getElementById("helpModal");
  const helpCloseBtn = document.getElementById("helpCloseBtn");
  const historyContextMenu = document.getElementById("historyContextMenu");
  const moveToProjectList = document.getElementById("moveToProjectList");
  const templateGallerySection = document.getElementById("templateGallerySection");

  let conversations = [];
  let projects = [];
  let activeConversationId = null;
  let contextMenuTargetId = "";

  function activeConversations() {
    return conversations
      .filter((c) => !c.archived)
      .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.updatedAt - a.updatedAt));
  }

  function archivedConversationsList() {
    return conversations.filter((c) => c.archived).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function renderProjects() {
    if (!projectListEl) {
      return;
    }
    projectListEl.innerHTML = "";
    if (projects.length === 0) {
      const hint = document.createElement("div");
      hint.className = "sidebarStubHint";
      hint.textContent = t("threebox.sidebar.projectsEmpty", "暂无项目。");
      projectListEl.appendChild(hint);
    }
    for (const project of projects) {
      const el = document.createElement("div");
      el.className = "projectItem";
      el.textContent = project.name;
      el.addEventListener("click", () => {
        showToast(t("threebox.sidebar.toastProjectComingSoon", "项目「{name}」的会话列表将在后续里程碑接入。", { name: project.name }), "info");
      });
      projectListEl.appendChild(el);
    }
  }

  function buildHistoryItemEl(conv) {
    const el = document.createElement("div");
    el.className = "historyItem";
    el.dataset.convId = conv.id;
    if (conv.id === activeConversationId) {
      el.classList.add("active");
    }

    const pinIcon = document.createElement("svg");
    pinIcon.setAttribute("viewBox", "0 0 16 16");
    pinIcon.className = "historyItemPin";
    pinIcon.hidden = !conv.pinned;
    pinIcon.innerHTML =
      '<path fill="currentColor" d="M8 1.6 9.4 5.5 13.3 6.4 9.4 7.3 8 11.2 6.6 7.3 2.7 6.4 6.6 5.5 8 1.6z"/>';
    el.appendChild(pinIcon);

    const body = document.createElement("div");
    body.className = "historyItemBody";
    const title = document.createElement("div");
    title.className = "historyItemTitle";
    title.textContent = conv.title;
    const meta = document.createElement("div");
    meta.className = "historyItemMeta";
    const projectLabel = conv.projectId ? projects.find((p) => p.id === conv.projectId)?.name : "";
    meta.textContent = projectLabel ? `${formatRelativeTime(conv.updatedAt)} · ${projectLabel}` : formatRelativeTime(conv.updatedAt);
    body.appendChild(title);
    body.appendChild(meta);
    el.appendChild(body);

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "historyItemMenuBtn";
    menuBtn.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="3.4" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="12.6" r="1.2" fill="currentColor"/></svg>';
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      openHistoryContextMenu(conv, rect.right, rect.bottom);
    });
    el.appendChild(menuBtn);

    el.addEventListener("click", () => {
      activeConversationId = conv.id;
      renderHistoryList();
      host.onSelectConversation?.(conv.id);
      host.closeLeftDock?.();
    });

    return el;
  }

  function renderHistoryList() {
    if (historyListEl) {
      historyListEl.innerHTML = "";
      const active = activeConversations();
      if (active.length === 0) {
        const hint = document.createElement("div");
        hint.className = "sidebarStubHint";
        hint.textContent = t("threebox.sidebar.historyEmpty", "暂无聊天记录，点击「新聊天」开始。");
        historyListEl.appendChild(hint);
      }
      for (const conv of active) {
        historyListEl.appendChild(buildHistoryItemEl(conv));
      }
    }
    if (archivedListEl) {
      archivedListEl.innerHTML = "";
      const archived = archivedConversationsList();
      for (const conv of archived) {
        archivedListEl.appendChild(buildHistoryItemEl(conv));
      }
      if (archivedSection) {
        archivedSection.hidden = archived.length === 0;
      }
    }
  }

  function closeHistoryContextMenu() {
    if (historyContextMenu) {
      historyContextMenu.hidden = true;
    }
    contextMenuTargetId = "";
    document.querySelectorAll(".historyItemMenuBtn.menuOpen").forEach((btn) => btn.classList.remove("menuOpen"));
  }

  function openHistoryContextMenu(conv, clientX, clientY) {
    if (!historyContextMenu) {
      return;
    }
    contextMenuTargetId = conv.id;
    const pinBtn = historyContextMenu.querySelector('[data-action="pin"]');
    if (pinBtn) {
      pinBtn.textContent = conv.pinned ? t("threebox.sidebar.unpin", "取消置顶") : t("threebox.shell.pin", "置顶");
    }
    const archiveBtn = historyContextMenu.querySelector('[data-action="archive"]');
    if (archiveBtn) {
      archiveBtn.textContent = conv.archived
        ? t("threebox.sidebar.unarchive", "取消归档")
        : t("threebox.shell.archive", "归档");
    }
    if (moveToProjectList) {
      moveToProjectList.innerHTML = "";
      if (projects.length === 0) {
        const hint = document.createElement("div");
        hint.className = "contextMenuEmptyHint";
        hint.textContent = t("threebox.sidebar.noProjectsHint", "暂无项目，请先在「项目」区新建。");
        moveToProjectList.appendChild(hint);
      } else {
        if (conv.projectId) {
          const clearBtn = document.createElement("button");
          clearBtn.type = "button";
          clearBtn.textContent = t("threebox.sidebar.moveOutOfProject", "移出项目");
          clearBtn.addEventListener("click", () => {
            conv.projectId = null;
            void putConversation(conv);
            closeHistoryContextMenu();
            renderHistoryList();
          });
          moveToProjectList.appendChild(clearBtn);
        }
        for (const project of projects) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = project.name + (project.id === conv.projectId ? " ✓" : "");
          btn.addEventListener("click", () => {
            conv.projectId = project.id;
            void putConversation(conv);
            closeHistoryContextMenu();
            renderHistoryList();
          });
          moveToProjectList.appendChild(btn);
        }
      }
    }
    historyContextMenu.hidden = false;
    const menuRect = historyContextMenu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - menuRect.width - 8);
    const top = Math.min(clientY, window.innerHeight - menuRect.height - 8);
    historyContextMenu.style.left = `${Math.max(8, left)}px`;
    historyContextMenu.style.top = `${Math.max(8, top)}px`;
    document.querySelectorAll(".historyItemMenuBtn").forEach((btn) => btn.classList.remove("menuOpen"));
  }

  function findConversation(id) {
    return conversations.find((c) => c.id === id) || null;
  }

  function wireHistoryContextMenu() {
    historyContextMenu?.querySelector('[data-action="pin"]')?.addEventListener("click", () => {
      const conv = findConversation(contextMenuTargetId);
      if (conv) {
        conv.pinned = !conv.pinned;
        void putConversation(conv);
        renderHistoryList();
        showToast(
          conv.pinned ? t("threebox.sidebar.toastPinned", "已置顶") : t("threebox.sidebar.toastUnpinned", "已取消置顶"),
          "success"
        );
      }
      closeHistoryContextMenu();
    });
    historyContextMenu?.querySelector('[data-action="archive"]')?.addEventListener("click", () => {
      const conv = findConversation(contextMenuTargetId);
      if (conv) {
        conv.archived = !conv.archived;
        void putConversation(conv);
        renderHistoryList();
        showToast(
          conv.archived ? t("threebox.sidebar.toastArchived", "已归档") : t("threebox.sidebar.toastUnarchived", "已取消归档"),
          "success"
        );
      }
      closeHistoryContextMenu();
    });
    historyContextMenu?.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      const conv = findConversation(contextMenuTargetId);
      if (!conv) {
        closeHistoryContextMenu();
        return;
      }
      const confirmed = window.confirm(
        t(
          "threebox.sidebar.deleteConfirm",
          "确定删除聊天“{title}”吗？此操作无法撤销。",
          { title: conv.title }
        )
      );
      if (!confirmed) {
        closeHistoryContextMenu();
        return;
      }

      const wasActive = conv.id === activeConversationId;
      closeHistoryContextMenu();
      try {
        await deleteTurnsForConversation(conv.id);
        await deleteConversation(conv.id);
        conversations = conversations.filter((item) => item.id !== conv.id);
        if (wasActive) {
          activeConversationId = null;
        }
        renderHistoryList();
        renderSearchChatResults(searchChatInput?.value || "");
        await host.onDeleteConversation?.(conv, { wasActive });
        showToast(t("threebox.sidebar.toastDeleted", "聊天已删除。"), "success");
      } catch (error) {
        console.error("[threebox] failed to delete conversation:", error);
        showToast(
          t("threebox.sidebar.toastDeleteFailed", "删除聊天失败：{error}", {
            error: error?.message || error
          }),
          "error"
        );
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (historyContextMenu && !historyContextMenu.hidden && !historyContextMenu.contains(event.target)) {
        closeHistoryContextMenu();
      }
    });
  }

  function renderSearchChatResults(query) {
    if (!searchChatResults) {
      return;
    }
    searchChatResults.innerHTML = "";
    const q = query.trim().toLowerCase();
    const matches = conversations
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (matches.length === 0) {
      const hint = document.createElement("div");
      hint.className = "searchChatEmptyHint";
      hint.textContent = t("threebox.sidebar.searchNoResults", "未找到匹配的聊天。");
      searchChatResults.appendChild(hint);
      return;
    }
    for (const conv of matches) {
      const el = document.createElement("div");
      el.className = "searchChatResultItem";
      const title = document.createElement("div");
      title.className = "searchChatResultTitle";
      title.textContent = conv.title;
      const meta = document.createElement("div");
      meta.className = "searchChatResultMeta";
      meta.textContent = `${formatRelativeTime(conv.updatedAt)}${conv.archived ? t("threebox.sidebar.archivedSuffix", " · 已归档") : ""}`;
      el.appendChild(title);
      el.appendChild(meta);
      el.addEventListener("click", () => {
        activeConversationId = conv.id;
        renderHistoryList();
        host.onSelectConversation?.(conv.id);
        closeSearchChatModal();
        host.closeLeftDock?.();
      });
      searchChatResults.appendChild(el);
    }
  }

  function openSearchChatModal() {
    if (!searchChatModal) {
      return;
    }
    searchChatModal.hidden = false;
    if (searchChatInput) {
      searchChatInput.value = "";
      searchChatInput.focus();
    }
    renderSearchChatResults("");
  }

  function closeSearchChatModal() {
    if (searchChatModal) {
      searchChatModal.hidden = true;
    }
  }

  function openHelpModal() {
    if (helpModal) {
      helpModal.hidden = false;
    }
  }

  function closeHelpModal() {
    if (helpModal) {
      helpModal.hidden = true;
    }
  }

  function createConversationRecord() {
    const id = `conv-${Date.now().toString(36)}`;
    const conv = {
      id,
      title: t("threebox.shell.newChat", "新聊天"),
      updatedAt: Date.now(),
      pinned: false,
      archived: false,
      projectId: null
    };
    conversations.unshift(conv);
    activeConversationId = id;
    void putConversation(conv);
    renderHistoryList();
    return conv;
  }

  /** Explicit "新聊天" action (nav button / user menu): creates a conversation AND resets the chat panel to its empty hero state. */
  function createNewChat() {
    const conv = createConversationRecord();
    host.onNewChat?.(conv);
    return conv;
  }

  /** Silent conversation creation used when a message is sent with no active conversation yet
   * (e.g. typed directly into the hero composer) — must NOT fire onNewChat, since that would
   * reset the chat panel and wipe the message that's already being rendered. */
  function ensureActiveConversation() {
    if (activeConversationId && findConversation(activeConversationId)) {
      return findConversation(activeConversationId);
    }
    return createConversationRecord();
  }

  /** Bumps the active conversation's updatedAt (and titles it, if still the "新聊天" default) after a real turn completes. */
  function touchActiveConversation(titleHint) {
    const conv = findConversation(activeConversationId);
    if (!conv) {
      return;
    }
    conv.updatedAt = Date.now();
    if (conv.title === t("threebox.shell.newChat", "新聊天") && titleHint) {
      conv.title = titleHint.length > 24 ? `${titleHint.slice(0, 24)}…` : titleHint;
    }
    void putConversation(conv);
    renderHistoryList();
  }

  function wireNav() {
    navAiConfigBtn?.addEventListener("click", () => {
      if (host.openAiConfig) {
        host.openAiConfig();
      } else {
        showToast(t("threebox.sidebar.toastAiConfigComingSoon", "AI 配置面板将在后续里程碑接入。"), "info");
      }
      host.closeLeftDock?.();
    });
    navNewChatBtn?.addEventListener("click", () => {
      createNewChat();
      showToast(t("threebox.sidebar.toastNewChat", "已新建聊天。"), "success");
      host.closeLeftDock?.();
    });
    navSearchChatBtn?.addEventListener("click", () => {
      openSearchChatModal();
      host.closeLeftDock?.();
    });
    searchChatCloseBtn?.addEventListener("click", closeSearchChatModal);
    searchChatModal?.addEventListener("click", (event) => {
      if (event.target === searchChatModal) {
        closeSearchChatModal();
      }
    });
    searchChatInput?.addEventListener("input", () => renderSearchChatResults(searchChatInput.value));
    helpCloseBtn?.addEventListener("click", closeHelpModal);
    helpModal?.addEventListener("click", (event) => {
      if (event.target === helpModal) {
        closeHelpModal();
      }
    });

    newProjectBtn?.addEventListener("click", () => {
      const name = window.prompt(t("threebox.sidebar.newProjectPrompt", "新建项目名称："), "");
      const trimmed = (name || "").trim();
      if (!trimmed) {
        return;
      }
      const project = { id: `proj-${Date.now().toString(36)}`, name: trimmed };
      projects.push(project);
      void putProject(project);
      renderProjects();
      showToast(t("threebox.sidebar.toastNewProject", "已新建项目「{name}」。", { name: trimmed }), "success");
      host.closeLeftDock?.();
    });

    templateSearchInput?.addEventListener("input", () => {
      host.onTemplateSearch?.(templateSearchInput.value);
    });
  }

  function wireUserMenu() {
    userMenuBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!userMenuPanel) {
        return;
      }
      userMenuPanel.hidden = !userMenuPanel.hidden;
    });
    document.addEventListener("pointerdown", (event) => {
      if (userMenuPanel && !userMenuPanel.hidden && !userMenuPanel.contains(event.target) && event.target !== userMenuBtn) {
        userMenuPanel.hidden = true;
      }
    });
    userMenuPanel?.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        userMenuPanel.hidden = true;
        if (action === "settings") {
          if (host.openSettings) {
            host.openSettings();
          } else {
            showToast(t("threebox.sidebar.toastSettingsComingSoon", "设置面板将在后续里程碑接入。"), "info");
          }
          return;
        }
        if (action === "help") {
          openHelpModal();
          return;
        }
        if (action === "cloud") {
          void host.openCloud?.();
          return;
        }
        showToast(t("threebox.sidebar.toastFeatureComingSoon", "该功能将在后续里程碑接入。"), "info");
      });
    });
  }

  /** Template gallery starts collapsed; remembers the user's expand/collapse choice locally
   * (independent of the editor's storage — see the module docblock above). */
  function wireTemplateGalleryMemory() {
    if (!templateGallerySection) {
      return;
    }
    let expanded = false;
    try {
      expanded = localStorage.getItem(TEMPLATE_GALLERY_EXPANDED_KEY) === "1";
    } catch (_error) {
      /* ignore */
    }
    templateGallerySection.open = expanded;
    templateGallerySection.addEventListener("toggle", () => {
      try {
        localStorage.setItem(TEMPLATE_GALLERY_EXPANDED_KEY, templateGallerySection.open ? "1" : "0");
      } catch (_error) {
        /* ignore */
      }
    });
  }

  async function init() {
    const [loadedConversations, loadedProjects] = await Promise.all([
      getAllConversations().catch(() => []),
      getAllProjects().catch(() => [])
    ]);
    conversations = loadedConversations;
    projects = loadedProjects;
    renderProjects();
    renderHistoryList();
    wireHistoryContextMenu();
    wireNav();
    wireUserMenu();
    wireTemplateGalleryMemory();
  }

  /** Re-renders every dynamic (non data-i18n-attributed) list after a locale switch, so labels
   * like relative-time strings and empty-state hints pick up the new language immediately. */
  function refresh() {
    renderProjects();
    renderHistoryList();
  }

  return {
    init,
    refresh,
    getActiveConversationId: () => activeConversationId,
    createNewChat,
    ensureActiveConversation,
    touchActiveConversation
  };
}
