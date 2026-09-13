import test from "node:test";
import { syncHostSessionModules } from "../tools/dev/syncHostSessionModules.mjs";
test("native and published host sessions share the exact implementation without runtime reverse dependencies", () => syncHostSessionModules({ check: true }));
