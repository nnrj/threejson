import { renderMarkdownToSafeHtml } from "./threeBoxMarkdown.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t } from "../../shared/i18n/index.js";

const SEND_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10 3.5 16.5 16h-13L10 3.5z"/></svg>';
const STOP_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>';

/**
 * @param {{ onUserMessage?: (text: string, api: { appendAssistantMessage: (t: string) => HTMLElement, updateAssistantMessage: (el: HTMLElement, t: string) => void }) => Promise<void>|void, onStopRequested?: () => void }} [host]
 *   `onStopRequested` is called when the composer's send button is clicked while `setBusy(true)`
 *   is active (the button doubles as a stop button during an in-flight turn — see setBusy below).
 */
export function createThreeBoxChatPanel(host = {}) {
  const chatHero = document.getElementById("chatHero");
  const chatMessages = document.getElementById("chatMessages");
  const composerInput = document.getElementById("composerInput");
  const composerSendBtn = document.getElementById("composerSendBtn");
  const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");

  let busy = false;
  let turnSpacer = null;

  /** Toggles the composer's send button into a stop button for the duration of an in-flight
   * generate/adjust turn — clicking it while busy calls `host.onStopRequested` instead of
   * sending, and Enter is ignored (the existing text stays in the composer rather than queuing a
   * second concurrent turn). The caller (threeBoxApp.js) is responsible for pairing every
   * `setBusy(true)` with a `setBusy(false)` once the turn settles (success, failure, or abort). */
  function setBusy(isBusy) {
    busy = Boolean(isBusy);
    if (!composerSendBtn) {
      return;
    }
    composerSendBtn.innerHTML = busy ? STOP_ICON : SEND_ICON;
    composerSendBtn.classList.toggle("composerSendBtnStop", busy);
    const label = busy ? t("threebox.shell.stop", "停止") : t("threebox.shell.send", "发送");
    composerSendBtn.title = label;
    composerSendBtn.setAttribute("aria-label", label);
  }

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
      img.src = "../../../assets/img/logo/threejson-logo-256.png";
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

  function ensureTurnSpacer() {
    if (!chatMessages) {
      return;
    }
    if (!turnSpacer) {
      turnSpacer = document.createElement("div");
      turnSpacer.className = "chatTurnSpacer";
      turnSpacer.setAttribute("aria-hidden", "true");
    }
    if (turnSpacer.parentElement !== chatMessages) {
      chatMessages.appendChild(turnSpacer);
    }
  }

  function removeTurnSpacer() {
    turnSpacer?.remove();
    turnSpacer = null;
  }

  /** Aligns `row`'s top edge to the top of the visible chat area, leaving the rest of the
   * viewport blank below it — called right after appending the user's own message, so the
   * assistant's reply has empty space to grow into instead of the view jumping straight to the
   * bottom the instant Send is pressed (which is where most of the anxiety-inducing jitter during
   * streaming actually comes from: constant small hard-scrolls as blocks are appended one by one). */
  function pinRowNearTop(row) {
    if (!row) {
      return;
    }
    ensureTurnSpacer();
    row.scrollIntoView({ block: "start", behavior: "auto" });
    syncScrollToBottomBtn();
  }

  /** Scrolls just enough to bring `el` fully into view if it isn't already — a no-op while
   * there's still blank space left over from pinRowNearTop (so no jitter while the reply is
   * short), and naturally starts "following" once growing content reaches the bottom of the
   * viewport, exactly like a normal chat's auto-scroll once there's actually something new to
   * reveal. Used for every append *during* a turn; the turn's true end still calls the hard
   * scrollToBottom via finishTurnScroll so the final state always lands exactly at the bottom. */
  function revealBottomOf(el) {
    if (!el) {
      return;
    }
    el.scrollIntoView({ block: "nearest", behavior: "auto" });
    syncScrollToBottomBtn();
  }

  /** Called once a turn (generate/adjust, success or failure/stopped) has fully finished
   * appending content — guarantees the view ends up exactly at the bottom (not just "close
   * enough" from revealBottomOf's nearest-edge scrolling), matching the pre-existing always-at-
   * bottom behavior for the settled state. */
  function finishTurnScroll() {
    removeTurnSpacer();
    scrollToBottom();
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
    if (turnSpacer?.parentElement === chatMessages) {
      chatMessages.insertBefore(row, turnSpacer);
    } else {
      chatMessages.appendChild(row);
    }
    if (role === "user") {
      pinRowNearTop(row);
    } else {
      revealBottomOf(row);
    }
    return textEl;
  }

  function updateAssistantMessage(textEl, text) {
    if (!textEl) {
      return;
    }
    textEl.classList.add("markdown-body");
    textEl.innerHTML = renderMarkdownToSafeHtml(text);
    revealBottomOf(textEl);
  }

  /** Appends an arbitrary element (e.g. a collapsible JSON block, or the inline scene canvas) as
   * the last child of an assistant message's body — i.e. after whatever was appended before it. */
  function appendToBody(referenceEl, el) {
    if (!referenceEl?.parentElement || !el) {
      return;
    }
    referenceEl.parentElement.appendChild(el);
    revealBottomOf(el);
  }

  /** Fixed-height, auto-scrolling live preview for in-progress streamed text (raw JSON isn't
   * valid/formattable mid-stream, so this deliberately does NOT run it through the markdown
   * renderer). Click toggles between the compact scroll view and a taller expanded view. */
  function createStreamingBlock() {
    const el = document.createElement("pre");
    el.className = "streamingPreview streamingPreviewPending";
    // Show something immediately: with a slow model the first delta can take several seconds to
    // arrive, and an empty block during that wait reads as "nothing happened" after Send.
    el.textContent = t("threebox.chat.generating", "正在生成…");
    el.addEventListener("click", () => el.classList.toggle("expanded"));
    function update(text) {
      el.classList.remove("streamingPreviewPending");
      el.classList.remove("streamingPreviewProcessing");
      el.textContent = text;
      el.scrollTop = el.scrollHeight;
      revealBottomOf(el);
    }
    function processing(message = "") {
      el.classList.add("streamingPreviewPending", "streamingPreviewProcessing");
      el.textContent = message || t(
        "threebox.chat.preparingScene",
        "JSON 已生成，正在解析并准备场景预览（不消耗 Token）…"
      );
      revealBottomOf(el);
    }
    return { el, update, processing, remove: () => el.remove() };
  }

  const COPY_ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="8" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M3.5 10.5v-6a1 1 0 0 1 1-1h6"/></svg>';
  const CHECK_ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';

  function getJsonViewerOptions() {
    const opts = typeof host.getJsonViewerOptions === "function" ? host.getJsonViewerOptions() : {};
    return {
      lineNumbers: opts.lineNumbers !== false,
      highlight: opts.highlight !== false
    };
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightJsonLine(line) {
    return escapeHtml(line).replace(
      /(&quot;(?:\\.|[^"\\])*&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (match, stringToken, colon, keyword) => {
        if (stringToken) {
          return colon
            ? `<span class="jsonTokenKey">${stringToken}</span>${colon}`
            : `<span class="jsonTokenString">${stringToken}</span>`;
        }
        if (keyword) {
          return `<span class="jsonTokenLiteral">${match}</span>`;
        }
        return `<span class="jsonTokenNumber">${match}</span>`;
      }
    );
  }

  function buildJsonCodeBlock(text) {
    const { lineNumbers, highlight } = getJsonViewerOptions();
    const pre = document.createElement("pre");
    pre.className = "jsonCodeView";
    pre.classList.toggle("jsonCodeViewLineNumbers", lineNumbers);
    pre.classList.toggle("jsonCodeViewHighlighted", highlight);
    const lines = String(text || "").split(/\r?\n/);
    if (!lineNumbers && !highlight) {
      const code = document.createElement("code");
      code.textContent = text;
      pre.appendChild(code);
      return pre;
    }
    const table = document.createElement("code");
    table.className = "jsonCodeLines";
    lines.forEach((line, index) => {
      const row = document.createElement("span");
      row.className = "jsonCodeLine";
      if (lineNumbers) {
        const gutter = document.createElement("span");
        gutter.className = "jsonCodeLineNumber";
        gutter.textContent = String(index + 1);
        row.appendChild(gutter);
      }
      const content = document.createElement("span");
      content.className = "jsonCodeLineContent";
      if (highlight) {
        content.innerHTML = highlightJsonLine(line);
      } else {
        content.textContent = line;
      }
      row.appendChild(content);
      table.appendChild(row);
    });
    pre.appendChild(table);
    return pre;
  }

  /** Wires a copy-to-clipboard button: click copies `getText()`'s current value, briefly swaps
   * the icon to a checkmark as feedback, then reverts. */
  function wireCopyButton(btn, getText) {
    let revertTimer = null;
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(getText());
      } catch (_error) {
        showToast(t("threebox.chat.copyFailed", "复制失败，请手动选择文本复制。"), "warning");
        return;
      }
      btn.innerHTML = CHECK_ICON;
      btn.classList.add("copied");
      clearTimeout(revertTimer);
      revertTimer = setTimeout(() => {
        btn.innerHTML = COPY_ICON;
        btn.classList.remove("copied");
      }, 1400);
    });
  }

  /** Builds a `<summary>` containing a label span + a copy button — the button must be a
   * descendant of `<summary>` itself (not a sibling) for native `<details>` toggle behavior to
   * keep working; wireCopyButton's preventDefault/stopPropagation on the button keeps clicking it
   * from also toggling the details open/closed. */
  function buildCollapseSummary(labelText, copyTitle, getText) {
    const summary = document.createElement("summary");
    const label = document.createElement("span");
    label.className = "jsonCollapseSummaryText";
    label.textContent = labelText;
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "jsonCollapseCopyBtn";
    copyBtn.title = copyTitle;
    copyBtn.innerHTML = COPY_ICON;
    wireCopyButton(copyBtn, getText);
    summary.appendChild(label);
    summary.appendChild(copyBtn);
    return summary;
  }

  /** Defers the expensive per-line syntax-highlight DOM until the user actually opens a JSON
   * disclosure. Generated scenes can contain thousands of lines; eagerly building several DOM
   * nodes per line while the <details> is still collapsed used to block insertion of the scene
   * canvas even though none of that code was visible. */
  function attachLazyJsonCodeBlock(details, text) {
    let codeBlock = null;
    details.addEventListener("toggle", () => {
      if (!details.open || codeBlock) {
        return;
      }
      codeBlock = buildJsonCodeBlock(text);
      details.appendChild(codeBlock);
    });
  }

  /** Collapsed-by-default <details> block holding the final generated JSON (kept out of the
   * markdown-rendered recap text since it can be very long), with a copy button in its header. */
  function buildJsonCollapse(jsonString, options = {}) {
    const details = document.createElement("details");
    details.className = options.failed === true ? "jsonCollapse failedJsonCollapse" : "jsonCollapse";
    details.appendChild(
      buildCollapseSummary(
        options.failed === true
          ? t("threebox.chat.viewFailedJson", "查看失败时的 JSON")
          : t("threebox.chat.viewGeneratedJson", "查看生成的 JSON"),
        t("threebox.chat.copyJson", "复制 JSON"),
        () => jsonString
      )
    );
    attachLazyJsonCodeBlock(details, jsonString);
    return details;
  }

  /** Collapsed-by-default <details> block showing the AI's raw adjustment output — operation
   * commands or an RFC-6902-style JSON Patch — placed above the final-JSON collapse so the user
   * can see what the model actually changed, not just the merged result.
   * @param {"commands"|"patch"} kind
   */
  function buildDiffCollapse(kind, text) {
    const details = document.createElement("details");
    details.className = "jsonCollapse diffCollapse";
    const label =
      kind === "patch"
        ? t("threebox.chat.viewAdjustPatch", "查看调整的 JSON Patch")
        : t("threebox.chat.viewAdjustCommands", "查看调整命令");
    const copyTitle =
      kind === "patch" ? t("threebox.chat.copyAdjustPatch", "复制 JSON Patch") : t("threebox.chat.copyAdjustCommands", "复制调整命令");
    details.appendChild(buildCollapseSummary(label, copyTitle, () => text));
    attachLazyJsonCodeBlock(details, text);
    return details;
  }

  /** Markdown-rendered summary text block, appended below the scene card (per the "场景生成后输出
   * 简短总结" setting) rather than as the message's primary text — keeps the summary visually
   * scoped to "what this turn's result is" instead of reading as the whole reply. */
  function buildSummaryBlock(text) {
    const el = document.createElement("div");
    el.className = "sceneSummaryText markdown-body";
    el.innerHTML = renderMarkdownToSafeHtml(text);
    return el;
  }

  function clear() {
    messages = [];
    removeTurnSpacer();
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
      try {
        await host.onUserMessage(text, {
          appendAssistantMessage: (t) => appendMessage("assistant", t),
          updateAssistantMessage,
          appendToBody,
          createStreamingBlock,
          buildJsonCollapse,
          buildDiffCollapse,
          buildSummaryBlock,
          finishTurnScroll
        });
      } catch (error) {
        // Top-level safety net: onUserMessage is expected to handle its own errors, but an
        // uncaught rejection here must still surface something in the chat rather than leaving
        // the UI looking like Send did nothing at all.
        console.error("[threebox] onUserMessage failed:", error);
        appendMessage(
          "assistant",
          t("threebox.app.processingFailed", "处理失败：{error}", { error: error?.message || error })
        );
        finishTurnScroll();
      }
      return;
    }

    // No generation wiring yet (next milestone) — a canned reply exercises the markdown /
    // code-block rendering pipeline end to end so it can be verified now.
    const demoReply = [
      t("threebox.chat.demoReply", "这是一个演示回复，用于验证 Markdown 渲染管线（真正的 AI 对话生成将在下一个里程碑接入）。"),
      "",
      "```json",
      JSON.stringify({ threeJsonId: "demo", note: t("threebox.chat.demoJsonNote", "占位 JSON 代码块") }, null, 2),
      "```"
    ].join("\n");
    appendMessage("assistant", demoReply);
  }

  function init() {
    composerSendBtn?.addEventListener("click", () => {
      if (busy) {
        host.onStopRequested?.();
        return;
      }
      void sendMessage(composerInput?.value);
    });
    composerInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (busy) {
          return;
        }
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
    setBusy,
    appendMessage,
    updateAssistantMessage,
    appendToBody,
    createStreamingBlock,
    buildJsonCollapse,
    buildDiffCollapse,
    buildSummaryBlock,
    finishTurnScroll,
    clear,
    showHeroView,
    showMessagesView
  };
}
