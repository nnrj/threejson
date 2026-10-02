/** Screen typography is composited after 3D rendering: independent of camera,
 * lighting and geometry. SDF/mesh/particle titles remain regular scene objects.
 */
export function layoutCaptionLines(text, measure, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    // Graphemes preserve emoji/combining marks; word segments keep Latin words.
    const segments = typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(paragraph)].map(s => s.segment) : Array.from(paragraph);
    let line = "";
    for (const segment of segments) {
      if (line && measure(line + segment) > maxWidth) { lines.push(line.trimEnd()); line = ""; }
      if (measure(segment) > maxWidth) {
        const chars = typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(segment)].map(s => s.segment) : Array.from(segment);
        for (const char of chars) { if (line && measure(line + char) > maxWidth) { lines.push(line); line = ""; } line += char; }
      } else line += line ? segment : segment.trimStart();
    }
    lines.push(line);
  }
  return lines;
}

export function drawMediaCaptions(context, items, time, { width, height, duration, output } = {}) {
  for (const item of items || []) {
    const start = item.start || 0, length = item.duration ?? duration, local = time - start;
    if (item.enabled === false || local < 0 || local >= length) continue;
    const scale = height / (output?.height || 1080), size = item.fontSize ? item.fontSize * scale : height * .04;
    const fade = Math.max(0, Math.min(1, item.fadeIn ? local / item.fadeIn : 1, item.fadeOut ? (length - local) / item.fadeOut : 1));
    const safe = Math.max(0, Math.min(.45, item.safeArea ?? .06)), maxWidth = width * (1 - 2 * safe);
    context.save();
    context.globalAlpha *= (item.opacity ?? 1) * fade;
    context.font = `${item.fontWeight || "400"} ${size}px ${item.fontFamily || "sans-serif"}`;
    context.textAlign = "left"; context.textBaseline = "middle";
    context.fillStyle = item.color || "#ffffff"; context.strokeStyle = item.outlineColor || "#000000"; context.lineWidth = (item.outlineWidth ?? 3) * scale;
    const measure = value => context.measureText?.(value).width ?? Array.from(value).length * size * .6;
    let text = String(item.text || "");
    if (item.reveal === "typewriter") text = Array.from(text).slice(0, Math.floor(local * (item.charactersPerSecond || 14))).join("");
    const lines = layoutCaptionLines(text, measure, maxWidth), spacing = size * (item.lineHeight || 1.3);
    const totalHeight = lines.length * spacing, y = Math.max(safe * height + totalHeight / 2, Math.min(height * (1 - safe) - totalHeight / 2, (item.y ?? .9) * height));
    const slide = (item.slideY || 0) * height * (1 - fade);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], lineWidth = measure(line), anchor = (item.x ?? .5) * width;
      const x = Math.max(width * safe, Math.min(width * (1 - safe) - lineWidth, anchor - (item.align === "left" ? 0 : item.align === "right" ? lineWidth : lineWidth / 2)));
      const rowY = y + (i - (lines.length - 1) / 2) * spacing + slide;
      if (context.lineWidth) context.strokeText(line, x, rowY);
      context.fillText(line, x, rowY);
      for (const highlight of item.highlights || []) {
        if (!highlight.text || time < (highlight.start ?? start) || time >= (highlight.end ?? start + length)) continue;
        let offset = 0, at;
        while ((at = line.indexOf(highlight.text, offset)) >= 0) {
          context.fillStyle = highlight.color || "#ffd789"; context.fillText(highlight.text, x + measure(line.slice(0, at)), rowY);
          offset = at + highlight.text.length;
        }
        context.fillStyle = item.color || "#ffffff";
      }
    }
    context.restore();
  }
}

/** Convert desired image weights to source-over alpha, avoiding a dark midpoint
 * (two .5 opacity source-over layers otherwise contribute only .75).
 */
export function getCompositeAlphas(clips) {
  const weights = clips.map(c => c.opacity);
  let after = 0;
  const result = [...weights];
  for (let i = result.length - 1; i >= 0; i--) { result[i] = weights[i] ? Math.min(1, weights[i] / Math.max(Number.EPSILON, 1 - after)) : 0; after += weights[i]; }
  return result;
}
