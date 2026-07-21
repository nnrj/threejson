import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAssetGatewayToPayload, resolveAssetUrl } from "../core/util/assetGateway.js";

test("asset gateway resolves static scene URLs without changing source input", () => {
  const payload = { objectList: [{ objType: "box", material: { textureUrl: "https://cdn.example/a.jpg" } }], audioUrl: "https://cdn.example/a.mp3" };
  applyAssetGatewayToPayload(payload, { baseUrl: "https://assets.example" });
  assert.match(payload.objectList[0].material.textureUrl, /^https:\/\/assets\.example\/v1\/assets\/proxy\?/);
  assert.equal(new URL(payload.objectList[0].material.textureUrl).searchParams.get("kind"), "image");
  assert.equal(new URL(payload.audioUrl).searchParams.get("kind"), "audio");
});

test("asset gateway supports a custom resolver and leaves local/data URLs alone", () => {
  const calls = [];
  const config = { resolveUrl: (url, context) => { calls.push(context.kind); return `proxy:${url}`; } };
  assert.equal(resolveAssetUrl("https://example.com/a.png", config, { kind: "image" }), "proxy:https://example.com/a.png");
  assert.equal(resolveAssetUrl("/assets/a.png", config, { kind: "image" }), "/assets/a.png");
  assert.deepEqual(calls, ["image"]);
});
