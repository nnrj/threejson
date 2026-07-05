import assert from "node:assert/strict";
import { test } from "node:test";

import { configureLogger, isDebugEnabled, log } from "../core/util/logger.js";

test("configureLogger toggles debug level", () => {
  configureLogger({ level: "warn" });
  assert.equal(isDebugEnabled(), false);
  configureLogger({ debug: true });
  assert.equal(isDebugEnabled(), true);
  configureLogger({ level: "warn" });
  assert.equal(isDebugEnabled(), false);
});

test("log.debug is silent when level is warn", () => {
  configureLogger({ level: "warn" });
  let called = false;
  const prev = console.debug;
  console.debug = () => {
    called = true;
  };
  try {
    log.debug("should not print");
    assert.equal(called, false);
  } finally {
    console.debug = prev;
    configureLogger({ level: "warn" });
  }
});
