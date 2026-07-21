import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  extractJsonText,
  generateSceneJsonString,
  parseSceneJsonString,
  requestSceneRefinementStep,
  requestUpdatedSceneJsonString,
  requestChatCompletion,
  createThreeBoxTurnContext,
  buildThreeBoxRequestContext,
  applyThreeBoxModerationHeaders
} from "../core/ai/sceneAiService.js";
import {
  sanitizeAiJsonText,
  isLikelyTruncatedJsonText,
  stripMarkdownCodeFence
} from "../core/ai/sceneJsonSanitize.js";
import { validateSceneJson } from "../core/ai/agentTools.js";
import {
  extractPatchOperations,
  applySceneJsonPatch
} from "../core/ai/scenePatch.js";
import { listTextureUrlPointers } from "../core/ai/textureAiService.js";
import { classifyTurnIntent } from "../core/ai/sceneChatSession.js";

test("ThreeBox turn context sends the original prompt once, then uses the signed moderation receipt", () => {
  const context = createThreeBoxTurnContext("turn-1", "raw user prompt");
  assert.deepEqual(buildThreeBoxRequestContext(context), {
    protocol_version: 1,
    turn_id: "turn-1",
    original_prompt: { included: true, text: "raw user prompt" },
    moderation: { status: "pending" }
  });

  applyThreeBoxModerationHeaders(context, new Headers({
    "X-ThreeBox-Moderation-Status": "allowed",
    "X-ThreeBox-Moderation-Receipt": "tbm_receipt",
    "X-ThreeBox-Moderation-Prompt-Hash": "prompt-hash"
  }));
  assert.deepEqual(buildThreeBoxRequestContext(context), {
    protocol_version: 1,
    turn_id: "turn-1",
    original_prompt: { included: false },
    moderation: {
      status: "allowed",
      receipt: "tbm_receipt",
      prompt_hash: "prompt-hash"
    }
  });
});

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

test("AI JSON sanitization strips optional markdown fences", () => {
  const json = '{"worldInfo":{"boxModelList":[]}}';
  assert.equal(stripMarkdownCodeFence(json), json);
  assert.equal(stripMarkdownCodeFence("```json\n" + json + "\n```"), json);
  assert.equal(stripMarkdownCodeFence("``` json\n" + json + "\n```"), json);
  assert.equal(sanitizeAiJsonText("```\n" + json + "\n```"), json);
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("requestChatCompletion stream aggregates SSE deltas", async () => {
  const sseLines = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
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
  let completionMetadata = null;
  const content = await requestChatCompletion({
    provider: "deepseek",
    apiKey: "test-key",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    onDelta: (d) => deltas.push(d),
    onCompletionMetadata: (metadata) => {
      completionMetadata = metadata;
    }
  });
  assert.equal(content, "Hello world");
  assert.deepEqual(deltas, ["Hello", " world"]);
  assert.equal(completionMetadata?.finishReason, "length");
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

test("requestChatCompletion sends an anonymous user_id only to DeepSeek", async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: "ok" } }] };
      }
    };
  };

  await requestChatCompletion({
    provider: "deepseek",
    apiKey: "test-key",
    userId: "TB-ABC1234567",
    messages: [{ role: "user", content: "x" }]
  });
  await requestChatCompletion({
    provider: "custom",
    baseUrl: "https://compatible.example/v1",
    apiKey: "test-key",
    userId: "TB-ABC1234567",
    messages: [{ role: "user", content: "x" }]
  });

  assert.equal(bodies[0].user_id, "TB-ABC1234567");
  assert.equal("user_id" in bodies[1], false);
});

test("requestChatCompletion rejects an unsafe provider userId before fetch", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
  };
  await assert.rejects(
    requestChatCompletion({
      provider: "deepseek",
      apiKey: "test-key",
      userId: "private user@example.com",
      messages: [{ role: "user", content: "x" }]
    }),
    /userId must contain only/
  );
  assert.equal(fetchCalled, false);
});

test("requestChatCompletion preserves structured built-in moderation errors for host UI", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 422,
    headers: new Headers(),
    async text() {
      return JSON.stringify({
        error: "SAFETY_POLICY_WARNING",
        message: "Prompt blocked for violating the safety policy.",
        safety_enforcement: { action: "warning", warning_count: 3 }
      });
    }
  });

  await assert.rejects(
    requestChatCompletion({
      provider: "threebox-builtin",
      baseUrl: "https://builtin.example/v1",
      apiKey: "test-key",
      messages: [{ role: "user", content: "x" }],
      threeBoxTurnContext: createThreeBoxTurnContext("turn-error", "x")
    }),
    (error) => {
      assert.equal(error.code, "BUILTIN_SAFETY_WARNING");
      assert.equal(error.httpStatus, 422);
      assert.equal(error.providerError.safety_enforcement.warning_count, 3);
      return true;
    }
  );
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

test("generateSceneJsonString uses the single-response fast path for an ordinary scene", async () => {
  const scene = '{"threeJsonId":"one-segment","sceneConfig":{"scene":{"background":"#111111"}}}';
  let requestCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    requestCount += 1;
    const body = JSON.parse(init.body);
    assert.doesNotMatch(body.messages[0].content, /THREEJSON_COMPLETE/);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: scene } }]
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
  assert.equal(deltas.join(""), "");
  assert.doesNotMatch(output, /THREEJSON_COMPLETE/);
});

test("generateSceneJsonString exposes a validated draft before final post-processing", async () => {
  const scene = '{"threeJsonId":"draft-scene","objectList":[{"objType":"box"}]}'
  const drafts = [];
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { choices: [{ message: { content: scene } }] };
    }
  });

  const output = await generateSceneJsonString("a box", {
    provider: "chatgpt",
    apiKey: "test-key",
    capabilityReview: false,
    onSceneDraft: (draft) => drafts.push(draft)
  });

  assert.equal(drafts.length, 1);
  assert.equal(JSON.parse(drafts[0]).threeJsonId, "draft-scene");
  assert.equal(JSON.parse(output).threeJsonId, "draft-scene");
});

test("generateSceneJsonString does not silently turn a malformed ordinary response into 16 requests", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: '{"threeJsonId":"unfinished","objectList":[' } }] };
      }
    };
  };

  await assert.rejects(
    generateSceneJsonString("a simple box", {
      provider: "chatgpt",
      apiKey: "test-key",
      capabilityReview: false,
      estimatedSegments: 1
    })
  );
  assert.equal(requestCount, 1);
});

test("generateSceneJsonString regenerates a truncated one-shot forest once with compact constraints", async () => {
  const first = '{"threeJsonId":"forest","objectList":[';
  const second = '{"threeJsonId":"forest-compact","objectList":[{"threeJsonId":"robot-1","objType":"box"}]}';
  const requestBodies = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    requestBodies.push(body);
    const compactRetry = requestBodies.length > 1;
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: { content: compactRetry ? second : first },
            finish_reason: compactRetry ? "stop" : "length"
          }]
        };
      }
    };
  };

  const progress = [];
  const output = await generateSceneJsonString(
    "生成一片森林，森林里有许多小动物，天上飞的地上跑的，有个小木屋，小木屋旁边站着一个机器人。",
    {
      provider: "chatgpt",
      apiKey: "test-key",
      capabilityReview: false,
      estimatedSegments: 1,
      onGenerationPhase: (detail) => progress.push(detail.phase)
    }
  );

  assert.equal(requestBodies.length, 2);
  assert.doesNotMatch(requestBodies[0].messages[0].content, /SEGMENTED OUTPUT PROTOCOL/);
  assert.equal(requestBodies[1].messages.length, 2);
  assert.equal(requestBodies[1].messages.some((message) => message.role === "assistant"), false);
  assert.match(requestBodies[1].messages.at(-1).content, /Generate the complete scene again from the beginning/);
  assert.equal(JSON.parse(output).threeJsonId, "forest-compact");
  assert.deepEqual(progress, ["compact-retry", "processing"]);
});

test("a compact full-regeneration cutoff fails after two requests instead of blind continuation", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: requestCount === 1
                ? '{"threeJsonId":"forest","objectList":['
                : '{"threeJsonId":"forest-compact","objectList":['
            },
            finish_reason: "length"
          }]
        };
      }
    };
  };

  await assert.rejects(
    generateSceneJsonString("a forest with many animals", {
      provider: "chatgpt",
      apiKey: "test-key",
      capabilityReview: false,
      estimatedSegments: 1
    }),
    /after one compact full-regeneration attempt/
  );
  assert.equal(requestCount, 2);
});

test("generateSceneJsonString streams an ordinary scene directly without marker buffering", async () => {
  const scene = '{"threeJsonId":"streamed-segment","sceneConfig":{"scene":{"background":"#111111"}}}';
  const streamedPieces = [scene.slice(0, 30), scene.slice(30)];
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
    capabilityReview: false,
    estimatedSegments: 2
  });

  assert.equal(requestCount, 2);
  assert.equal(JSON.parse(output).threeJsonId, "implicit-continuation");
});

test("generateSceneJsonString can continue beyond eight responses when complexity opts in", async () => {
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
    capabilityReview: false,
    estimatedSegments: 10
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
      segmentedOutput: true,
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
              content: '{"intent":"generate","targetTurnId":null,"note":"large city","generationStrategy":"segmented","estimatedSegments":99}'
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
  assert.equal(result.generationStrategy, "segmented");
  assert.equal(result.estimatedSegments, 16);
});

test("classifyTurnIntent negotiates a compact strategy even when there are no prior turns", async () => {
  let requestBody;
  globalThis.fetch = async (_url, init = {}) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: '{"intent":"generate","targetTurnId":null,"note":"compact forest","generationStrategy":"compact","estimatedSegments":8}'
            }
          }]
        };
      }
    };
  };

  const result = await classifyTurnIntent(
    { userPrompt: "a forest with many animals", history: [] },
    { provider: "chatgpt", apiKey: "test-key" }
  );

  assert.deepEqual(JSON.parse(requestBody.messages[1].content).priorSceneTurns, []);
  assert.match(requestBody.messages[0].content, /If you are not confident that strict segmented output is supported, choose "compact"/);
  assert.equal(result.generationStrategy, "compact");
  assert.equal(result.estimatedSegments, 1);
});

test("classifyTurnIntent preserves an adjust decision when the model omits its target id", async () => {
  let requestBody;
  globalThis.fetch = async (_url, init = {}) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: '{"intent":"adjust","targetTurnId":null,"note":"continue latest","generationStrategy":"single","estimatedSegments":1}'
            }
          }]
        };
      }
    };
  };

  const result = await classifyTurnIntent(
    {
      userPrompt: "把机器人改成红色",
      history: [
        { turnId: "turn-forest", userPrompt: "生成森林和机器人", summary: "森林里有一个机器人", mode: "generate" },
        { turnId: "turn-cabin", userPrompt: "再加一个木屋", summary: "在森林里增加了木屋", mode: "adjust", targetTurnId: "turn-forest" }
      ]
    },
    { provider: "chatgpt", apiKey: "test-key" }
  );

  const negotiationInput = JSON.parse(requestBody.messages[1].content);
  assert.equal(requestBody.max_tokens, 800);
  assert.equal(negotiationInput.priorSceneTurns[1].isLatestScene, true);
  assert.equal(negotiationInput.priorSceneTurns[1].originalRequest, "再加一个木屋");
  assert.match(requestBody.messages[0].content, /Conversation continuity is the default/);
  assert.equal(result.intent, "adjust");
  assert.equal(result.targetTurnId, "turn-cabin");
  assert.equal(result.classificationFailed, false);
});

test("classifyTurnIntent marks provider or parse fallback instead of disguising it as generation", async () => {
  globalThis.fetch = async () => {
    throw new Error("negotiation unavailable");
  };

  const result = await classifyTurnIntent(
    {
      userPrompt: "再加一棵树",
      history: [{ turnId: "turn-forest", summary: "森林场景" }]
    },
    { provider: "chatgpt", apiKey: "test-key" }
  );

  assert.equal(result.classificationFailed, true);
  assert.match(result.note, /classification failed/);
});

test("classifyTurnIntent propagates structured moderation failures to the host UI", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    headers: new Headers(),
    async text() {
      return JSON.stringify({
        error: "DEVICE_PERMANENTLY_BANNED",
        message: "This device has been permanently banned for violating the safety policy.",
        safety_enforcement: { action: "banned", permanent: true }
      });
    }
  });

  await assert.rejects(
    classifyTurnIntent(
      { userPrompt: "try again", history: [{ turnId: "turn-base", summary: "scene" }] },
      { provider: "threebox-builtin", baseUrl: "https://builtin.example/v1", apiKey: "test-key" }
    ),
    (error) => {
      assert.equal(error.code, "BUILTIN_DEVICE_PERMANENTLY_BANNED");
      assert.equal(error.providerError.error, "DEVICE_PERMANENTLY_BANNED");
      return true;
    }
  );
});

test("classifyTurnIntent returns model-negotiated capability ids and animation decision", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"intent":"generate","targetTurnId":null,"note":"motion requested","generationStrategy":"single","estimatedSegments":1,"selectedCapabilityIds":["events","lifecycle","declarativeAnimation"],"requiresAnimation":true}' } }]
    })
  });
  try {
    const result = await classifyTurnIntent(
      { userPrompt: "make a character move", history: [] },
      { provider: "chatgpt", apiKey: "test-key", animationCapabilityMode: "auto" }
    );
    assert.deepEqual(result.selectedCapabilityIds, ["events", "lifecycle", "declarativeAnimation"]);
    assert.equal(result.requiresAnimation, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("classifyTurnIntent teaches the model to select sceneText for visible words", async () => {
  let requestBody;
  globalThis.fetch = async (_url, init = {}) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: '{"intent":"generate","targetTurnId":null,"note":"visible title","generationStrategy":"single","estimatedSegments":1,"selectedCapabilityIds":["sceneText"],"requiresAnimation":false}'
            }
          }]
        };
      }
    };
  };

  const result = await classifyTurnIntent(
    { userPrompt: "在门口添加文字‘森林之家’", history: [] },
    { provider: "chatgpt", apiKey: "test-key" }
  );

  assert.match(requestBody.messages[0].content, /select \"sceneText\"/);
  assert.match(requestBody.messages[0].content, /Plain text defaults to SDF scene text/);
  assert.deepEqual(result.selectedCapabilityIds, ["sceneText"]);
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

test("requestUpdatedSceneJsonString forwards negotiated sceneText guidance", async () => {
  const requestBodies = [];
  globalThis.fetch = async (_url, init = {}) => {
    requestBodies.push(JSON.parse(init.body));
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  version: "next",
                  threeJsonId: "text-update",
                  objectList: [
                    {
                      threeJsonId: "title-1",
                      objType: "text",
                      content: "森林之家",
                      mode: "sdf",
                      fontSize: 1.2,
                      color: "#ffffff",
                      position: { x: 0, y: 3, z: 0 }
                    }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  await requestUpdatedSceneJsonString(
    "添加文字森林之家",
    JSON.stringify({
      version: "next",
      threeJsonId: "base",
      objectList: [
        {
          threeJsonId: "floor-1",
          objType: "floor",
          geometry: { width: 4, height: 0.1, depth: 4 },
          material: { color: "#777777" }
        }
      ]
    }),
    {
      provider: "chatgpt",
      apiKey: "test-key",
      selectedCapabilityIds: ["sceneText"]
    }
  );

  assert.equal(requestBodies.length, 1);
  const systemContent = requestBodies[0].messages[0].content;
  assert.match(systemContent, /Negotiated ThreeJSON scene-text capability/);
  assert.match(systemContent, /Preferred default is mode:\"sdf\"/);
});
