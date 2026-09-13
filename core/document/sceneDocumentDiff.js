import { escapePointer } from "./sceneDocument.js";

// Reuse immutable equal subtrees and keep small mesh edits small in undo history.
export function diffData(before, after, path, output) {
  if (before === after) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length === after.length && after.some((value) => value && typeof value === "object")) {
      for (let i = 0; i < before.length; i++) diffData(before[i], after[i], `${path}/${i}`, output);
    } else {
      let start = 0, endBefore = before.length, endAfter = after.length;
      const equal = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
      while (start < endBefore && start < endAfter && equal(before[start], after[start])) start++;
      while (endBefore > start && endAfter > start && equal(before[endBefore - 1], after[endAfter - 1])) { endBefore--; endAfter--; }
      if (start !== endBefore || start !== endAfter) output.push({ op: "array.splice", path, index: start, deleteCount: endBefore - start, values: after.slice(start, endAfter) });
    }
  } else if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const child = `${path}/${escapePointer(key)}`;
      if (!Object.hasOwn(after, key)) output.push({ op: "remove", path: child });
      else if (!Object.hasOwn(before, key)) output.push({ op: "add", path: child, value: after[key] });
      else diffData(before[key], after[key], child, output);
    }
  } else if (JSON.stringify(before) !== JSON.stringify(after)) output.push({ op: "replace", path, value: after });
}

export function diffSceneDocuments(before, after) {
  const operations = [];
  diffData(before.root, after.root, "", operations);
  return operations;
}
