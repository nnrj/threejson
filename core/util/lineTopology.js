/**
 * line / lineSegments / lineLoop topology field resolution (no Three dependency; usable from unit tests).
 * @param {object} [record]
 * @returns {"line"|"lineSegments"|"lineLoop"}
 */
export function normalizeLineTopology(record) {
  const raw = record?.topology ?? record?.lineTopology ?? "";
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "linesegments" || s === "line_segments" || s === "segments") {
    return "lineSegments";
  }
  if (s === "lineloop" || s === "line_loop" || s === "loop") {
    return "lineLoop";
  }
  return "line";
}
