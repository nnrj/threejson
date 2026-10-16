import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeScenePayload, normalizeCanonicalObjectRecord } from "../core/handler/sceneFriendlyNormalizer.js";
import { normalizeSubSceneOnRecord } from "../core/handler/subSceneHierarchy.js";
import { arithmeticSurfaceExpressions } from "../core/handler/descriptorCompatibility.js";
import { evaluateNumericExpression } from "../core/util/numericExpression.js";

const film = JSON.parse(fs.readFileSync(new URL("./fixtures/media-export-relativity.json", import.meta.url), "utf8"));
test("reported nested photon becomes a real subScene descriptor without editing the source", () => {
  const before = structuredClone(film);
  for (const id of ["postulate", "dilation"]) {
    const normalized = normalizeScenePayload(film.scenes[id]).payload;
    const group = normalized.objectList.find(item => item.threeJsonId === (id === "dilation" ? "clockRest" : "frameA"));
    assert.ok(group.subScene.some(item => item.threeJsonId === (id === "dilation" ? "restPhoton" : "emitA")));
    assert.equal(group.children, undefined);
  }
  assert.deepEqual(film, before);
});
test("group alias handles recursion, canonical priority and ambiguous children safely", () => {
  const child = { objType: "sphere", threeJsonId: "ball" };
  const { record } = normalizeSubSceneOnRecord({ objType: "group", children: [{ objType: "group", children: [child] }], subScene: [] });
  assert.equal(record.subScene[0].subScene[0].threeJsonId, "ball");
  assert.deepEqual(normalizeSubSceneOnRecord({ objType: "group", children: [], subScene: [child] }).record.subScene[0].threeJsonId, "ball");
  assert.equal(normalizeSubSceneOnRecord({ objType: "group", children: [child], subScene: [child] }).record.subScene.length, 1);
  assert.throws(() => normalizeSubSceneOnRecord({ objType: "group", children: [child], subScene: [{ ...child, threeJsonId: "other" }] }), { code: "OBJECT_CHILDREN_CONFLICT" });
  assert.throws(() => normalizeSubSceneOnRecord({ objType: "group", children: [{ type: "Mesh" }] }), { code: "OBJECT_CHILDREN_INVALID" });
  for (const objType of ["native", "sdfmesh"]) {
    const source = { objType, children: [{ type: "Box" }], geometry: { children: ["CSG operands"] } };
    const output = normalizeSubSceneOnRecord(source).record;
    assert.deepEqual(output.children, source.children); assert.deepEqual(output.geometry, source.geometry);
  }
});
test("reported arithmetic surface translates to the same coordinates, with no JavaScript execution", () => {
  const normalized = normalizeScenePayload(film.scenes.curvature).payload;
  const geometry = normalized.objectList.find(item => item.threeJsonId === "spacetimeGrid").geometry;
  assert.equal(geometry.func, undefined);
  for (const [u, v] of [[0, 0], [.5, .5], [.23, .81], [1, 1]]) {
    const x = (u - .5) * 24, z = (v - .5) * 24;
    const result = Object.fromEntries(Object.entries(geometry.expressions).map(([key, expression]) => [key, evaluateNumericExpression(expression, { u, v })]));
    assert.equal(result.x, x); assert.equal(result.z, z);
    assert.equal(result.y, -6 / (Math.sqrt(x*x + z*z) + .001 + 1.6));
  }
});
test("surface alias supports alternate parameters and Math constants/functions, preserving canonical expressions", () => {
  const result = arithmeticSurfaceExpressions("(a,b)=>[a, Math.max(b, 0), Math.sin(a*Math.PI)]");
  assert.equal(evaluateNumericExpression(result.z, { u: .5, v: 0 }), 1);
  const geometry = { expressions: { x: "u", y: "v", z: "0" }, func: "unsafe ignored legacy metadata" };
  assert.deepEqual(normalizeSubSceneOnRecord({ objType: "parametricSurface", geometry }).record.geometry, geometry);
});
test("public single-record adaptation does not mutate a caller-owned geometry object", () => {
  const source = Object.freeze({objType:"parametricSurface",geometry:Object.freeze({func:"(u,v)=>[u,v,0]"})});
  const output = normalizeCanonicalObjectRecord(source);
  assert.ok(output.geometry.expressions); assert.equal(output.geometry.func,undefined);
  assert.equal(source.geometry.func,"(u,v)=>[u,v,0]");assert.equal(source.geometry.expressions,undefined);
});
test("unsafe, ambiguous and exponentially expanded func bodies are rejected, never evaluated", () => {
  for (const body of [
    "(u,v)=>{globalThis.__surfaceExecuted=true;return [u,v,0];}",
    "(u,v)=>[fetch('https://example.com'),v,0]", "(u,v)=>[Math.random(),v,0]",
    "(u,v)=>{const x=u;const x=v;return [x,v,0];}", "(u,v)=>{while(true){}return[u,v,0];}",
    "(u,v)=>[u.constructor(),v,0]", "(u,v)=>[u^2,v,0]", "(u,v)=>[unknown,v,0]",
    "(u,v)=>[u,v,0];fetch(u)", "(u,v)=>{const x=u;return[x, v, 0];throw Error();}",
    `(u,v)=>{${Array.from({length:20},(_,i)=>`const a${i}=${i ? `a${i-1}+a${i-1}` : "u"};`).join("")}return[a19,v,0];}`
  ]) assert.throws(() => arithmeticSurfaceExpressions(body), undefined, body);
  assert.equal(globalThis.__surfaceExecuted, undefined);
});
