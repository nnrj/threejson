import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { validateSceneJson } from "../core/ai/agentTools.js";
import { runSceneAgent } from "../core/ai/sceneAgent.js";
import {
  extractVisualFeedbackFromBatch,
  formatObjectGetFeedbackFromBatch
} from "../core/ai/sceneCommandSkill.js";

const MINIMAL_SCENE = {
  threeJsonId: "agent-test",
  worldInfo: {
    boxModelList: [
      {
        name: "floor",
        objType: "box",
        geometry: { width: 10, height: 0.2, depth: 10 },
        position: { x: 0, y: 0, z: 0 },
        material: { type: "standard", color: "#888888" }
      }
    ]
  }
};

function sceneWithFloorColor(color) {
  return JSON.stringify({
    ...MINIMAL_SCENE,
    worldInfo: {
      ...MINIMAL_SCENE.worldInfo,
      boxModelList: MINIMAL_SCENE.worldInfo.boxModelList.map((item) => ({
        ...item,
        material: { ...item.material, color }
      }))
    }
  });
}

test("validateSceneJson accepts minimal scene", () => {
  const r = validateSceneJson(JSON.stringify(MINIMAL_SCENE));
  assert.equal(r.ok, true);
  assert.equal(r.boxCount, 1);
});

// Direct generation is the default. Tests that exercise incremental construction opt into
// executionMode:"draft_refine" explicitly; generationStrategy remains an independent transport
// hint.

test("runSceneAgent repairs an invalid draft once, then completes via done/reviews", async () => {
  const validScene = JSON.stringify(MINIMAL_SCENE);
  const invalidScene = JSON.stringify({ threeJsonId: "invalid", objectList: [] });
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    // 1: outline, 2: draft (invalid), 3: repair fix (valid), 4+: refine/review rounds all "# done"
    const content = call === 1 ? "- floor\n- walls" : call === 2 ? invalidScene : call === 3 ? validScene : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        generationStrategy: "segmented"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(result.steps.some((s) => s.kind === "repair" && s.ok === true));
    assert.ok(fetchMock.mock.calls.length >= 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent uses one complete generation call by default", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() { return ""; },
    async json() { return { choices: [{ message: { content: scenePayload } }] }; }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a simple box" },
      {
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.completed, true);
    assert.equal(result.executionMode, "direct");
    assert.equal(result.stopReason, "direct_complete");
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.equal(fetchMock.mock.calls.length, 1, JSON.stringify(result.steps));
    assert.equal(result.steps.some((step) => step.kind === "draft_refinement"), false);
    assert.equal(result.steps.some((step) => step.kind === "layout_review"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mesh review feedback keeps image payloads out of text and exposes them separately", () => {
  const results = [{
    ok: true,
    op: "mesh.renderViews",
    data: {
      threeJsonId: "model-1",
      views: [{ name: "front", width: 320, height: 240, dataUrl: "data:image/png;base64,AA==" }]
    }
  }];
  const textFeedback = formatObjectGetFeedbackFromBatch(results);
  assert.match(textFeedback, /"imageAttached": true/);
  assert.doesNotMatch(textFeedback, /data:image/);
  assert.deepEqual(extractVisualFeedbackFromBatch(results), [{
    url: "data:image/png;base64,AA==",
    detail: "low",
    label: "front"
  }]);
});

test("structured envelope metadata does not create a false animation review", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() { return ""; },
    async json() { return { choices: [{ message: { content: scenePayload } }] }; }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "generate",
        prompt: JSON.stringify({
          intent: "generate",
          userRequest: "a simple box",
          requiresAnimation: false,
          executionMode: "direct"
        })
      },
      { apiKey: "test-key", provider: "deepseek" }
    );
    assert.equal(result.executionMode, "direct");
    assert.equal(fetchMock.mock.calls.length, 1, JSON.stringify(result.steps));
    assert.equal(result.steps.some((step) => step.kind === "capability_review" && step.attempt), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent enforces only an explicitly configured aggregate model token budget", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async (_url, init = {}) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: scenePayload }, finish_reason: "stop" }],
          usage: { prompt_tokens: 80, completion_tokens: 50, total_tokens: 130 }
        };
      }
    };
  });
  try {
    await assert.rejects(
      runSceneAgent(
        { mode: "generate", prompt: "a simple box" },
        {
          apiKey: "test-key",
          provider: "deepseek",
          modelBudget: { maxTokens: 100 }
        }
      ),
      (error) => error?.code === "AI_MODEL_TOKEN_BUDGET_EXCEEDED"
    );
    assert.equal(requestBody.max_tokens, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent rejects an explicit cost budget when the provider cannot account for cost", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => ({
    ok: true,
    async json() {
      return {
        choices: [{ message: { content: scenePayload }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      };
    }
  }));
  try {
    await assert.rejects(
      runSceneAgent(
        { mode: "generate", prompt: "a simple box" },
        {
          apiKey: "test-key",
          provider: "deepseek",
          modelBudget: { maxCost: 1 }
        }
      ),
      (error) => error?.code === "AI_MODEL_COST_ESTIMATOR_REQUIRED"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent streams direct scene JSON through an isolated visible-output channel", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const splitAt = Math.floor(scenePayload.length / 2);
  const fragments = [scenePayload.slice(0, splitAt), scenePayload.slice(splitAt)];
  const sse = [
    ...fragments.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n"
  ].join("");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => new Response(sse, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  }));
  const streamed = [];
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a simple box" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        stream: true,
        onDelta: (delta, metadata) => streamed.push({ delta, metadata })
      }
    );
    assert.equal(result.executionMode, "direct");
    assert.equal(streamed.map((entry) => entry.delta).join(""), scenePayload);
    assert.equal(streamed[0].metadata.stage, "direct_scene");
    assert.equal(streamed[0].metadata.outputMode, "json");
    assert.equal(streamed[0].metadata.reset, true);
    assert.equal(streamed[1].metadata.reset, false);
    assert.equal(streamed[0].metadata.streamId, streamed[1].metadata.streamId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent preserves the model's planet texture choices without forced local replacement", async () => {
  const scenePayload = JSON.stringify({
    threeJsonId: "earth-moon",
    worldInfo: {
      sphereModelList: [
        {
          threeJsonId: "earth",
          name: "Earth",
          geometry: { radius: 4 },
          material: { color: "#000000", textureUrl: "https://unreliable.example/earth.jpg" }
        },
        { threeJsonId: "moon", name: "Moon", geometry: { radius: 1 }, material: { color: "#222222" } }
      ],
      modelList: [
        {
          threeJsonId: "saturn-ring",
          name: "Saturn Ring",
          objType: "ring",
          geometry: { type: "ring", innerRadius: 4, outerRadius: 6 },
          material: { color: "#111111" }
        }
      ]
    }
  });
  const progress = [];
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() { return ""; },
    async json() { return { choices: [{ message: { content: scenePayload } }] }; }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "Create a Solar System" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        onProgress: (event) => progress.push(event)
      }
    );
    const scene = JSON.parse(result.sceneJsonString);
    const earth = scene.objectList.find((item) => item.threeJsonId === "earth");
    const moon = scene.objectList.find((item) => item.threeJsonId === "moon");
    const saturnRing = scene.objectList.find((item) => item.threeJsonId === "saturn-ring");
    assert.equal(earth.material.textureUrl, "https://unreliable.example/earth.jpg");
    assert.equal(moon.material.textureUrl, undefined);
    assert.equal(saturnRing.material.textureUrl, undefined);
    assert.equal(earth.material.color, "#000000");
    const preview = progress.find((event) => event.kind === "stage_preview");
    assert.match(preview.sceneJsonString, /https:\/\/unreliable\.example\/earth\.jpg/);
    assert.doesNotMatch(preview.sceneJsonString, /\/assets\/textures\/environment\/nature\/planet\//);
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent escalates a real direct output cutoff to incremental construction", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1
      ? '{"threeJsonId":"cut-off","objectList":['
      : call === 2
        ? "- establish the main structure"
        : call === 3
          ? scenePayload
          : "# done";
    return {
      ok: true,
      async text() { return ""; },
      async json() {
        return {
          choices: [{ message: { content }, finish_reason: call === 1 ? "length" : "stop" }]
        };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a scene too large for one response" },
      { apiKey: "test-key", provider: "deepseek", agent: { maxRefineRounds: 2 } }
    );
    assert.equal(result.executionMode, "draft_refine");
    assert.ok(result.steps.some((step) => step.kind === "execution_fallback" && step.reason === "output_limit"));
    assert.equal(result.completed, true);
    assert.equal(fetchMock.mock.calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forced full-coordinate generation recovers by segmented transport without changing representation", async () => {
  const rawBufferScene = JSON.stringify({
    threeJsonId: "raw-buffer-scene",
    objectList: [{
      threeJsonId: "raw-model",
      objType: "bufferMesh",
      geometry: {
        attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0], itemSize: 3, type: "Float32Array" } },
        index: { array: [0, 1, 2], type: "Uint16Array" }
      }
    }]
  });
  const requestBodies = [];
  let call = 0;
  const fetchMock = mock.fn(async (_url, init = {}) => {
    call += 1;
    requestBodies.push(JSON.parse(init.body));
    const content = call === 1 ? '{"threeJsonId":"raw-cut-off","objectList":[' : rawBufferScene;
    return {
      ok: true,
      async text() { return ""; },
      async json() {
        return { choices: [{ message: { content }, finish_reason: call === 1 ? "length" : "stop" }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "Generate a free-form raw BufferGeometry with complete coordinates." },
      {
        apiKey: "test-key",
        provider: "deepseek",
        complexModelStrategy: "full-coordinates",
        selectedCapabilityIds: ["complexMesh", "rawBufferMesh"]
      }
    );
    assert.equal(result.executionMode, "direct");
    assert.equal(result.steps.some((step) => step.kind === "execution_fallback"), false);
    assert.equal(JSON.parse(result.sceneJsonString).objectList[0].objType, "bufferMesh");
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.match(requestBodies[1].messages[0].content, /SEGMENTED OUTPUT PROTOCOL/);
    assert.match(requestBodies[1].messages.at(-1).content, /complete scene again from the beginning/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent recovers when both direct generation and the first structural draft hit their limits", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const requestBodies = [];
  let call = 0;
  const fetchMock = mock.fn(async (_url, init = {}) => {
    call += 1;
    requestBodies.push(JSON.parse(init.body));
    const content = call === 1
      ? '{"threeJsonId":"direct-cut-off","objectList":['
      : call === 2
        ? "- establish the park layout and primary attractions"
        : call === 3
          ? '{"threeJsonId":"draft-cut-off","objectList":['
          : call === 4
            ? scenePayload
            : "# done";
    return {
      ok: true,
      async text() { return ""; },
      async json() {
        return {
          choices: [{
            message: { content },
            finish_reason: call === 1 || call === 3 ? "length" : "stop"
          }]
        };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "创建一个游乐园" },
      { apiKey: "test-key", provider: "deepseek", agent: { maxRefineRounds: 2 } }
    );

    assert.equal(result.executionMode, "draft_refine");
    assert.equal(result.completed, true);
    assert.equal(fetchMock.mock.calls.length, 5);
    assert.equal(Object.hasOwn(requestBodies[2], "max_tokens"), false);
    assert.equal(Object.hasOwn(requestBodies[3], "max_tokens"), false);
    assert.match(requestBodies[2].messages.at(-1).content, /STRUCTURAL DRAFT CONTRACT/);
    assert.match(requestBodies[2].messages.at(-1).content, /do not obey or invent an arbitrary token or object-count quota/);
    assert.match(requestBodies[2].messages.at(-1).content, /recognizable low-density editableMesh or compact surface/);
    assert.match(requestBodies[2].messages.at(-1).content, /not a mandatory pre-stage for every complex model/);
    assert.match(requestBodies[3].messages[0].content, /SEGMENTED OUTPUT PROTOCOL/);
    assert.match(requestBodies[3].messages.at(-1).content, /COMPACT STRUCTURAL-DRAFT REGENERATION REQUIREMENT/);
    assert.doesNotMatch(requestBodies[3].messages.at(-1).content, /Generate the complete scene again/);
    assert.ok(result.steps.some((step) => step.kind === "execution_fallback" && step.reason === "output_limit"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runSceneAgent keeps generationStrategy "compact" independent from automatic refinement', async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1 ? "- crowd" : call === 2 ? scenePayload : "# done";
    return {
      ok: true,
      async text() { return ""; },
      async json() { return { choices: [{ message: { content } }] }; }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a large but simplified crowd scene" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        generationStrategy: "compact",
        estimatedSegments: 1
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.completed, true);
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(fetchMock.mock.calls.length >= 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent keeps segmented transport metadata independent from direct execution", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return {
        choices: [{ message: { content: scenePayload } }]
      };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a simple box" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "segmented"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.executionMode, "direct");
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent respects a caller-configured maxRefineRounds cap", async () => {
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1
      ? "- floor"
      : call === 2
        ? JSON.stringify({ ...MINIMAL_SCENE, threeJsonId: `agent-test-${call}` })
        : `${JSON.stringify({ ...MINIMAL_SCENE, threeJsonId: `agent-test-${call}` })}\n# continue`;
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a simple box" },
      {
        agent: { maxRefineRounds: 2 },
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        generationStrategy: "segmented"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.completed, false);
    assert.equal(result.stopReason, "budget_exhausted");
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.equal(fetchMock.mock.calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent leaves texture acquisition to the host pipeline", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => ({
    ok: true,
    async text() { return ""; },
    async json() { return { choices: [{ message: { content: scenePayload } }] }; }
  }));
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        agent: { maxRefineRounds: 1 },
        generationStrategy: "segmented",
        texture: { enabled: true }
      }
    );
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.equal(result.textureFillWarning, undefined);
    assert.equal(result.steps.some((s) => s.kind === "fill_textures"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent update commands agent repairs invalid script", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const validCommands =
    'object.patch id=floor partial={"material":{"color":"#336699"}}';
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    // Direct adjustment skips a ceremonial outline. Two invalid replies are repaired by the
    // third useful response; the three-attempt guard is an anomaly guard, not a quality budget.
    const content =
      call === 1
        ? "- patch floor color"
        : call === 2
          ? "not a command script"
          : validCommands;
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.outputMode, "commands");
    assert.ok(Array.isArray(result.commands));
    assert.ok(result.steps.some((s) => s.ok === false));
    assert.ok(result.steps.some((s) => s.kind === "commands" && s.ok === true));
    assert.ok(fetchMock.mock.calls.length >= 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent attaches local reference material to an agent commands round when the prompt matches a covered signal", async () => {
  // End-to-end wiring check: chatOptions.resolveReferenceUrl/locale (as a ThreeBox-style host
  // would pass them) should flow all the way from runSceneAgent's options bag down into the
  // actual chat-completion user message for a commands-mode agent round, via
  // resolveAgentReferenceMaterial + sceneReferenceCatalog.fetchReferenceMaterial.
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const manifest = [
    {
      section: "event-mechanism",
      sectionTitleEn: "Event Mechanism",
      docLinks: [{ file: "event-mechanism.md" }],
      items: [{ id: "declarative-action", json: "assets/json/demo-show/event-mechanism/declarative-action.json" }]
    }
  ];
  const fakeExample = JSON.stringify({ threeJsonId: "demo", worldInfo: { boxModelList: [] } });
  let chatMessagesLastCall = null;
  const fetchMock = mock.fn(async (url, opts) => {
    const href = String(url);
    if (href === "https://ref.test/assets/json/demo-show/manifest.json") {
      return { ok: true, async text() { return JSON.stringify(manifest); } };
    }
    if (href === "https://ref.test/docs/en/event-mechanism.md") {
      return { ok: true, async text() { return "Use object events with action(s) for click/hover."; } };
    }
    if (href === "https://ref.test/assets/json/demo-show/event-mechanism/declarative-action.json") {
      return { ok: true, async text() { return fakeExample; } };
    }
    // Chat completion endpoint
    const body = JSON.parse(opts.body);
    chatMessagesLastCall = body.messages;
    return {
      ok: true,
      async text() { return ""; },
      async json() {
        return {
          choices: [
            { message: { content: 'object.patch id=floor partial={"material":{"color":"#336699"}}' } }
          ]
        };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "add a click event on the floor",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek",
        resolveReferenceUrl: (path) => `https://ref.test/${path}`,
        locale: "en-US"
      }
    );
    assert.equal(result.outputMode, "commands");
    assert.ok(chatMessagesLastCall, "expected at least one chat-completion call");
    const userMessage = chatMessagesLastCall.find((m) => m.role === "user")?.content || "";
    assert.ok(userMessage.includes("Event Mechanism"), "user message should include the matched section title");
    assert.ok(
      userMessage.includes("Use object events with action(s) for click/hover."),
      "user message should include the fetched doc excerpt"
    );
    assert.ok(userMessage.includes("declarative-action"), "user message should include the fetched example");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent update auto accepts JSON output in agent session", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const updatedScene = JSON.stringify({
    ...MINIMAL_SCENE,
    worldInfo: {
      boxModelList: [
        {
          ...MINIMAL_SCENE.worldInfo.boxModelList[0],
          material: { type: "standard", color: "#112233" }
        }
      ]
    }
  });
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return { choices: [{ message: { content: updatedScene } }] };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "auto"
      },
      {
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.outputMode, "json");
    assert.ok(result.sceneJsonString.includes("112233"));
    assert.ok(result.steps.some((s) => s.kind === "auto_json"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent emits scene_ready independently of the host texture pipeline", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const progress = [];
  const fetchMock = mock.fn(async () => {
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return {
          choices: [{ message: { content: scenePayload } }]
        };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        agent: { maxRefineRounds: 1 },
        generationStrategy: "segmented",
        onProgress: (p) => progress.push(p.kind),
        texture: { enabled: false }
      }
    );
    assert.ok(progress.includes("scene_ready"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent emits stage_preview after repair", async () => {
  const validScene = JSON.stringify(MINIMAL_SCENE);
  const invalidScene = JSON.stringify({ threeJsonId: "invalid", objectList: [] });
  const progress = [];
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1 ? "- floor\n- walls" : call === 2 ? invalidScene : call === 3 ? validScene : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    await runSceneAgent(
      { mode: "generate", prompt: "floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        agent: { maxRefineRounds: 1 },
        generationStrategy: "segmented",
        onProgress: (p) => progress.push(p.kind)
      }
    );
    assert.ok(progress.includes("stage_preview"));
    assert.ok(progress.includes("scene_ready"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent refines a valid draft with mixed-output protocol until done", async () => {
  const initialScene = JSON.stringify(MINIMAL_SCENE);
  const replies = [
    "- outline text",
    initialScene,
    '[{"op":"replace","path":"/objectList/0/material/color","value":"#224466"}]',
    "# done",
    "# done" // layout review round
  ];
  const progress = [];
  const requestBodies = [];
  const fetchMock = mock.fn(async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));
    return {
      ok: true,
      async text() { return ""; },
      async json() { return { choices: [{ message: { content: replies.shift() || "# done" } }] }; }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "make a simple blockout box" },
      {
        agent: { maxRefineRounds: 5 },
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        generationStrategy: "segmented",
        onProgress: (event) => progress.push(event)
      }
    );

    assert.equal(JSON.parse(result.sceneJsonString).objectList[0].material.color, "#224466");
    assert.ok(result.steps.some((step) => step.kind === "draft_refinement" && step.outputMode === "patch"));
    assert.ok(result.steps.some((step) => step.kind === "draft_refinement_done"));
    assert.ok(progress.filter((event) => event.kind === "stage_preview").length >= 1);
    assert.match(requestBodies[2].messages[1].content, /Object spatial summary/);
    assert.doesNotMatch(requestBodies[2].messages[1].content, /Current scene JSON/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent iterative apply execs commands and skips final exec batch", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const changedScene = sceneWithFloorColor("#112233");
  let fetchCall = 0;
  let applyCount = 0;
  let refreshCount = 0;
  const progress = [];
  const fetchMock = mock.fn(async () => {
    fetchCall += 1;
    // 1: outline, 2: round-1 commands, 3+: done
    const content =
      fetchCall === 1
        ? "- outline text"
        : fetchCall === 2
          ? 'object.patch id=floor partial={"material":{"color":"#112233"}}'
          : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "segmented",
        applyCommands: async (commands, meta) => {
          if (meta.readOnly) {
            return { ok: true, sceneMutated: false };
          }
          applyCount += 1;
          assert.ok(Array.isArray(commands) && commands.length > 0);
          return { ok: true, sceneMutated: true };
        },
        refreshContext: async () => {
          refreshCount += 1;
          return { currentSceneJsonString: changedScene, objectList: [] };
        },
        onProgress: (p) => progress.push(p.kind)
      }
    );
    assert.equal(result.iterativeApplied, true);
    assert.equal(result.skipFinalExec, true);
    assert.equal(result.execOk, true);
    assert.equal(applyCount, 1);
    assert.equal(refreshCount, 1);
    assert.equal(result.stopReason, "implicit_complete");
    assert.equal(fetchCall, 2);
    assert.ok(progress.includes("commands_applied"));
    assert.ok(progress.includes("refine"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent feeds paged mesh readback and host-rendered views into the next refinement request", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const changedScene = sceneWithFloorColor("#334455");
  const requestBodies = [];
  let fetchCall = 0;
  let applyCall = 0;
  let refreshCall = 0;
  const fetchMock = mock.fn(async (_url, init = {}) => {
    fetchCall += 1;
    requestBodies.push(JSON.parse(init.body));
    const content = fetchCall === 1
      ? "- inspect the local topology, then refine it"
      : fetchCall === 2
        ? 'mesh.getTopology id=model-1 part=body page=2 pageSize=50\nmesh.renderViews id=model-1 views=["front","perspective"]'
        : 'object.patch id=floor partial={"material":{"color":"#334455"}}\n# done';
    return {
      ok: true,
      async text() { return ""; },
      async json() { return { choices: [{ message: { content } }] }; }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "refine the body topology",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "model-1", objType: "editableMesh" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "segmented",
        visualReviewAvailable: true,
        applyCommands: async (_commands, meta) => {
          applyCall += 1;
          if (meta.readOnly) {
            return {
              ok: true,
              sceneMutated: false,
              objectGetFeedback: '{"op":"mesh.getTopology","result":{"page":2,"hasMore":true}}',
              visualFeedback: [{ url: "data:image/png;base64,AA==", detail: "low", label: "front" }]
            };
          }
          return { ok: true, sceneMutated: true };
        },
        refreshContext: async () => {
          refreshCall += 1;
          return {
            currentSceneJsonString: refreshCall === 1 ? currentScene : changedScene,
            objectList: []
          };
        }
      }
    );
    assert.equal(result.completed, true);
    assert.equal(result.stopReason, "model_done");
    assert.equal(applyCall, 2);
    assert.equal(fetchCall, 3);
    const followUpContent = requestBodies[2].messages[1].content;
    assert.ok(Array.isArray(followUpContent));
    assert.match(followUpContent[0].text, /mesh\.getTopology/);
    assert.match(followUpContent[0].text, /"page":2/);
    assert.equal(followUpContent[1].type, "image_url");
    assert.equal(followUpContent[1].image_url.url, "data:image/png;base64,AA==");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent applies commands before honoring a same-response # done and returns every applied round", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const changedScene = sceneWithFloorColor("#112233");
  const replies = [
    'object.patch id=floor partial={"material":{"color":"#112233"}}\ncamera.fit mode=scene\n# done'
  ];
  const applied = [];
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() { return ""; },
    async json() { return { choices: [{ message: { content: replies.shift() || "# done" } }] }; }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "polish the floor and frame it",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        agent: { maxRefineRounds: 4 },
        apiKey: "test-key",
        provider: "deepseek",
        applyCommands: async (commands) => {
          applied.push(...commands);
          return { ok: true, sceneMutated: true };
        },
        refreshContext: async () => ({ currentSceneJsonString: changedScene, objectList: [] })
      }
    );
    assert.equal(result.completed, true);
    assert.equal(result.stopReason, "model_done");
    assert.equal(applied.length, 2);
    assert.equal(result.commands.length, 2);
    assert.equal(result.commands[1].op, "camera.fit");
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent update commands iterates by default when the host supplies apply/refresh callbacks", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const changedScene = sceneWithFloorColor("#336699");
  const validCommands = 'object.patch id=floor partial={"material":{"color":"#336699"}}';
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1 ? "- change color" : call === 2 ? validCommands : "# done";
    return {
      ok: true,
      async text() { return ""; },
      async json() { return { choices: [{ message: { content } }] }; }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek",
        applyCommands: async () => ({ ok: true, sceneMutated: true }),
        refreshContext: async () => ({ currentSceneJsonString: changedScene, objectList: [] })
      }
    );
    assert.equal(result.outputMode, "commands");
    assert.equal(result.iterativeApplied, true);
    assert.equal(result.completed, true);
    assert.ok(Array.isArray(result.commands) && result.commands.length > 0);
    assert.equal(result.stopReason, "implicit_complete");
    assert.equal(fetchMock.mock.calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent stops a repeated command batch before applying it twice", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const changedScene = JSON.stringify({
    ...MINIMAL_SCENE,
    worldInfo: {
      boxModelList: [{
        ...MINIMAL_SCENE.worldInfo.boxModelList[0],
        material: { type: "standard", color: "#336699" }
      }]
    }
  });
  const command = [
    'object.patch id=floor partial={"material":{"color":"#336699"}}',
    "# continue: verify the applied color"
  ].join("\n");
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() { return ""; },
    async json() { return { choices: [{ message: { content: command } }] }; }
  }));
  let applyCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change the floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek",
        agent: { maxRefineRounds: 4 },
        applyCommands: async () => {
          applyCount += 1;
          return { ok: true, sceneMutated: true };
        },
        refreshContext: async () => ({ currentSceneJsonString: changedScene, objectList: [] })
      }
    );
    assert.equal(result.stopReason, "repeated_output");
    assert.equal(applyCount, 1);
    assert.equal(fetchMock.mock.calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent update commands falls back to the non-iterative runner without applyCommands/refreshContext", async () => {
  // canIterate requires BOTH applyCommands and refreshContext — omitting them (as a bare core/ai
  // caller with no live/offscreen runtime would) must not throw; it should use the
  // collect-one-batch-and-return runner instead.
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const validCommands = 'object.patch id=floor partial={"material":{"color":"#336699"}}';
  const fetchMock = mock.fn(async () => {
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content: validCommands } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands"
      },
      {
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.outputMode, "commands");
    assert.equal(result.iterativeApplied, undefined);
    assert.ok(Array.isArray(result.commands) && result.commands.length > 0);
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent tolerates an outline failure and still produces a scene", async () => {
  // The outline is a cheap, best-effort planning aid — an empty/flaky response from that one call
  // must not abort the whole turn before a single scene JSON call has even been attempted.
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1 ? "" : call === 2 ? scenePayload : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a simple box" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        generationStrategy: "segmented"
      }
    );
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(result.steps.some((s) => s.kind === "outline" && s.ok === false));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent keeps a valid draft when both capability and layout review rounds fail", async () => {
  // The prompt asks for a visible text label; the draft only carries it as box metadata (no
  // objType:"text" item), so evaluateSceneCapabilityFit reports a gap and both the capability and
  // layout review stages attempt a fix — every one of those attempts (and their full-JSON
  // fallbacks) fails here (network error). None of that may turn an already-valid draft into a
  // reported generation failure.
  const cabinScene = JSON.stringify({
    threeJsonId: "cabin-scene",
    objectList: [{ threeJsonId: "cabin", objType: "box", label: "森林之家" }]
  });
  const prompt = "在小木屋门口添加文字'森林之家'";
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    if (call === 1) {
      return { ok: true, async text() { return ""; }, async json() { return { choices: [{ message: { content: "- cabin\n- label" } }] }; } };
    }
    if (call === 2) {
      return { ok: true, async text() { return ""; }, async json() { return { choices: [{ message: { content: cabinScene } }] }; } };
    }
    if (call === 3) {
      // Draft refinement round: say done immediately to keep the mock sequence small.
      return { ok: true, async text() { return ""; }, async json() { return { choices: [{ message: { content: "# done" } }] }; } };
    }
    // Capability review's attempt + full-JSON fallback, then layout review's attempt + fallback —
    // all fail.
    throw new Error("network down");
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt },
      {
        apiKey: "test-key",
        provider: "deepseek",
        executionMode: "draft_refine",
        generationStrategy: "segmented",
        agent: { layoutReview: true }
      }
    );
    assert.equal(JSON.parse(result.sceneJsonString).threeJsonId, "cabin-scene");
    assert.ok(result.steps.some((s) => s.kind === "capability_review"));
    assert.ok(result.steps.some((s) => s.kind === "layout_review"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
