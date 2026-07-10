import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders assistant chat text (which may embed AI-authored content, including untrusted prompt
 * injections) to sanitized HTML. Never insert unsanitized markdown output into the DOM — this is
 * the one function that should do it.
 * @param {string} text
 * @returns {string} sanitized HTML
 */
export function renderMarkdownToSafeHtml(text) {
  const raw = marked.parse(String(text ?? ""));
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "rel"] });
}
