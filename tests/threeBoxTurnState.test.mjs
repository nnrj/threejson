import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createUnsuccessfulTurnRecord,
  isSceneContextTurn,
  isUnsuccessfulTurn
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
