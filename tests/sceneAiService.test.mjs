import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  extractJsonText,
  generateSceneJsonString,
  parseSceneJsonString,
  requestSceneRefinementStep,
  requestUpdatedSceneJsonString,
  requestChatCompletion
} from "../core/ai/sceneAiService.js";
import { sanitizeAiJsonText, isLikelyTruncatedJsonText } from "../core/ai/sceneJsonSanitize.js";
import { validateSceneJson } from "../core/ai/agentTools.js";
import {
  extractPatchOperations,
  applySceneJsonPatch
} from "../core/ai/scenePatch.js";
import { listTextureUrlPointers } from "../core/ai/textureAiService.js";
import { classifyTurnIntent } from "../core/ai/sceneChatSession.js";

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
  const standardPointers = listTextureUrlPointers({
    objectList: [{ material: { textureUrl: "/standard.png" } }]
  });
  assert.equal(standardPointers[0], "/objectList/0/material/textureUrl");
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

test("parseSceneJsonString removes unused empty scene collection arrays", () => {
  const parsed = parseSceneJsonString(JSON.stringify({
    threeJsonId: "compact-lists",
    worldInfo: {
      boxModelList: [],
      lineList: [],
      sphereModelList: [{ name: "ball", geometry: { radius: 1 } }]
    },
    objectList: [],
    sceneConfig: { lights: [] }
  }));
  assert.equal("boxModelList" in parsed.worldInfo, false);
  assert.equal("lineList" in parsed.worldInfo, false);
  assert.equal("objectList" in parsed, false);
  assert.equal(parsed.worldInfo.sphereModelList.length, 1);
  assert.deepEqual(parsed.sceneConfig.lights, []);
});

test("requestChatCompletion reports a friendly error for non-header-compatible API keys", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  };

  await assert.rejects(
    requestChatCompletion({
      provider: "deepseek",
      apiKey: "这里不是-api-key",
      messages: [{ role: "user", content: "x" }]
    }),
    (error) => {
      assert.equal(error.code, "INVALID_API_KEY_HEADER_VALUE");
      assert.match(error.message, /API key/i);
      return true;
    }
  );
  assert.equal(fetchCalled, false);
});

test("requestChatCompletion trims a header-compatible API key without restricting its format", async () => {
  let authorization = "";
  globalThis.fetch = async (_url, init) => {
    authorization = init.headers.Authorization;
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: "ok" } }] };
      }
    };
  };

  await requestChatCompletion({
    provider: "deepseek",
    apiKey: "  custom.key_123  ",
    messages: [{ role: "user", content: "x" }]
  });
  assert.equal(authorization, "Bearer custom.key_123");
});

test("generateSceneJsonString injects capability reference material when enabled", async () => {
  const requestBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith("/assets/json/demo-show/manifest.json")) {
      return {
        ok: true,
        async text() {
          return JSON.stringify([
            {
              section: "event-mechanism",
              sectionTitleEn: "Event Mechanism",
              docLinks: [{ file: "event-mechanism.md" }],
              items: [
                {
                  id: "declarative-action",
                  json: "assets/json/demo-show/event-mechanism/declarative-action.json"
                }
              ]
            }
          ]);
        }
      };
    }
    if (href.endsWith("/docs/en/event-mechanism.md")) {
      return {
        ok: true,
        async text() {
          return "Use object events with actions.";
        }
      };
    }
    if (href.endsWith("/assets/json/demo-show/event-mechanism/declarative-action.json")) {
      return {
        ok: true,
        async text() {
          return '{"events":{"click":{"actions":[{"type":"setVisible","target":"door"}]}}}';
        }
      };
    }
    if (href === "https://api.openai.com/v1/chat/completions") {
      requestBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    threeJsonId: "event-scene",
                    worldInfo: {
                      boxModelList: [
                        {
                          name: "door",
                          objType: "box",
                          geometry: { width: 1, height: 2, depth: 0.2 },
                          position: { x: 0, y: 1, z: 0 },
                          material: { color: "#885533" }
                        }
                      ]
                    }
                  })
                }
              }
            ]
          };
        }
      };
    }
    return { ok: false, async text() { return ""; } };
  };

  const out = await generateSceneJsonString("add a click event to the door", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false,
    resolveReferenceUrl: (path) => `https://example.test/${path}`,
    locale: "en-US"
  });

  assert.ok(out.includes("event-scene"));
  assert.equal(requestBodies.length, 1);
  const userContent = requestBodies[0].messages.at(-1).content;
  assert.ok(userContent.includes("Reference material retrieved"));
  assert.ok(userContent.includes("Use object events with actions."));
});

test("generateSceneJsonString skips capability reference material when disabled", async () => {
  const requestBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://api.openai.com/v1/chat/completions") {
      requestBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: '{"threeJsonId":"plain-scene","worldInfo":{"boxModelList":[{"name":"box","objType":"box","geometry":{"width":1,"height":1,"depth":1},"position":{"x":0,"y":0.5,"z":0},"material":{"color":"#fff"}}]}}'
                }
              }
            ]
          };
        }
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  await generateSceneJsonString("add a click event to the door", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false,
    capabilityLookup: false,
    resolveReferenceUrl: (path) => `https://example.test/${path}`,
    locale: "en-US"
  });

  assert.equal(requestBodies.length, 1);
  const userContent = requestBodies[0].messages.at(-1).content;
  assert.equal(userContent.includes("Reference material retrieved"), false);
});

test("generateSceneJsonString disables proactive online texture prompt when requested", async () => {
  const requestBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://api.openai.com/v1/chat/completions") {
      requestBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: '{"threeJsonId":"texture-off","worldInfo":{"boxModelList":[{"name":"floor","objType":"floor","geometry":{"width":4,"height":0.1,"depth":4},"position":{"x":0,"y":0,"z":0},"material":{"color":"#777777"}}]}}'
                }
              }
            ]
          };
        }
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  await generateSceneJsonString("make a room with a wood floor", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false,
    onlineTextureHints: false
  });

  assert.equal(requestBodies.length, 1);
  const systemContent = requestBodies[0].messages[0].content;
  assert.match(systemContent, /host disabled proactive online texture hints/);
  assert.doesNotMatch(systemContent, /self-evidently incomplete as a flat color/);
});

test("generateSceneJsonString authors standard JSON and projects friendly output only at return", async () => {
  const requestBodies = [];
  const standardScene = JSON.stringify({
    threeJsonId: "format-scene",
    sceneConfig: { scene: { background: "#111111" } },
    objectList: [
      {
        threeJsonId: "box-1",
        objType: "box",
        geometry: { width: 1, height: 1, depth: 1 },
        material: { color: "#ffffff" }
      }
    ]
  });
  globalThis.fetch = async (_url, init = {}) => {
    requestBodies.push(JSON.parse(init.body));
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: `${standardScene}\n<<<THREEJSON_COMPLETE>>>` } }] };
      }
    };
  };

  const standardOutput = JSON.parse(await generateSceneJsonString("a box", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false
  }));
  const friendlyOutput = JSON.parse(await generateSceneJsonString("a box", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false,
    outputFormat: "friendly"
  }));

  assert.equal(standardOutput.worldInfo, undefined);
  assert.equal(standardOutput.objectList[0].objType, "box");
  assert.equal(friendlyOutput.objectList, undefined);
  assert.equal(friendlyOutput.worldInfo.meshList[0].objType, "box");
  for (const body of requestBodies) {
    assert.match(body.messages[0].content, /standard scheme-B JSON only/);
    assert.doesNotMatch(body.messages[0].content, /"worldInfo"\s*:/);
  }
});

test("generateSceneJsonString completes a one-segment response and strips its control marker", async () => {
  const scene = '{"threeJsonId":"one-segment","sceneConfig":{"scene":{"background":"#111111"}}}';
  let requestCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    requestCount += 1;
    const body = JSON.parse(init.body);
    assert.match(body.messages[0].content, /THREEJSON_COMPLETE/);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: `${scene}\n<<<THREEJSON_COMPLETE>>>` } }]
        };
      }
    };
  };

  const deltas = [];
  const output = await generateSceneJsonString("a small empty scene", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false,
    onDelta: (delta) => deltas.push(delta)
  });

  assert.equal(requestCount, 1);
  assert.equal(JSON.parse(output).threeJsonId, "one-segment");
  assert.equal(deltas.join(""), scene);
  assert.doesNotMatch(output, /THREEJSON_COMPLETE/);
});

test("generateSceneJsonString hides split transport markers from streamed JSON deltas", async () => {
  const scene = '{"threeJsonId":"streamed-segment","sceneConfig":{"scene":{"background":"#111111"}}}';
  const streamedPieces = [scene, "\n<<<THREEJSON_", "COMPLETE>>>"];
  let pieceIndex = 0;
  globalThis.fetch = async () => ({
    ok: true,
    body: new ReadableStream({
      pull(controller) {
        if (pieceIndex < streamedPieces.length) {
          const content = streamedPieces[pieceIndex++];
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
          );
        } else {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        }
      }
    })
  });

  const deltas = [];
  const output = await generateSceneJsonString("a streamed scene", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false,
    stream: true,
    onDelta: (delta) => deltas.push(delta)
  });

  assert.equal(JSON.parse(output).threeJsonId, "streamed-segment");
  assert.equal(deltas.join(""), scene);
  assert.equal(deltas.some((delta) => delta.includes("THREEJSON")), false);
});

test("generateSceneJsonString joins explicit continuation segments without repeating JSON", async () => {
  const first = '{"threeJsonId":"two-segment","objectList":[';
  const second = '{"threeJsonId":"box-1","objType":"box","geometry":{"width":1,"height":1,"depth":1}}]}';
  const requestBodies = [];
  const replies = [
    `${first}\n<<<THREEJSON_CONTINUE>>>`,
    `${second}\n<<<THREEJSON_COMPLETE>>>`
  ];
  globalThis.fetch = async (_url, init = {}) => {
    requestBodies.push(JSON.parse(init.body));
    const content = replies.shift();
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  };

  const progress = [];
  const output = await generateSceneJsonString("a complex scene", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false,
    estimatedSegments: 2,
    onSegmentProgress: (detail) => progress.push(detail.status)
  });

  assert.equal(requestBodies.length, 2);
  assert.equal(JSON.parse(output).threeJsonId, "two-segment");
  assert.equal(requestBodies[1].messages.at(-2).role, "assistant");
  assert.match(requestBodies[1].messages.at(-1).content, /exact next character/);
  assert.deepEqual(progress, ["request", "continue", "request", "complete"]);
});

test("generateSceneJsonString continues when the provider truncates before emitting a marker", async () => {
  const replies = [
    '{"threeJsonId":"implicit-continuation","sceneConfig":{"scene":',
    '{"background":"#111111"}}}\n<<<THREEJSON_COMPLETE>>>'
  ];
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    const content = replies.shift();
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  };

  const output = await generateSceneJsonString("continue after truncation", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false
  });

  assert.equal(requestCount, 2);
  assert.equal(JSON.parse(output).threeJsonId, "implicit-continuation");
});

test("generateSceneJsonString continues beyond eight responses with the new default", async () => {
  const replies = [
    '{\n<<<THREEJSON_CONTINUE>>>',
    ...Array.from({ length: 8 }, () => ' \n<<<THREEJSON_CONTINUE>>>'),
    '"threeJsonId":"beyond-eight","sceneConfig":{"scene":{"background":"#111111"}}}\n<<<THREEJSON_COMPLETE>>>'
  ];
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    const content = replies.shift();
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  };

  const output = await generateSceneJsonString("a scene requiring many segments", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false
  });

  assert.equal(requestCount, 10);
  assert.equal(JSON.parse(output).threeJsonId, "beyond-eight");
});

test("generateSceneJsonString honors the caller maxSceneSegments option", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: '{\n<<<THREEJSON_CONTINUE>>>' } }]
        };
      }
    };
  };

  await assert.rejects(
    generateSceneJsonString("an unfinished scene", {
      provider: "chatgpt",
      apiKey: "test-key",
      capabilityReview: false,
      maxSceneSegments: 2
    }),
    /after 2 response segments/
  );
  assert.equal(requestCount, 2);
});

test("classifyTurnIntent returns a bounded scene segment estimate", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: '{"intent":"generate","targetTurnId":null,"note":"large city","estimatedSegments":99}'
            }
          }
        ]
      };
    }
  });

  const result = await classifyTurnIntent(
    {
      userPrompt: "generate a very large city",
      history: [{ turnId: "turn-1", summary: "a prior room" }]
    },
    { provider: "chatgpt", apiKey: "test-key" }
  );

  assert.equal(result.intent, "generate");
  assert.equal(result.estimatedSegments, 16);
});

test("requestSceneRefinementStep recognizes done, JSON Patch, and commands", async () => {
  const scene = JSON.stringify({
    threeJsonId: "refinement-scene",
    worldInfo: {
      boxModelList: [
        {
          threeJsonId: "floor",
          name: "floor",
          objType: "box",
          geometry: { width: 4, height: 0.1, depth: 4 },
          position: { x: 0, y: 0, z: 0 },
          material: { color: "#777777" }
        }
      ]
    }
  });
  const replies = [
    "# done",
    '[{"op":"replace","path":"/worldInfo/boxModelList/0/material/color","value":"#123456"}]',
    scene.replace("#777777", "#abcdef"),
    'object.patch id=floor partial={"position":{"x":2}}'
  ];
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { choices: [{ message: { content: replies.shift() } }] };
    }
  });

  const done = await requestSceneRefinementStep("improve it", scene, {
    provider: "chatgpt",
    apiKey: "test-key"
  });
  const patchResult = await requestSceneRefinementStep("improve it", scene, {
    provider: "chatgpt",
    apiKey: "test-key"
  });
  const fullJsonResult = await requestSceneRefinementStep("improve it", scene, {
    provider: "chatgpt",
    apiKey: "test-key"
  });
  const commandResult = await requestSceneRefinementStep("improve it", scene, {
    provider: "chatgpt",
    apiKey: "test-key"
  });

  assert.equal(done.outputMode, "done");
  assert.equal(patchResult.outputMode, "patch");
  assert.equal(JSON.parse(patchResult.sceneJsonString).objectList[0].material.color, "#123456");
  assert.equal(fullJsonResult.outputMode, "json");
  assert.equal(JSON.parse(fullJsonResult.sceneJsonString).objectList[0].material.color, "#abcdef");
  assert.equal(commandResult.outputMode, "commands");
  assert.equal(commandResult.commands[0].op, "object.patch");
});

test("requestUpdatedSceneJsonString does not carry proactive online texture prompt", async () => {
  const requestBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://api.openai.com/v1/chat/completions") {
      requestBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: '{"threeJsonId":"update-no-texture-hint","worldInfo":{"boxModelList":[{"name":"floor","objType":"floor","geometry":{"width":4,"height":0.1,"depth":4},"position":{"x":0,"y":0,"z":0},"material":{"color":"#777777"}}]}}'
                }
              }
            ]
          };
        }
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  await requestUpdatedSceneJsonString(
    "make the floor wider",
    '{"threeJsonId":"base","worldInfo":{"boxModelList":[{"name":"floor","objType":"floor","geometry":{"width":2,"height":0.1,"depth":2},"position":{"x":0,"y":0,"z":0},"material":{"color":"#777777"}}]}}',
    {
      provider: "chatgpt",
      apiKey: "test-key",
      onlineTextureHints: true
    }
  );

  assert.equal(requestBodies.length, 1);
  const systemContent = requestBodies[0].messages[0].content;
  assert.doesNotMatch(systemContent, /Online texture rule/);
  assert.doesNotMatch(systemContent, /self-evidently incomplete as a flat color/);
});
