/**
 * Collapsible, syntax-highlighted code view for an assistant turn's result, ported from the
 * original tools/scene-host/threebox/js/threeBoxChatPanel.js (buildJsonCollapse / buildDiffCollapse
 * / highlightJsonLine / the copy-button + line-number/highlight DOM). No @threejson/* package
 * exposes the chat panel, so the app carries this.
 *
 * Two variants share the same chrome:
 *   • "查看生成的 JSON" — the scene JSON produced by a generate/adjust turn (kept out of the
 *     markdown recap because it can be very long).
 *   • "查看调整命令" / "查看调整的 JSON Patch" — the raw operation commands or RFC-6902 patch an
 *     adjust turn applied, so the user sees what the model actually changed.
 *
 * Large scenes first mount as plain text, then upgrade to numbered/highlighted lines in idle-time
 * chunks. This keeps opening a long result from blocking the chat UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projectSceneJsonString } from "threejson/ai";
import { t } from "@threejson/host-kit/i18n/index.js";

const COPY_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M3.5 10.5v-6a1 1 0 0 1 1-1h6" />
  </svg>
);
const CHECK_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.5 8.5 6.5 11.5 12.5 4.5"
    />
  </svg>
);

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Port of the original highlightJsonLine: escape, then tag strings/keys/literals/numbers. */
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

function IncrementalJsonCodeView({ text, lineNumbers, highlight }) {
  const preRef = useRef(null);

  useEffect(() => {
    const pre = preRef.current;
    if (!pre) return undefined;
    let cancelled = false;
    let idleHandle = null;
    let timerHandle = null;
    const source = String(text ?? "");
    const plain = document.createElement("code");
    plain.className = "jsonCodeLines";
    plain.textContent = source;
    pre.replaceChildren(plain);
    if (!lineNumbers && !highlight) return undefined;

    const lines = source.split(/\r?\n/);
    const rich = document.createElement("code");
    rich.className = "jsonCodeLines";
    let index = 0;
    const schedule = (callback) => {
      if (typeof requestIdleCallback === "function") {
        idleHandle = requestIdleCallback(callback, { timeout: 80 });
      } else {
        timerHandle = window.setTimeout(() => callback({ timeRemaining: () => 8 }), 0);
      }
    };
    const renderChunk = (deadline) => {
      if (cancelled) return;
      const fragment = document.createDocumentFragment();
      const start = index;
      while (index < lines.length && (index - start < 180 || deadline.timeRemaining() > 2)) {
        const row = document.createElement("span");
        row.className = "jsonCodeLine";
        if (lineNumbers) {
          const number = document.createElement("span");
          number.className = "jsonCodeLineNumber";
          number.textContent = String(index + 1);
          row.appendChild(number);
        }
        const content = document.createElement("span");
        content.className = "jsonCodeLineContent";
        if (highlight) content.innerHTML = highlightJsonLine(lines[index]);
        else content.textContent = lines[index];
        row.appendChild(content);
        fragment.appendChild(row);
        index += 1;
      }
      rich.appendChild(fragment);
      if (index < lines.length) schedule(renderChunk);
      else if (!cancelled) pre.replaceChildren(rich);
    };
    schedule(renderChunk);
    return () => {
      cancelled = true;
      if (idleHandle != null && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle);
      if (timerHandle != null) clearTimeout(timerHandle);
    };
  }, [text, lineNumbers, highlight]);

  return (
    <pre
      ref={preRef}
      className={`jsonCodeView${lineNumbers ? " jsonCodeViewLineNumbers" : ""}${
        highlight ? " jsonCodeViewHighlighted" : ""
      }`}
    />
  );
}

/**
 * @param {object}  props
 * @param {string}  props.text     text to display and copy (pretty-printed JSON / commands)
 * @param {string}  props.label    summary label (e.g. "查看生成的 JSON")
 * @param {string}  props.copyTitle copy-button tooltip
 * @param {boolean} [props.diff]   render as the diff variant (adds the diffCollapse class)
 * @param {boolean} [props.lineNumbers] show the line-number gutter (io.jsonViewerLineNumbers)
 * @param {boolean} [props.highlight]   syntax-highlight the code (io.jsonViewerHighlight)
 */
export function JsonCollapse({ text, label, copyTitle, diff = false, failed = false, lineNumbers = true, highlight = true, showToast }) {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const revertTimer = useRef(null);

  const onToggle = useCallback((event) => {
    if (event.currentTarget.open) {
      setMounted(true);
    }
  }, []);

  const onCopy = useCallback(
    async (event) => {
      // The copy button lives inside <summary>; stop the click from also toggling the details.
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        showToast?.(t("threebox.chat.copyFailed", "复制失败，请手动选择文本复制。"), "warning");
        return;
      }
      setCopied(true);
      clearTimeout(revertTimer.current);
      revertTimer.current = setTimeout(() => setCopied(false), 1400);
    },
    [text, showToast]
  );

  return (
    <details className={`jsonCollapse${diff ? " diffCollapse" : ""}${failed ? " failedJsonCollapse" : ""}`} onToggle={onToggle}>
      <summary>
        <span className="jsonCollapseSummaryText">{label}</span>
        <button
          type="button"
          className={`jsonCollapseCopyBtn${copied ? " copied" : ""}`}
          title={copyTitle}
          onClick={onCopy}
        >
          {copied ? CHECK_ICON : COPY_ICON}
        </button>
      </summary>
      {mounted && <IncrementalJsonCodeView text={text} lineNumbers={lineNumbers} highlight={highlight} />}
    </details>
  );
}

/**
 * Collapsible view of a turn's final scene JSON ("查看生成的 JSON"). The displayed JSON is projected
 * per io.sceneJsonFormat ("standard" raw vs "friendly" human-readable) via core's
 * projectSceneJsonString, exactly like the original's projectSceneForUser.
 */
export function SceneJsonCollapse({ rawJsonString, format = "standard", lineNumbers = true, highlight = true, showToast }) {
  const text = useMemo(() => {
    try {
      return projectSceneJsonString(rawJsonString, format === "friendly" ? "friendly" : "standard");
    } catch {
      try {
        return JSON.stringify(JSON.parse(rawJsonString), null, 2);
      } catch {
        return String(rawJsonString ?? "");
      }
    }
  }, [rawJsonString, format]);

  return (
    <JsonCollapse
      text={text}
      label={t("threebox.chat.viewGeneratedJson", "查看生成的 JSON")}
      copyTitle={t("threebox.chat.copyJson", "复制 JSON")}
      lineNumbers={lineNumbers}
      highlight={highlight}
      showToast={showToast}
    />
  );
}

/**
 * Collapsible view of an adjust turn's raw output — operation commands or an RFC-6902 patch
 * ("查看调整命令" / "查看调整的 JSON Patch").
 * @param {"commands"|"patch"} kind
 */
export function AdjustDiffCollapse({ kind, text, lineNumbers = true, highlight = true, showToast }) {
  const isPatch = kind === "patch";
  return (
    <JsonCollapse
      diff
      text={text}
      lineNumbers={lineNumbers}
      highlight={highlight}
      showToast={showToast}
      label={
        isPatch
          ? t("threebox.chat.viewAdjustPatch", "查看调整的 JSON Patch")
          : t("threebox.chat.viewAdjustCommands", "查看调整命令")
      }
      copyTitle={
        isPatch
          ? t("threebox.chat.copyAdjustPatch", "复制 JSON Patch")
          : t("threebox.chat.copyAdjustCommands", "复制调整命令")
      }
    />
  );
}
