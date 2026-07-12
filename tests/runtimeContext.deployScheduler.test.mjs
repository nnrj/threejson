import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";
import {
  buildDeployJobs,
  cancelActiveDeployScheduler,
  runDeployJobsScheduled
} from "../core/runtime/deployScheduler.js";

const scheduledTimeslot = {
  mode: "scheduled",
  policy: "timeslot",
  maxJobsPerFrame: 2,
  maxFrameMs: 50,
  fluxMs: 40,
  density: 1,
  maxInFlightAsync: 4,
  retry: { maxAttempts: 0, backoffMs: 50 }
};

test("cancelling scene B's scheduler does not cancel scene A's in-flight scheduled deploy", async () => {
  const sceneA = { isScene: true };
  const sceneB = { isScene: true };
  const ctxA = createRuntimeContext();
  const ctxB = createRuntimeContext();
  attachRuntimeContext(sceneA, ctxA);
  attachRuntimeContext(sceneB, ctxB);

  let countA = 0;
  const jobsA = buildDeployJobs(
    Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, objType: "box" })),
    () => {
      countA += 1;
    },
    () => 2
  );
  const runA = runDeployJobsScheduled(jobsA, scheduledTimeslot, {}, sceneA);

  // Scene B starts loading while scene A's scheduled deploy is still in flight.
  // This must not touch scene A's activeRun.
  cancelActiveDeployScheduler(sceneB);

  await runA;
  assert.equal(countA, 4, "scene A's scheduled jobs should all complete uninterrupted");
});

test("cancelling scene A's own scheduler still stops scene A's pending jobs", async () => {
  const sceneA = { isScene: true };
  const ctxA = createRuntimeContext();
  attachRuntimeContext(sceneA, ctxA);

  let countA = 0;
  const jobsA = buildDeployJobs(
    Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, objType: "box" })),
    () => {
      countA += 1;
    },
    () => 2
  );
  const runA = runDeployJobsScheduled(jobsA, scheduledTimeslot, {}, sceneA);
  cancelActiveDeployScheduler(sceneA);
  await runA;
  assert.ok(countA < 4, "cancelling scene A's own run should stop its pending jobs");
});
