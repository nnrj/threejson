import { test } from "node:test";
import assert from "node:assert/strict";

import { generatedBusinessDomainDescriptors } from "../builtins/builtinDomainManifest.generated.js";
import { userDomainDescriptors } from "../builtins/userDomainDescriptors.js";
import {
  isDomainDeployable,
  isDomainDispatchable,
  validateDomainDescriptor
} from "../core/handler/businessDomainRegistry.js";
import { getLeafDomainSegment } from "../core/handler/domainId.js";

function toPascalCase(value) {
  return String(value || "")
    .replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_m, _sep, ch) => ch.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

function collectDescriptors() {
  const byId = new Map();
  for (const d of generatedBusinessDomainDescriptors) {
    byId.set(d.id, d);
  }
  for (const d of userDomainDescriptors) {
    byId.set(d.id, d);
  }
  return [...byId.values()];
}

test("builtin + user domain descriptors pass validateDomainDescriptor", () => {
  const list = collectDescriptors();
  assert.ok(list.length >= 10, "expected at least 10 built-in domains");
  for (const descriptor of list) {
    assert.doesNotThrow(() => validateDomainDescriptor(descriptor), descriptor.id);
  }
});

test("each deployable domain api exposes create/deploy named from leaf segment", () => {
  for (const descriptor of collectDescriptors()) {
    if (!isDomainDeployable(descriptor)) {
      continue;
    }
    const capLeaf = toPascalCase(getLeafDomainSegment(descriptor.id));
    assert.equal(typeof descriptor.api[`create${capLeaf}`], "function", descriptor.id);
    assert.equal(typeof descriptor.api[`deploy${capLeaf}`], "function", descriptor.id);
  }
});

test("each dispatchable domain has resolveDomainModel or domainHandlers", () => {
  for (const descriptor of collectDescriptors()) {
    if (!isDomainDispatchable(descriptor)) {
      continue;
    }
    const hasResolve = typeof descriptor.resolveDomainModel === "function";
    const hasHandlers =
      descriptor.domainHandlers && typeof descriptor.domainHandlers === "object";
    assert.ok(hasResolve || hasHandlers, `${descriptor.id} lacks dispatch entry`);
  }
});
