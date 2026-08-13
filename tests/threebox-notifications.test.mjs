import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNotificationChannels,
  selectNewestPopupNotification
} from "../tools/scene-host/threebox/js/threeBoxBuiltinNotifications.js";

test("notification channels accept server arrays and historical JSON strings", () => {
  assert.deepEqual(normalizeNotificationChannels(["builtin", "modal"]), ["builtin", "modal"]);
  assert.deepEqual(normalizeNotificationChannels('["builtin"]'), ["builtin"]);
  assert.deepEqual(normalizeNotificationChannels("not-json"), []);
});

test("only the newest unread modal notification is selected for popup", () => {
  const notifications = [
    { id: "old-modal", channels: ["builtin", "modal"], created_at: 10, read: 0 },
    { id: "new-inbox", channels: ["builtin"], created_at: 30, read: 0 },
    { id: "new-modal", channels: ["builtin", "modal"], created_at: 20, read: 0 },
    { id: "read-modal", channels: ["builtin", "modal"], created_at: 40, read: 1 }
  ];
  assert.equal(selectNewestPopupNotification(notifications)?.id, "new-modal");
  assert.equal(selectNewestPopupNotification(notifications, new Set(["new-modal"]))?.id, "old-modal");
  assert.equal(selectNewestPopupNotification(notifications, new Set(["new-modal", "old-modal"])), null);
});
