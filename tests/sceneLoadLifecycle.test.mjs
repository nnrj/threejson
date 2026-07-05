import test from "node:test";
import assert from "node:assert/strict";

import {
  LOAD_PHASE,
  TEARDOWN_PHASE,
  FRAME_PHASE,
  createSceneLifecycleContext,
  createFrameContext,
  createSceneLifecycleBus,
  registerSceneLoadLifecycleExtension,
  resolveLifecycleHooks,
  _clearLifecycleExtensionsForTests
} from "../core/runtime/sceneLoadLifecycle.js";

test("emit short-circuits when no subscribers", async () => {
  const bus = createSceneLifecycleBus();
  await bus.emit(LOAD_PHASE.onRuntimeReady, createSceneLifecycleContext(LOAD_PHASE.onRuntimeReady));
  assert.equal(bus.has(LOAD_PHASE.onRuntimeReady), false);
});

test("resolveLifecycleHooks maps flat options to phases", async () => {
  const order = [];
  const { bus } = resolveLifecycleHooks({
    onRuntimeReady: () => {
      order.push("runtime");
    },
    onSceneReady: () => {
      order.push("scene");
    },
    onDeployProgress: (ctx) => {
      order.push(`progress:${ctx.deploy?.done}`);
    }
  });

  assert.equal(bus.has(LOAD_PHASE.onRuntimeReady), true);
  assert.equal(bus.has(LOAD_PHASE.onSceneReady), true);
  assert.equal(bus.has(LOAD_PHASE.onDeployProgress), true);

  await bus.emit(LOAD_PHASE.onRuntimeReady, createSceneLifecycleContext(LOAD_PHASE.onRuntimeReady, {
    runtime: { scene: {} }
  }));
  await bus.emit(LOAD_PHASE.onDeployProgress, {
    phase: LOAD_PHASE.onDeployProgress,
    deploy: { done: 1, total: 3, jobPhase: 2 }
  });
  await bus.emit(LOAD_PHASE.onSceneReady, createSceneLifecycleContext(LOAD_PHASE.onSceneReady));

  assert.deepEqual(order, ["runtime", "progress:1", "scene"]);
});

test("extension priority runs before user hooks", async () => {
  _clearLifecycleExtensionsForTests();
  registerSceneLoadLifecycleExtension({
    name: "builtin",
    phase: LOAD_PHASE.onSceneReady,
    priority: 0,
    handler: async (ctx) => {
      ctx.order.push("builtin");
    }
  });

  const { bus } = resolveLifecycleHooks({
    onSceneReady: async (ctx) => {
      ctx.order.push("user");
    }
  });

  const ctx = createSceneLifecycleContext(LOAD_PHASE.onSceneReady, { order: [] });
  await bus.emit(LOAD_PHASE.onSceneReady, ctx);
  assert.deepEqual(ctx.order, ["builtin", "user"]);

  _clearLifecycleExtensionsForTests();
});

test("deploy progress emitter invokes onDeployProgress", () => {
  const seen = [];
  const { bus } = resolveLifecycleHooks({
    onDeployProgress: (ctx) => {
      seen.push(ctx.deploy.done);
    }
  });
  assert.equal(bus.has(LOAD_PHASE.onDeployProgress), true);
  const emitter = bus.createDeployProgressEmitter(
    createSceneLifecycleContext(LOAD_PHASE.onDeployProgress),
    { minIntervalMs: 0 }
  );
  emitter({ done: 1, total: 10, phase: 2 });
  emitter({ done: 2, total: 10, phase: 2 });
  assert.deepEqual(seen, [1, 2]);
});

test("deploy progress emitter throttles rapid calls", () => {
  const seen = [];
  const { bus } = resolveLifecycleHooks({
    onDeployProgress: (ctx) => {
      seen.push(ctx.deploy.done);
    }
  });
  const emitter = bus.createDeployProgressEmitter(
    createSceneLifecycleContext(LOAD_PHASE.onDeployProgress),
    { minIntervalMs: 1000 }
  );
  emitter({ done: 1, total: 10, phase: 2 });
  emitter({ done: 2, total: 10, phase: 2 });
  emitter({ done: 3, total: 10, phase: 2 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0], 1);
});

test("frame emitSync passes FrameContext with now", () => {
  const values = [];
  const bus = createSceneLifecycleBus();
  bus.on(FRAME_PHASE.afterRender, {
    name: "test",
    priority: 100,
    handler: (ctx) => {
      values.push(ctx.now);
    }
  });
  bus.emitSync(FRAME_PHASE.afterRender, createFrameContext(FRAME_PHASE.afterRender, { now: 42 }));
  assert.deepEqual(values, [42]);
});

test("teardown phases exist", () => {
  assert.equal(typeof TEARDOWN_PHASE.beforeDispose, "string");
  assert.equal(typeof FRAME_PHASE.beforeFrame, "string");
});
