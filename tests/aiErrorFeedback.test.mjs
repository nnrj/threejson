import assert from "node:assert/strict";
import { test } from "node:test";
import { getAiErrorFeedback } from "../tools/scene-host/shared/js/aiErrorFeedback.js";
import { loadHostLocaleCatalog } from "../tools/scene-host/shared/i18n/index.js";

test("AI error feedback classifies warnings and preserves only safe technical fields", async () => {
  await loadHostLocaleCatalog("en-US");
  const feedback = getAiErrorFeedback({
    code: "BUILTIN_SAFETY_WARNING",
    httpStatus: 422,
    providerError: {
      error: "SAFETY_POLICY_WARNING",
      message: "Prompt blocked for violating the safety policy.",
      safety_enforcement: { action: "warning", warning_count: 2 },
      matched_terms: ["must-not-leak"],
      threebox_moderation: { turn_id: "turn-safe-detail" }
    }
  });
  assert.equal(feedback.tone, "warning");
  assert.match(feedback.message, /2/);
  assert.match(feedback.detail, /HTTP 422/);
  assert.match(feedback.detail, /turn-safe-detail/);
  assert.doesNotMatch(feedback.detail, /must-not-leak/);
});

test("AI error feedback distinguishes immediate and permanent bans", () => {
  const immediate = getAiErrorFeedback({ code: "BUILTIN_DEVICE_BANNED" });
  const permanent = getAiErrorFeedback({ code: "BUILTIN_DEVICE_PERMANENTLY_BANNED" });
  assert.equal(immediate.tone, "banned");
  assert.equal(permanent.tone, "banned");
  assert.notEqual(immediate.message, permanent.message);
});

test("AI error feedback recovers a ban payload from a legacy classification wrapper", () => {
  const feedback = getAiErrorFeedback(new Error(
    'fallback: classification failed (AI request failed (403): {"error":"DEVICE_BANNED","message":"Prompt blocked.","matched_terms":["must-not-leak"]})'
  ));
  assert.equal(feedback.code, "DEVICE_BANNED");
  assert.equal(feedback.tone, "banned");
  assert.doesNotMatch(feedback.detail, /must-not-leak/);
});

test("AI error feedback gives unknown failures a friendly message", () => {
  const feedback = getAiErrorFeedback(new Error("low-level failure"));
  assert.equal(feedback.tone, "error");
  assert.ok(feedback.message);
  assert.match(feedback.detail, /low-level failure/);
});
