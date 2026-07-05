import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeployJobs,
  cancelActiveDeployScheduler,
  isRecordDeployImmediate,
  resolveDeploySchedulerConfig,
  runDeployJobs,
  runDeployJobsImmediate,
  runDeployJobsScheduled
} from "../core/runtime/deployScheduler.js";

const scheduledFrameBudget = {
  mode: "scheduled",
  policy: "frameBudget",
  maxJobsPerFrame: 2,
  maxFrameMs: 50,
  fluxMs: 1,
  density: 1,
  maxInFlightAsync: 4,
  retry: { maxAttempts: 0, backoffMs: 50 }
};

test("resolveDeploySchedulerConfig defaults to immediate", () => {
  const cfg = resolveDeploySchedulerConfig({});
  assert.equal(cfg.mode, "immediate");
});

test("resolveDeploySchedulerConfig enables scheduled", () => {
  const cfg = resolveDeploySchedulerConfig({ deployScheduler: { enabled: true } });
  assert.equal(cfg.mode, "scheduled");
  assert.equal(cfg.policy, "frameBudget");
});

test("resolveDeploySchedulerConfig timeslot policy", () => {
  const cfg = resolveDeploySchedulerConfig({
    deployScheduler: { mode: "scheduled", policy: "timeslot", fluxMs: 5, density: 2 }
  });
  assert.equal(cfg.policy, "timeslot");
  assert.equal(cfg.fluxMs, 5);
  assert.equal(cfg.density, 2);
});

test("buildDeployJobs respects custom getPhase and priority sort", () => {
  const order = [];
  const jobs = buildDeployJobs(
    [
      { id: "b", objType: "box", priority: 1 },
      { id: "a", objType: "box", priority: 9 },
      { id: "skip", objType: "scene" }
    ],
    (record) => order.push(record.id),
    (record) => (record.objType === "scene" ? 0 : 2)
  );
  runDeployJobsImmediate(jobs);
  assert.deepEqual(order, ["a", "b"]);
});

test("runDeployJobsScheduled frameBudget completes all jobs", async () => {
  let count = 0;
  const jobs = buildDeployJobs(
    Array.from({ length: 5 }, (_, i) => ({ id: `j${i}`, objType: "box" })),
    () => {
      count += 1;
    },
    () => 2
  );
  await runDeployJobsScheduled(jobs, scheduledFrameBudget);
  assert.equal(count, 5);
});

test("runDeployJobsScheduled completes lower deploy phase before higher", async () => {
  const order = [];
  const records = [
    { id: "ext1", objType: "externalmodel" },
    { id: "box1", objType: "box" },
    { id: "ext2", objType: "externalmodel" },
    { id: "box2", objType: "box" }
  ];
  const jobs = buildDeployJobs(
    records,
    (record) => order.push(record.id),
    (record) => (record.objType === "externalmodel" ? 3 : 2)
  );
  await runDeployJobsScheduled(jobs, { ...scheduledFrameBudget, maxJobsPerFrame: 1 });
  assert.deepEqual(order, ["box1", "box2", "ext1", "ext2"]);
});

test("runDeployJobsScheduled onProgress reports done and total", async () => {
  const progress = [];
  const jobs = buildDeployJobs(
    [
      { id: "a", objType: "box" },
      { id: "b", objType: "box" }
    ],
    () => {},
    () => 2
  );
  await runDeployJobsScheduled(jobs, { ...scheduledFrameBudget, maxJobsPerFrame: 1 }, {
    onProgress: (info) => progress.push(info)
  });
  assert.equal(progress.length, 2);
  assert.equal(progress[0].done, 1);
  assert.equal(progress[1].done, 2);
  assert.equal(progress[1].total, 2);
  assert.equal(progress[0].phase, 2);
});

test("cancelActiveDeployScheduler stops pending timeslot jobs", async () => {
  let count = 0;
  const jobs = buildDeployJobs(
    Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, objType: "box" })),
    () => {
      count += 1;
    },
    () => 2
  );
  const run = runDeployJobsScheduled(jobs, {
    ...scheduledFrameBudget,
    policy: "timeslot",
    fluxMs: 40,
    density: 1
  });
  cancelActiveDeployScheduler();
  await run;
  assert.ok(count < 4);
});

test("resolveDeploySchedulerConfig merges record.deployScheduler override", () => {
  const cfg = resolveDeploySchedulerConfig(
    { deployScheduler: { enabled: true, policy: "timeslot", fluxMs: 10 } },
    { mode: "immediate" }
  );
  assert.equal(cfg.mode, "immediate");
});

test("isRecordDeployImmediate when record requests immediate in scheduled scene", () => {
  const sceneConfig = { deployScheduler: { enabled: true } };
  assert.equal(isRecordDeployImmediate(sceneConfig, { deployScheduler: { mode: "immediate" } }), true);
  assert.equal(isRecordDeployImmediate(sceneConfig, {}), false);
});

test("record deployScheduler immediate runs before scheduled timeslot jobs", async () => {
  const order = [];
  const sceneConfig = { deployScheduler: { enabled: true, policy: "timeslot", fluxMs: 5, density: 1 } };
  const jobs = buildDeployJobs(
    [
      { id: "slow", objType: "box" },
      { id: "fast", objType: "box", deployScheduler: { mode: "immediate" } }
    ],
    (record) => {
      order.push(record.id);
    },
    () => 2,
    sceneConfig
  );
  assert.equal(jobs.find((j) => j.id === "fast")?.forceImmediate, true);
  await runDeployJobsScheduled(jobs, resolveDeploySchedulerConfig(sceneConfig));
  assert.equal(order[0], "fast");
});

test("runDeployJobsScheduled async pool respects maxInFlightAsync", async () => {
  let inFlight = 0;
  let maxSeen = 0;
  const sceneConfig = { deployScheduler: { enabled: true } };
  const jobs = buildDeployJobs(
    Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, objType: "externalmodel" })),
    () =>
      new Promise((resolve) => {
        inFlight += 1;
        maxSeen = Math.max(maxSeen, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          resolve();
        }, 30);
      }),
    () => 3,
    sceneConfig
  );
  await runDeployJobsScheduled(jobs, {
    ...resolveDeploySchedulerConfig(sceneConfig),
    maxInFlightAsync: 2
  });
  assert.ok(maxSeen <= 2);
  assert.equal(maxSeen, 2);
});

test("runDeployJobs waits for async externalmodel jobs", async () => {
  let done = false;
  const jobs = buildDeployJobs(
    [{ id: "ship", objType: "externalmodel" }],
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          done = true;
          resolve();
        }, 20);
      }),
    () => 3
  );
  assert.equal(done, false);
  await runDeployJobs(jobs);
  assert.equal(done, true);
});

test("runDeployJobsScheduled retries async job on failure", async () => {
  let attempts = 0;
  const sceneConfig = { deployScheduler: { enabled: true } };
  const jobs = buildDeployJobs(
    [{ id: "x", objType: "externalmodel" }],
    () => {
      attempts += 1;
      if (attempts < 2) {
        return Promise.reject(new Error("fail once"));
      }
      return Promise.resolve();
    },
    () => 3,
    sceneConfig
  );
  await runDeployJobsScheduled(jobs, {
    ...resolveDeploySchedulerConfig(sceneConfig),
    retry: { maxAttempts: 2, backoffMs: 1 }
  });
  assert.equal(attempts, 2);
});
