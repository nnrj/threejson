import { renderMarkdownToSafeHtml } from "./threeBoxMarkdown.js";

/**
 * @param {{ onUserMessage?: (text: string, api: { appendAssistantMessage: (t: string) => HTMLElement, updateAssistantMessage: (el: HTMLElement, t: string) => void }) => Promise<void>|void }} [host]
 */
export function createThreeBoxChatPanel(host = {}) {
  const chatHero = document.getElementById("chatHero");
  const chatMessages = document.getElementById("chatMessages");
  const composerInput = document.getElementById("composerInput");
  const composerSendBtn = document.getElementById("composerSendBtn");
  const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");

  const NEAR_BOTTOM_PX = 48;
  function isNearBottom() {
    if (!chatMessages) {
      return true;
    }
    return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < NEAR_BOTTOM_PX;
  }
  function syncScrollToBottomBtn() {
    if (scrollToBottomBtn) {
      scrollToBottomBtn.hidden = isNearBottom();
    }
  }

  let messages = [];

  function showMessagesView() {
    if (chatHero) {
      chatHero.hidden = true;
    }
    if (chatMessages) {
      chatMessages.hidden = false;
    }
  }

  function showHeroView() {
    if (chatHero) {
      chatHero.hidden = false;
    }
    if (chatMessages) {
      chatMessages.hidden = true;
    }
  }

  function buildAvatar(role) {
    const el = document.createElement("div");
    el.className = `chatMessageAvatar chatMessageAvatar${role === "user" ? "User" : "Assistant"}`;
    if (role === "user") {
      el.textContent = "U";
    } else {
      const img = document.createElement("img");
      img.src = "../../../assets/img/ThreeJSON.png";
      img.alt = "ThreeBox";
      el.appendChild(img);
    }
    return el;
  }

  function scrollToBottom() {
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    syncScrollToBottomBtn();
  }

  function appendMessage(role, text) {
    messages.push({ role, text });
    if (!chatMessages) {
      return null;
    }
    const row = document.createElement("div");
    row.className = `chatMessage chatMessage${role === "user" ? "User" : "Assistant"}`;
    row.appendChild(buildAvatar(role));

    const body = document.createElement("div");
    body.className = "chatMessageBody";
    const textEl = document.createElement("div");
    textEl.className = "chatMessageText";
    if (role === "assistant") {
      textEl.classList.add("markdown-body");
      textEl.innerHTML = renderMarkdownToSafeHtml(text);
    } else {
      textEl.textContent = text;
    }
    body.appendChild(textEl);
    row.appendChild(body);
    chatMessages.appendChild(row);
    scrollToBottom();
    return textEl;
  }

  function updateAssistantMessage(textEl, text) {
    if (!textEl) {
      return;
    }
    textEl.classList.add("markdown-body");
    textEl.innerHTML = renderMarkdownToSafeHtml(text);
    scrollToBottom();
  }

  /** Appends an arbitrary element (e.g. a collapsible JSON block, or the inline scene canvas) as
   * the last child of an assistant message's body — i.e. after whatever was appended before it. */
  function appendToBody(referenceEl, el) {
    if (!referenceEl?.parentElement || !el) {
      return;
    }
    referenceEl.parentElement.appendChild(el);
    scrollToBottom();
  }

  /** Fixed-height, auto-scrolling live preview for in-progress streamed text (raw JSON isn't
   * valid/formattable mid-stream, so this deliberately does NOT run it through the markdown
   * renderer). Click toggles between the compact scroll view and a taller expanded view. */
  function createStreamingBlock() {
    const el = document.createElement("pre");
    el.className = "streamingPreview";
    el.addEventListener("click", () => el.classList.toggle("expanded"));
    function update(text) {
      el.textContent = text;
      el.scrollTop = el.scrollHeight;
    }
    return { el, update, remove: () => el.remove() };
  }

  /** Collapsed-by-default <details> block holding the final generated JSON (kept out of the
   * markdown-rendered recap text since it can be very long). */
  function buildJsonCollapse(jsonString) {
    const details = document.createElement("details");
    details.className = "jsonCollapse";
    const summary = document.createElement("summary");
    summary.textContent = "查看生成的 JSON";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = jsonString;
    pre.appendChild(code);
    details.appendChild(summary);
    details.appendChild(pre);
    return details;
  }

  function clear() {
    messages = [];
    if (chatMessages) {
      chatMessages.innerHTML = "";
    }
    showHeroView();
  }

  async function sendMessage(rawText) {
    const text = String(rawText || "").trim();
    if (!text) {
      return;
    }
    showMessagesView();
    appendMessage("user", text);
    if (composerInput) {
      composerInput.value = "";
      composerInput.style.height = "auto";
    }

    if (host.onUserMessage) {
      await host.onUserMessage(text, {
        appendAssistantMessage: (t) => appendMessage("assistant", t),
        updateAssistantMessage,
        appendToBody,
        createStreamingBlock,
        buildJsonCollapse
      });
      return;
    }

    // No generation wiring yet (next milestone) — a canned reply exercises the markdown /
    // code-block rendering pipeline end to end so it can be verified now.
    const demoReply = [
      "这是一个演示回复，用于验证 Markdown 渲染管线（真正的 AI 对话生成将在下一个里程碑接入）。",
      "",
      "```json",
      JSON.stringify({ threeJsonId: "demo", note: "占位 JSON 代码块" }, null, 2),
      "```"
    ].join("\n");
    appendMessage("assistant", demoReply);
  }

  function init() {
    composerSendBtn?.addEventListener("click", () => {
      void sendMessage(composerInput?.value);
    });
    composerInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendMessage(composerInput?.value);
      }
    });
    chatMessages?.addEventListener("scroll", syncScrollToBottomBtn);
    scrollToBottomBtn?.addEventListener("click", () => {
      if (chatMessages) {
        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: "smooth" });
      }
    });
  }

  return {
    init,
    sendMessage,
    appendMessage,
    updateAssistantMessage,
    appendToBody,
    createStreamingBlock,
    buildJsonCollapse,
    clear,
    showHeroView,
    showMessagesView
  };
}
