import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getDomain,
  initBusinessDomains,
  registerDomain,
  businessDomains,
  isDomainDeployable,
  isDomainDispatchable
} from "../core/handler/businessDomainRegistry.js";
import { getLeafDomainSegment } from "../core/handler/domainId.js";
import { applyDomainModelList } from "../core/handler/businessDomainModelDispatch.js";

function makeLeafDomain(id, leaf) {
  const cap = leaf.charAt(0).toUpperCase() + leaf.slice(1);
  return {
    id,
    defaultHandler: leaf,
    resolveDomainModel(record, scene) {
      scene.userData.lastDeploy = { id, handler: record.handler ?? leaf };
    },
    api: {
      [`create${cap}`]: () => ({}),
      [`deploy${cap}`]: (record, scene) => {
        scene.userData.lastDeploy = { id, record };
      }
    }
  };
}

test("getDomain rejects bare child id", () => {
  initBusinessDomains([]);
  registerDomain(makeLeafDomain("demo.parent", "parent"));
  assert.equal(getDomain("parent"), null);
  assert.ok(getDomain("demo.parent"));
});

test("businessDomains supports chained and bracket qualified access", () => {
  initBusinessDomains([]);
  registerDomain({
    id: "nav.root",
    defaultHandler: "root",
    resolveDomainModel() {},
    api: { createRoot: () => ({}), deployRoot: () => {} }
  });
  registerDomain(makeLeafDomain("nav.root.child", "child"));

  assert.equal(typeof businessDomains.nav.root.child.deployChild, "function");
  assert.equal(typeof businessDomains["nav.root.child"].deployChild, "function");
});

test("api keys take priority over child segment navigation", () => {
  initBusinessDomains([]);
  registerDomain({
    id: "mix.root",
    defaultHandler: "root",
    resolveDomainModel() {},
    api: {
      createRoot: () => ({}),
      deployRoot: () => {},
      child: () => "api-child"
    }
  });
  registerDomain(makeLeafDomain("mix.root.child", "child"));

  assert.equal(businessDomains.mix.root.child(), "api-child");
  assert.equal(typeof businessDomains.mix.root.child.deployChild, "undefined");
});

test("namespace-only descriptor warns and is not dispatchable", () => {
  initBusinessDomains([]);
  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args.join(" "));

  try {
    registerDomain({
      id: "ns.only",
      api: {}
    });
    assert.equal(isDomainDeployable(getDomain("ns.only")), false);
    assert.equal(isDomainDispatchable(getDomain("ns.only")), false);

    const scene = { userData: {} };
    applyDomainModelList(scene, [{ objType: "domain", domain: "ns.only" }]);
    assert.match(warnCalls.join("\n"), /not dispatchable/);
  } finally {
    console.warn = originalWarn;
  }
});

test("leaf api naming uses last segment only", () => {
  const leaf = getLeafDomainSegment("weather.rain");
  assert.equal(leaf, "rain");
  const descriptor = makeLeafDomain("weather.rain", leaf);
  assert.equal(typeof descriptor.api.createRain, "function");
  assert.equal(typeof descriptor.api.deployRain, "function");
});

test("registered namespace middle node is not dispatchable but navigable", () => {
  initBusinessDomains([]);
  registerDomain({
    id: "mid.root",
    defaultHandler: "root",
    resolveDomainModel() {},
    api: { createRoot: () => ({}), deployRoot: () => {} }
  });
  registerDomain({
    id: "mid.root.ns",
    peerDomains: ["mid.root"],
    api: {}
  });
  registerDomain(makeLeafDomain("mid.root.ns.child", "child"));

  assert.equal(isDomainDispatchable(getDomain("mid.root.ns")), false);
  assert.equal(typeof businessDomains.mid.root.ns.child.deployChild, "function");
  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args.join(" "));
  try {
    applyDomainModelList(
      { userData: {} },
      [{ objType: "domain", domain: "mid.root.ns" }]
    );
    assert.match(warnCalls.join("\n"), /not dispatchable/);
  } finally {
    console.warn = originalWarn;
  }
});
