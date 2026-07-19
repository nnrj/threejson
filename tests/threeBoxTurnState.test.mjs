import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createUnsuccessfulTurnRecord,
  isSceneContextTurn,
  isUnsuccessfulTurn,
  resolveThreeBoxNegotiatedRoute
} from "../tools/scene-host/threebox/js/threeBoxTurnState.js";

test("failed ThreeBox turns persist replayable error state but are not scene context", () => {
  const turn = createUnsuccessfulTurnRecord({
    id: "turn-failed",
    conversationId: "conversation-1",
    userPrompt: "generate a city",
    mode: "generate",
    errorMessage: "provider timeout",
    createdAt: 123
  });

  assert.equal(turn.status, "failed");
  assert.equal(turn.errorMessage, "provider timeout");
  assert.equal(turn.sceneJson, null);
  assert.equal(isUnsuccessfulTurn(turn), true);
  assert.equal(isSceneContextTurn(turn), false);
});

test("stopped adjustment turns retain their target for retry", () => {
  const turn = createUnsuccessfulTurnRecord({
    id: "turn-stopped",
    conversationId: "conversation-1",
    userPrompt: "move the door",
    mode: "adjust",
    targetTurnId: "turn-base",
    stopped: true
  });

  assert.equal(turn.status, "stopped");
  assert.equal(turn.targetTurnId, "turn-base");
  assert.equal(turn.errorMessage, "");
});

test("successful full and diff-cached turns remain usable scene context", () => {
  assert.equal(isSceneContextTurn({ sceneJson: '{"worldInfo":{}}' }), true);
  assert.equal(isSceneContextTurn({ sceneJson: null, commands: [{ op: "object.patch" }] }), true);
});

test("ThreeBox routes model-negotiated follow-ups to an existing scene", () => {
  const turns = [
    { id: "turn-base", sceneJson: "{}", mode: "generate" },
    { id: "turn-latest", commands: [{ op: "object.patch" }], mode: "adjust" }
  ];
  assert.deepEqual(
    resolveThreeBoxNegotiatedRoute(
      { intent: "adjust", targetTurnId: "turn-base", classificationFailed: false },
      turns
    ),
    { intent: "adjust", targetTurnId: "turn-base" }
  );
  assert.deepEqual(
    resolveThreeBoxNegotiatedRoute(
      { intent: "adjust", targetTurnId: null, classificationFailed: false },
      turns
    ),
    { intent: "adjust", targetTurnId: "turn-latest" }
  );
});

test("ThreeBox never silently converts a failed negotiation into a new scene", () => {
  assert.throws(
    () => resolveThreeBoxNegotiatedRoute(
      { intent: "generate", classificationFailed: true, note: "provider output was truncated" },
      [{ id: "turn-base", sceneJson: "{}", mode: "generate" }]
    ),
    (error) => error?.code === "THREEBOX_INTENT_CLASSIFICATION_FAILED"
  );
  assert.deepEqual(
    resolveThreeBoxNegotiatedRoute(
      { intent: "generate", classificationFailed: true },
      []
    ),
    { intent: "generate", targetTurnId: null }
  );
});
