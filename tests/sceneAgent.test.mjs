import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { resolveAgentDepth } from "../core/ai/agentDepth.js";
import { validateSceneJson, listTexturePointersSummary } from "../core/ai/agentTools.js";
import { runSceneAgent } from "../core/ai/sceneAgent.js";

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

test("resolveAgentDepth returns presets", () => {
  assert.equal(resolveAgentDepth("medium").runOutline, true);
  assert.equal(resolveAgentDepth("simple").maxSteps, 2);
  assert.equal(resolveAgentDepth("unknown").maxSteps, 2);
});

test("validateSceneJson accepts minimal scene", () => {
  const r = validateSceneJson(JSON.stringify(MINIMAL_SCENE));
  assert.equal(r.ok, true);
  assert.equal(r.boxCount, 1);
});

test("listTexturePointersSummary on scene with material", () => {
  const r = listTexturePointersSummary(MINIMAL_SCENE);
  assert.equal(r.count, 1);
});

test("resolveAgentDepth auto allows multiple repair attempts", () => {
  assert.equal(resolveAgentDepth("auto").maxRepairAttempts, 3);
  assert.equal(resolveAgentDepth("deep").runLayoutReview, true);
});

test("runSceneAgent medium agent repairs invalid JSON once", async () => {
  const validScene = JSON.stringify(MINIMAL_SCENE);
  const invalidScene = JSON.stringify({ threeJsonId: "invalid", objectList: [] });
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content =
      call === 1 ? "- floor\n- walls" : call === 2 ? invalidScene : validScene;
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
        agent: { enabled: true, depth: "medium" },
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(result.steps.some((s) => s.kind === "repair"));
    assert.ok(fetchMock.mock.calls.length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent with agent disabled uses single-shot and agentUsed false", async () => {
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
      { mode: "generate", prompt: "a small floor" },
      {
        agent: { enabled: false },
        capabilityReview: false,
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.agentUsed, false);
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent texture fill soft-fails and keeps scene JSON", async () => {
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
      { mode: "generate", prompt: "a small floor" },
      {
        agent: { enabled: false },
        apiKey: "test-key",
        provider: "deepseek",
        texture: {
          enabled: true,
          imageProvider: {
            async generateImage() {
              throw new Error("Failed to fetch");
            }
          },
          sink: {
            saveLocal: async () => "assets/textures/ai-generated/x.png"
          }
        }
      }
    );
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(result.textureFillWarning);
    assert.ok(result.steps.some((s) => s.kind === "fill_textures" && s.ok === false));
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
        agent: { enabled: true, depth: "medium" },
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.outputMode, "commands");
    assert.ok(Array.isArray(result.commands));
    assert.ok(
      result.steps.some((s) => s.ok === false) || fetchMock.mock.calls.length >= 2
    );
    assert.ok(result.steps.some((s) => s.kind === "commands" && s.ok === true));
    assert.ok(fetchMock.mock.calls.length >= 2);
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
        agent: { enabled: true, depth: "medium" },
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
        agent: { enabled: true, depth: "simple" },
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

test("runSceneAgent emits scene_ready before texture fill", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const progress = [];
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
    await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      {
        agent: { enabled: false },
        apiKey: "test-key",
        provider: "deepseek",
        onProgress: (p) => progress.push(p.kind),
        texture: { enabled: false }
      }
    );
    assert.ok(progress.includes("scene_ready"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent medium agent emits stage_preview after repair", async () => {
  const validScene = JSON.stringify(MINIMAL_SCENE);
  const invalidScene = JSON.stringify({ threeJsonId: "invalid", objectList: [] });
  const progress = [];
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content =
      call === 1 ? "- floor\n- walls" : call === 2 ? invalidScene : validScene;
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
        agent: { enabled: true, depth: "medium" },
        apiKey: "test-key",
        provider: "deepseek",
        onProgress: (p) => progress.push(p.kind)
      }
    );
    assert.ok(progress.includes("stage_preview"));
    assert.ok(progress.includes("scene_ready"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent optionally refines a valid draft with mixed-output protocol", async () => {
  const initialScene = JSON.stringify(MINIMAL_SCENE);
  const replies = [
    initialScene,
    '[{"op":"replace","path":"/objectList/0/material/color","value":"#224466"}]',
    "# done"
  ];
  const progress = [];
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return { choices: [{ message: { content: replies.shift() } }] };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "make a simple blockout box" },
      {
        agent: {
          enabled: true,
          depth: "simple",
          progressiveRefinement: true,
          maxDraftRefinementRounds: 2
        },
        apiKey: "test-key",
        provider: "deepseek",
        onProgress: (event) => progress.push(event)
      }
    );

    assert.equal(JSON.parse(result.sceneJsonString).objectList[0].material.color, "#224466");
    assert.ok(result.steps.some((step) => step.kind === "draft_refinement" && step.outputMode === "patch"));
    assert.ok(result.steps.some((step) => step.kind === "draft_refinement_done"));
    assert.ok(progress.filter((event) => event.kind === "stage_preview").length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent iterative apply execs commands and skips final exec batch", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  let fetchCall = 0;
  let applyCount = 0;
  let refreshCount = 0;
  const progress = [];
  const fetchMock = mock.fn(async () => {
    fetchCall += 1;
    const content =
      fetchCall === 1
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
        agent: { enabled: true, depth: "simple", iterativeApply: true },
        apiKey: "test-key",
        provider: "deepseek",
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
          return { currentSceneJsonString: currentScene, objectList: [] };
        },
        onProgress: (p) => progress.push(p.kind)
      }
    );
    assert.equal(result.iterativeApplied, true);
    assert.equal(result.skipFinalExec, true);
    assert.equal(result.execOk, true);
    assert.equal(applyCount, 1);
    assert.equal(refreshCount, 1);
    assert.ok(progress.includes("commands_applied"));
    assert.ok(progress.includes("refine"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
