import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  extractJsonText,
  parseSceneJsonString,
  requestChatCompletion
} from "../core/ai/sceneAiService.js";
import { sanitizeAiJsonText, isLikelyTruncatedJsonText } from "../core/ai/sceneJsonSanitize.js";
import { validateSceneJson } from "../core/ai/agentTools.js";
import {
  extractPatchOperations,
  applySceneJsonPatch
} from "../core/ai/scenePatch.js";
import { listTextureUrlPointers } from "../core/ai/textureAiService.js";

test("sanitizeAiJsonText folds Math.PI division expressions", () => {
  const raw =
    '{"worldInfo":{"boxModelList":[{"rotation":{"rotationZ": Math.PI / 2}}]}}';
  const sanitized = sanitizeAiJsonText(raw);
  const parsed = JSON.parse(sanitized);
  assert.ok(Math.abs(parsed.worldInfo.boxModelList[0].rotation.rotationZ - Math.PI / 2) < 1e-10);
});

test("sanitizeAiJsonText folds Math.PI inside arrays", () => {
  const raw = '{"worldInfo":{"lineList":[{"points":[0, Math.PI / 2, 1]}]}}';
  const sanitized = sanitizeAiJsonText(raw);
  const parsed = JSON.parse(sanitized);
  assert.ok(Math.abs(parsed.worldInfo.lineList[0].points[1] - Math.PI / 2) < 1e-10);
});

test("sanitizeAiJsonText does not replace Math.PI inside JSON strings", () => {
  const raw = '{"note":"use Math.PI for radians","rotationZ": Math.PI / 2}';
  const sanitized = sanitizeAiJsonText(raw);
  const parsed = JSON.parse(sanitized);
  assert.equal(parsed.note, "use Math.PI for radians");
  assert.ok(Math.abs(parsed.rotationZ - Math.PI / 2) < 1e-10);
});

test("extractPatchOperations sanitizes Math.PI in patch values", () => {
  const raw = `[{"op":"replace","path":"/worldInfo/boxModelList/0/rotation/rotationZ","value": Math.PI / 2}]`;
  const ops = extractPatchOperations(raw);
  assert.equal(ops.length, 1);
  assert.ok(Math.abs(ops[0].value - Math.PI / 2) < 1e-10);
});

test("isLikelyTruncatedJsonText detects incomplete bracket balance", () => {
  const complete = JSON.stringify({
    threeJsonId: "trunc-test",
    worldInfo: { boxModelList: [] }
  });
  const truncated = complete.slice(0, -2);
  assert.equal(isLikelyTruncatedJsonText(truncated), true);
  assert.throws(() => parseSceneJsonString(truncated), /truncated/i);
});

test("parseSceneJsonString accepts LLM output with Math.PI", () => {
  const raw = JSON.stringify({
    worldInfo: {
      boxModelList: [
        {
          objType: "box",
          geometry: { width: 1, height: 1, depth: 1 },
          position: { x: 0, y: 0, z: 0 },
          rotation: { rotationX: 0, rotationY: 0, rotationZ: "PLACEHOLDER" },
          material: { color: "#ffffff" }
        }
      ]
    }
  }).replace('"PLACEHOLDER"', "Math.PI / 4");
  const parsed = parseSceneJsonString(raw);
  assert.ok(
    Math.abs(parsed.worldInfo.boxModelList[0].rotation.rotationZ - Math.PI / 4) < 1e-10
  );
});

test("extractJsonText pulls object from fenced block", () => {
  const raw = 'Here:\n```json\n{"worldInfo":{"boxModelList":[]}}\n```';
  const text = extractJsonText(raw);
  assert.ok(text.includes("worldInfo"));
});

test("validateSceneJson accepts lineList-only friendly scene", () => {
  const scene = {
    threeJsonId: "ai-test-scene",
    worldInfo: {
      boxModelList: [],
      lineList: [
        {
          name: "path",
          objType: "line",
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 1 }
          ],
          material: { type: "standard", color: "#ffffff" }
        }
      ]
    }
  };
  const r = validateSceneJson(JSON.stringify(scene));
  assert.equal(r.ok, true);
  assert.ok((r.friendlyCount || 0) >= 1);
});

test("validateSceneJson rejects empty deployable scene", () => {
  const scene = { threeJsonId: "ai-patch-test", worldInfo: { boxModelList: [] } };
  const r = validateSceneJson(JSON.stringify(scene));
  assert.equal(r.ok, false);
});

test("validateSceneJson accepts standard scheme B without worldInfo", () => {
  const scene = {
    threeJsonId: "ai-standard-b",
    sceneConfig: {
      camera: { fov: 60, position: { x: 0, y: 2, z: 5 } },
      lights: [{ type: "ambient", intensity: 0.5 }]
    },
    objectList: [
      {
        objType: "box",
        name: "floor",
        geometry: { width: 10, height: 1, depth: 10 },
        position: { x: 0, y: 0, z: 0 },
        material: { color: "#888888" }
      }
    ]
  };
  const r = validateSceneJson(JSON.stringify(scene));
  assert.equal(r.ok, true);
  assert.equal(r.objectCount, 1);
});

test("applySceneJsonPatch replaces material color", () => {
  const scene = parseSceneJsonString(
    JSON.stringify({
      threeJsonId: "ai-test-scene",
      worldInfo: {
        boxModelList: [
          {
            name: "b",
            objType: "box",
            geometry: { width: 1, height: 1, depth: 1 },
            position: { x: 0, y: 0, z: 0 },
            material: { type: "standard", color: "#111111" }
          }
        ]
      }
    })
  );
  const patch = [
    {
      op: "replace",
      path: "/worldInfo/boxModelList/0/material/color",
      value: "#ff0000"
    }
  ];
  const applied = applySceneJsonPatch(scene, patch);
  assert.equal(applied.ok, true);
  assert.equal(applied.scene.worldInfo.boxModelList[0].material.color, "#ff0000");
});

test("applySceneJsonPatch normalizes dot paths and appends with -", () => {
  const scene = {
    threeJsonId: "ai-test-scene",
    worldInfo: { boxModelList: [], sphereModelList: [] }
  };
  const patch = [
    {
      op: "add",
      path: "/worldInfo.sphereModelList/-",
      value: {
        name: "ball",
        objType: "sphere",
        geometry: { radius: 0.5 },
        position: { x: 0, y: 1, z: 0 },
        material: { type: "standard", color: "#00aaff" }
      }
    }
  ];
  const applied = applySceneJsonPatch(scene, patch);
  assert.equal(applied.ok, true);
  assert.equal(applied.scene.worldInfo.sphereModelList.length, 1);
  assert.equal(applied.scene.worldInfo.sphereModelList[0].name, "ball");
});

test("applySceneJsonPatch appends to array with slash - index", () => {
  const scene = {
    threeJsonId: "ai-test-scene",
    worldInfo: { sphereModelList: [] }
  };
  const applied = applySceneJsonPatch(scene, [
    { op: "add", path: "/worldInfo/sphereModelList/-", value: { name: "b2" } }
  ]);
  assert.equal(applied.ok, true);
  assert.equal(applied.scene.worldInfo.sphereModelList.length, 1);
  assert.equal(applied.scene.worldInfo.sphereModelList[0].name, "b2");
});

test("extractPatchOperations accepts wrapper object", () => {
  const ops = extractPatchOperations('{"patch":[{"op":"remove","path":"/worldInfo/boxModelList/0"}]}');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "remove");
});

test("listTextureUrlPointers finds material.textureUrl", () => {
  const ptrs = listTextureUrlPointers({
    worldInfo: {
      boxModelList: [{ material: { textureUrl: "/tex.png" } }]
    }
  });
  assert.ok(ptrs.length >= 1);
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("requestChatCompletion stream aggregates SSE deltas", async () => {
  const sseLines = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
    "data: [DONE]\n\n"
  ];
  let i = 0;
  globalThis.fetch = async () => ({
    ok: true,
    body: new ReadableStream({
      pull(controller) {
        if (i < sseLines.length) {
          controller.enqueue(new TextEncoder().encode(sseLines[i++]));
        } else {
          controller.close();
        }
      }
    })
  });

  const deltas = [];
  const content = await requestChatCompletion({
    provider: "deepseek",
    apiKey: "test-key",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    onDelta: (d) => deltas.push(d)
  });
  assert.equal(content, "Hello world");
  assert.deepEqual(deltas, ["Hello", " world"]);
});

test("requestChatCompletion respects AbortSignal", async () => {
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });

  const ac = new AbortController();
  const pending = requestChatCompletion({
    provider: "deepseek",
    apiKey: "test-key",
    messages: [{ role: "user", content: "x" }],
    signal: ac.signal
  });
  ac.abort();
  await assert.rejects(pending, (err) => err.name === "AbortError");
});
