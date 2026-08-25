import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  applyTextureAssignmentAsync,
  listMaterialTextureSlots,
  planSceneTextures,
  runSceneTexturePipeline,
  TextureAcquisitionProvider
} from "../core/texture/index.js";
import { attachRuntimeContext, createRuntimeContext } from "../core/runtime/runtimeContext.js";
import { registerObject } from "../core/handler/objectRegistry.js";
import { registerAssetLibrary } from "../core/cache/assetRegistry.js";

function sceneFixture() {
  return {
    threeJsonId: "texture-scene",
    objectList: [
      {
        threeJsonId: "box-1",
        name: "wooden table",
        objType: "box",
        material: { type: "standard", color: "#8b5a2b" },
        holes: [{
          threeJsonId: "hole-1",
          name: "metal inset",
          material: { type: "standard", color: "#888888" }
        }]
      },
      {
        threeJsonId: "multi-1",
        objType: "box",
        materialArr: [
          { color: "#ffffff" },
          { textureUrl: "https://example.test/existing.png", normalMap: "https://example.test/normal.png" }
        ]
      }
    ]
  };
}

test("listMaterialTextureSlots scans PBR slots and materialArr, but not discarded CSG operand materials", () => {
  const slots = listMaterialTextureSlots(sceneFixture());
  const names = new Set(slots.map((slot) => slot.slot));
  assert.deepEqual(names, new Set([
    "baseColor", "normal", "roughness", "metalness", "ao",
    "emissive", "opacity", "bump", "displacement", "clearcoat", "clearcoatRoughness",
    "clearcoatNormal", "transmission", "thickness", "sheenColor", "sheenRoughness",
    "specularColor", "specularIntensity", "anisotropy", "iridescence", "iridescenceThickness"
  ]));
  assert.equal(slots.some((slot) => slot.materialPointer === "/objectList/0/material"), true);
  assert.equal(slots.some((slot) => slot.materialPointer === "/objectList/0/holes/0/material"), false);
  assert.equal(slots.some((slot) => slot.materialPointer === "/objectList/1/materialArr/1"), true);
  assert.equal(
    slots.find((slot) => slot.materialPointer === "/objectList/1/materialArr/1" && slot.slot === "baseColor")?.currentUrl,
    "https://example.test/existing.png"
  );
});

test("listMaterialTextureSlots preserves the standard map string alias", () => {
  const scene = {
    objectList: [{
      threeJsonId: "map-alias-box",
      material: { type: "standard", map: "https://example.test/map-alias.png" }
    }]
  };
  const baseColor = listMaterialTextureSlots(scene).find((entry) => entry.slot === "baseColor");
  assert.equal(baseColor.currentUrl, "https://example.test/map-alias.png");
  assert.equal(baseColor.descriptorField, "map");
  assert.equal(baseColor.valuePointer, "/objectList/0/material/map");
});

test("planSceneTextures calls the planner once, rejects fabricated URLs and preserves populated slots", async () => {
  let calls = 0;
  const result = await planSceneTextures(sceneFixture(), "make the table realistic", {
    planner: async ({ materials }) => {
      calls += 1;
      const table = materials.find((material) => material.threeJsonId === "box-1");
      const populated = materials.find((material) => material.materialPointer === "/objectList/1/materialArr/1");
      return {
        tasks: [
          { materialPointer: table.materialPointer, slots: ["baseColor", "normal", "roughness"], query: "aged oak wood", sourcePreference: "pbr-library" },
          { materialPointer: populated.materialPointer, slots: ["baseColor"], query: "painted panel" },
          { materialPointer: table.materialPointer, slots: ["baseColor"], query: "https://untrusted.test/fabricated.jpg" }
        ]
      };
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.tasks[0].slots, ["baseColor", "normal", "roughness"]);
  assert.equal(JSON.stringify(result.tasks).includes("untrusted.test"), false);
});

test("runSceneTexturePipeline applies a bundled semantic manifest without a configured network adapter", async () => {
  const scene = sceneFixture();
  let searches = 0;
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: [], generate: [], persist: [] }),
    search: async () => { searches += 1; return { candidates: [] }; }
  });
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: {
      tasks: [{
        id: "wood",
        materialPointer: "/objectList/0/material",
        relativeMaterialPointer: "/material",
        objectPointer: "/objectList/0",
        threeJsonId: "box-1",
        objectName: "wooden table",
        slots: ["baseColor"],
        query: "oak wood table",
        sourcePreference: "auto",
        projection: "uv",
        tileable: true
      }]
    },
    manifest: [{
      id: "oak",
      name: "Oak wood",
      keywords: ["oak", "wood", "table"],
      maps: { baseColor: "lib://oak-color" },
      license: { status: "known", id: "MIT" }
    }]
  });
  assert.equal(searches, 0);
  assert.equal(result.assignments.length, 1);
  assert.equal(scene.objectList[0].material.textureUrl, "lib://oak-color");
});

test("bundled manifest assets do not depend on service persistence", async () => {
  const scene = sceneFixture();
  let persists = 0;
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: [], generate: [], persist: ["remote"] }),
    persist: async () => {
      persists += 1;
      throw new Error("service must not receive bundled assets");
    }
  });
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: { tasks: [{
      id: "bundled", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor"],
      query: "oak wood", sourcePreference: "auto", projection: "uv", tileable: true
    }] },
    manifest: [{
      id: "oak", name: "Oak wood", keywords: ["oak", "wood"],
      maps: { baseColor: "lib://oak-color" }, license: { status: "known", id: "MIT" }
    }]
  });
  assert.equal(persists, 0);
  assert.equal(result.assignments.length, 1);
});

test("manifest-only strategy never falls through to a network search", async () => {
  let searches = 0;
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async () => { searches += 1; return { candidates: [] }; }
  });
  const result = await runSceneTexturePipeline(sceneFixture(), {
    textureProvider: provider,
    plan: { tasks: [{
      id: "missing", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor", "normal"],
      query: "oak wood", sourcePreference: "manifest", projection: "uv", tileable: true
    }] },
    manifest: [{
      id: "partial-oak", name: "Oak wood", keywords: ["oak", "wood"],
      maps: { baseColor: "lib://oak-color" }, license: { status: "known", id: "MIT" }
    }]
  });
  assert.equal(searches, 0);
  assert.equal(result.assignments.length, 0);
  assert.equal(result.taskResults[0]?.skipped, "no_candidate");
});

test("persistence failure falls back to the authoritative source URL", async () => {
  const scene = sceneFixture();
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: ["remote"] }),
    search: async () => ({ candidates: [{
      source: "custom-search",
      maps: { baseColor: "https://images.test/wood.jpg" },
      license: { status: "known", id: "CC0" }
    }] }),
    persist: async () => { throw new Error("archive unavailable"); }
  });
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: { tasks: [{
      id: "remote", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor"],
      query: "wood", sourcePreference: "search", projection: "uv", tileable: false
    }] }
  });
  assert.equal(result.assignments.length, 1);
  assert.match(result.taskResults[0]?.persistWarning || "", /archive unavailable/);
  assert.equal(scene.objectList[0].material.textureUrl, "https://images.test/wood.jpg");
});

test("unknown-license candidates remain pending and are never auto-applied by default", async () => {
  const scene = sceneFixture();
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async () => ({ candidates: [{
      id: "unknown",
      maps: { baseColor: "https://images.test/unknown.jpg" },
      license: { status: "unknown" }
    }] })
  });
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: { tasks: [{
      id: "unknown-task", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor"], query: "wood",
      sourcePreference: "search", projection: "uv", tileable: false
    }] }
  });
  assert.equal(result.assignments.length, 0);
  assert.equal(result.pendingLicense.length, 1);
  assert.equal(scene.objectList[0].material.textureUrl, undefined);
});

test("a license status without concrete metadata still requires confirmation", async () => {
  const scene = sceneFixture();
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async () => ({ candidates: [{
      id: "bare-status",
      maps: { baseColor: "https://images.test/bare-status.jpg" },
      license: { status: "known" }
    }] })
  });
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: { tasks: [{
      id: "bare-status-task", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor"], query: "wood",
      sourcePreference: "search", projection: "uv", tileable: false
    }] }
  });
  assert.equal(result.assignments.length, 0);
  assert.equal(result.pendingLicense.length, 1);
});

test("plain image generation cannot smuggle non-color maps into an assignment", async () => {
  const scene = sceneFixture();
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: [], generate: ["image"], persist: [] }),
    generate: async () => ({ candidates: [{
      maps: {
        baseColor: "https://images.test/color.png",
        normal: "https://images.test/not-a-real-normal.png"
      },
      license: { status: "known", id: "provider-output" }
    }] })
  });
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: { tasks: [{
      id: "plain-image", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor", "normal"],
      query: "custom painted wood", sourcePreference: "generate", generationKind: "image",
      projection: "uv", tileable: false
    }] }
  });
  assert.deepEqual(result.assignments[0]?.maps, { baseColor: "https://images.test/color.png" });
  assert.equal(scene.objectList[0].material.normalMap, undefined);
});

test("PBR generation is selected only when the provider explicitly declares it", async () => {
  const scene = sceneFixture();
  let requestedKind = null;
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: [], generate: ["image", "pbr-set"], pbr: ["pbr-set"], persist: [] }),
    generate: async ({ kind }) => {
      requestedKind = kind;
      return { candidates: [{
        maps: { baseColor: "color", normal: "normal", roughness: "roughness" },
        license: { status: "known", id: "generated" }
      }] };
    }
  });
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: { tasks: [{
      id: "pbr", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor", "normal", "roughness"],
      query: "custom PBR surface", sourcePreference: "generate", projection: "uv", tileable: false
    }] }
  });
  assert.equal(requestedKind, "pbr-set");
  assert.deepEqual(result.assignments[0]?.maps, { baseColor: "color", normal: "normal", roughness: "roughness" });
  assert.equal(scene.objectList[0].material.type, "standard");
});

test("descriptor-only PBR and opacity assignments persist material semantics in the authoritative scene", async () => {
  const scene = sceneFixture();
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["pbr-set"], generate: [], persist: [] }),
    search: async () => ({ candidates: [{
      maps: { roughness: "rough", opacity: "alpha" },
      license: { status: "known", id: "CC0" }
    }] })
  });
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: { tasks: [{
      id: "pbr-semantics", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["roughness", "opacity"],
      query: "translucent rough surface", sourcePreference: "search", projection: "uv", tileable: false
    }] }
  });
  assert.equal(result.assignments.length, 1);
  assert.equal(scene.objectList[0].material.type, "standard");
  assert.equal(scene.objectList[0].material.transparent, true);
  assert.equal(scene.objectList[0].material.roughnessMap, "rough");
  assert.equal(scene.objectList[0].material.alphaMap, "alpha");
});

test("one acquisition failure does not prevent another material assignment", async () => {
  const scene = sceneFixture();
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async ({ query }) => {
      if (query === "broken") throw new Error("provider failed for this slot");
      return { candidates: [{ maps: { baseColor: "https://images.test/good.jpg" }, license: { status: "known", id: "CC0" } }] };
    }
  });
  const common = { slots: ["baseColor"], sourcePreference: "search", projection: "uv", tileable: false };
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    concurrency: 2,
    textureProvider: provider,
    plan: { tasks: [
      { ...common, id: "bad", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material", objectPointer: "/objectList/0", threeJsonId: "box-1", query: "broken" },
      { ...common, id: "good", materialPointer: "/objectList/1/materialArr/0", relativeMaterialPointer: "/materialArr/0", objectPointer: "/objectList/1", threeJsonId: "multi-1", query: "working" }
    ] }
  });
  assert.equal(result.taskResults.filter((entry) => entry.ok).length, 1);
  assert.equal(result.taskResults.filter((entry) => entry.error).length, 1);
  assert.equal(scene.objectList[1].materialArr[0].textureUrl, "https://images.test/good.jpg");
});

test("tasks for one material are serialized while different materials remain parallelizable", async () => {
  const scene = sceneFixture();
  let activeForTable = 0;
  let maxActiveForTable = 0;
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async ({ query }) => {
      if (query.startsWith("table")) {
        activeForTable += 1;
        maxActiveForTable = Math.max(maxActiveForTable, activeForTable);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeForTable -= 1;
      }
      const slot = query.endsWith("normal") ? "normal" : "baseColor";
      return { candidates: [{
        maps: { [slot]: `https://images.test/${query}.png` },
        license: { status: "known", id: "CC0" }
      }] };
    }
  });
  const common = {
    materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
    objectPointer: "/objectList/0", threeJsonId: "box-1",
    sourcePreference: "search", projection: "uv", tileable: false
  };
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    concurrency: 3,
    textureProvider: provider,
    plan: { tasks: [
      { ...common, id: "table-color", slots: ["baseColor"], query: "table-color" },
      { ...common, id: "table-normal", slots: ["normal"], query: "table-normal" }
    ] }
  });
  assert.equal(maxActiveForTable, 1);
  assert.equal(result.assignments.length, 2);
  assert.equal(scene.objectList[0].material.textureUrl, "https://images.test/table-color.png");
  assert.equal(scene.objectList[0].material.normalMap, "https://images.test/table-normal.png");
});

test("a later task does not overwrite a slot just committed by an earlier task for the same material", async () => {
  const scene = sceneFixture();
  let searches = 0;
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async ({ query }) => {
      searches += 1;
      return { candidates: [{
        maps: { baseColor: `https://images.test/${query}.png` },
        license: { status: "known", id: "CC0" }
      }] };
    }
  });
  const common = {
    materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
    objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor"],
    sourcePreference: "search", projection: "uv", tileable: false
  };
  const result = await runSceneTexturePipeline(scene, {
    mutate: true,
    textureProvider: provider,
    plan: { tasks: [
      { ...common, id: "first", query: "first" },
      { ...common, id: "second", query: "second" }
    ] }
  });
  assert.equal(searches, 2);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.taskResults[1]?.skipped, "candidate_has_no_requested_maps");
  assert.equal(scene.objectList[0].material.textureUrl, "https://images.test/first.png");
});

test("a runtime preload failure does not mutate the authoritative scene document", async () => {
  const sceneDocument = {
    objectList: [{
      threeJsonId: "pipeline-atomic-box",
      objType: "box",
      material: { type: "standard", color: "#ffffff" }
    }]
  };
  const runtimeDescriptor = structuredClone(sceneDocument.objectList[0]);
  const runtimeScene = new THREE.Scene();
  const context = createRuntimeContext();
  attachRuntimeContext(runtimeScene, context);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  runtimeScene.add(mesh);
  registerObject(mesh, runtimeDescriptor, { recursive: false, runtimeScope: runtimeScene });
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async () => ({ candidates: [{
      maps: { baseColor: "https://images.test/unloadable.png" },
      license: { status: "known", id: "CC0" }
    }] })
  });
  const result = await runSceneTexturePipeline(sceneDocument, {
    mutate: true,
    runtime: runtimeScene,
    textureProvider: provider,
    loadTexture: async () => { throw new Error("preload failed"); },
    plan: { tasks: [{
      id: "atomic", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "pipeline-atomic-box", slots: ["baseColor"],
      query: "painted surface", sourcePreference: "search", projection: "uv", tileable: false
    }] }
  });
  assert.equal(result.assignments.length, 0);
  assert.match(result.taskResults[0]?.error || "", /preload failed/);
  assert.equal(sceneDocument.objectList[0].material.textureUrl, undefined);
  assert.equal(runtimeDescriptor.material.textureUrl, undefined);
  assert.equal(mesh.material.map, null);
  context.dispose();
});

test("expired scene revisions are skipped before texture acquisition", async () => {
  let searches = 0;
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async () => { searches += 1; return { candidates: [] }; }
  });
  const result = await runSceneTexturePipeline(sceneFixture(), {
    textureProvider: provider,
    revision: 17,
    isCurrent: () => false,
    plan: { tasks: [{
      id: "stale", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
      objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor"], query: "wood",
      sourcePreference: "search", projection: "uv", tileable: false
    }] }
  });
  assert.equal(searches, 0);
  assert.equal(result.taskResults[0]?.skipped, "stale");
});

test("an aborted texture run rejects promptly instead of committing a partial result", async () => {
  const controller = new AbortController();
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["image"], generate: [], persist: [] }),
    search: async (_request, { signal }) => {
      controller.abort(new DOMException("cancelled", "AbortError"));
      throw signal.reason;
    }
  });
  const scene = sceneFixture();
  await assert.rejects(
    runSceneTexturePipeline(scene, {
      mutate: true,
      signal: controller.signal,
      textureProvider: provider,
      plan: { tasks: [{
        id: "cancel", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material",
        objectPointer: "/objectList/0", threeJsonId: "box-1", slots: ["baseColor"], query: "wood",
        sourcePreference: "search", projection: "uv", tileable: false
      }] }
    }),
    { name: "AbortError" }
  );
  assert.equal(scene.objectList[0].material.textureUrl, undefined);
});

test("applyTextureAssignmentAsync preloads the full PBR set before atomically committing", async () => {
  const descriptor = {
    threeJsonId: "runtime-box",
    objType: "box",
    material: { type: "basic", color: "#ffffff" }
  };
  const scene = new THREE.Scene();
  const context = createRuntimeContext();
  attachRuntimeContext(scene, context);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
  scene.add(mesh);
  registerObject(mesh, descriptor, { recursive: false, runtimeScope: scene });
  const assignment = {
    threeJsonId: "runtime-box",
    relativeMaterialPointer: "/material",
    maps: { baseColor: "https://images.test/color.png", normal: "https://images.test/normal.png", roughness: "https://images.test/rough.png" }
  };
  const loaded = [];
  await applyTextureAssignmentAsync(scene, assignment, {
    loadTexture: async (url) => {
      loaded.push(url);
      return new THREE.Texture();
    }
  });
  assert.equal(loaded.length, 3);
  assert.equal(descriptor.material.type, "standard");
  assert.equal(descriptor.material.textureUrl, assignment.maps.baseColor);
  assert.equal(descriptor.material.normalMap, assignment.maps.normal);
  assert.equal(mesh.material.isMeshStandardMaterial, true);
  assert.equal(mesh.material.map?.isTexture, true);
  assert.equal(mesh.material.normalMap?.isTexture, true);
  context.dispose();
});

test("applyTextureAssignmentAsync leaves descriptor and runtime untouched when preload fails", async () => {
  const descriptor = { threeJsonId: "atomic-box", objType: "box", material: { type: "basic", color: "#123456" } };
  const scene = new THREE.Scene();
  const context = createRuntimeContext();
  attachRuntimeContext(scene, context);
  const originalMaterial = new THREE.MeshBasicMaterial({ color: "#123456" });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), originalMaterial);
  scene.add(mesh);
  registerObject(mesh, descriptor, { recursive: false, runtimeScope: scene });
  await assert.rejects(
    applyTextureAssignmentAsync(scene, {
      threeJsonId: "atomic-box",
      relativeMaterialPointer: "/material",
      maps: { baseColor: "good", normal: "bad" }
    }, {
      loadTexture: async (url) => {
        if (url === "bad") throw new Error("preload failed");
        return new THREE.Texture();
      }
    }),
    /preload failed/
  );
  assert.equal(descriptor.material.textureUrl, undefined);
  assert.equal(descriptor.material.normalMap, undefined);
  assert.equal(mesh.material, originalMaterial);
  assert.equal(mesh.material.map, null);
  context.dispose();
});

test("applyTextureAssignmentAsync handles a descriptor face whose identical materials collapsed at runtime", async () => {
  const descriptor = {
    threeJsonId: "uniform-face-box",
    objType: "box",
    materials: Array.from({ length: 6 }, () => ({ type: "standard", color: "#ffffff" }))
  };
  const scene = new THREE.Scene();
  const context = createRuntimeContext();
  attachRuntimeContext(scene, context);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  scene.add(mesh);
  registerObject(mesh, descriptor, { recursive: false, runtimeScope: scene });
  await applyTextureAssignmentAsync(scene, {
    threeJsonId: "uniform-face-box",
    relativeMaterialPointer: "/materials/3",
    maps: { baseColor: "https://images.test/face.png" }
  }, { loadTexture: async () => new THREE.Texture() });
  assert.equal(mesh.material.map?.isTexture, true);
  assert.equal(descriptor.materials[3].textureUrl, "https://images.test/face.png");
  context.dispose();
});

test("applyTextureAssignmentAsync commits to an existing map alias instead of creating a competing field", async () => {
  const descriptor = {
    threeJsonId: "map-alias-runtime-box",
    objType: "box",
    material: { type: "standard", map: "https://images.test/old.png" }
  };
  const scene = new THREE.Scene();
  const context = createRuntimeContext();
  attachRuntimeContext(scene, context);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  scene.add(mesh);
  registerObject(mesh, descriptor, { recursive: false, runtimeScope: scene });
  await applyTextureAssignmentAsync(scene, {
    threeJsonId: "map-alias-runtime-box",
    relativeMaterialPointer: "/material",
    maps: { baseColor: "https://images.test/new.png" },
    slotRecords: { baseColor: { descriptorField: "map" } }
  }, { loadTexture: async () => new THREE.Texture() });
  assert.equal(descriptor.material.map, "https://images.test/new.png");
  assert.equal(descriptor.material.textureUrl, undefined);
  context.dispose();
});

test("applyTextureAssignmentAsync resolves lib references through the runtime asset library", async () => {
  const descriptor = {
    threeJsonId: "library-runtime-box",
    objType: "box",
    material: { type: "standard", color: "#ffffff" }
  };
  const scene = new THREE.Scene();
  const context = createRuntimeContext();
  attachRuntimeContext(scene, context);
  registerAssetLibrary([{
    threeJsonId: "oak-color",
    assetKind: "texture",
    url: "https://assets.test/oak-color.jpg"
  }], context);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  scene.add(mesh);
  registerObject(mesh, descriptor, { recursive: false, runtimeScope: scene });
  const loadedUrls = [];
  const loader = {
    load(url, onLoad) {
      loadedUrls.push(url);
      const texture = new THREE.Texture();
      queueMicrotask(() => onLoad(texture));
      return texture;
    }
  };
  await applyTextureAssignmentAsync(scene, {
    threeJsonId: "library-runtime-box",
    relativeMaterialPointer: "/material",
    maps: { baseColor: "lib://oak-color" }
  }, { loader });
  assert.deepEqual(loadedUrls, ["https://assets.test/oak-color.jpg"]);
  assert.equal(descriptor.material.textureUrl, "lib://oak-color");
  context.dispose();
});

test("opacity maps enable transparency and non-color PBR maps promote a basic material", async () => {
  const descriptor = {
    threeJsonId: "pbr-promotion-box",
    objType: "box",
    material: { type: "basic", color: "#ffffff", transparent: false }
  };
  const scene = new THREE.Scene();
  const context = createRuntimeContext();
  attachRuntimeContext(scene, context);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  scene.add(mesh);
  registerObject(mesh, descriptor, { recursive: false, runtimeScope: scene });
  await applyTextureAssignmentAsync(scene, {
    threeJsonId: "pbr-promotion-box",
    relativeMaterialPointer: "/material",
    maps: { emissive: "emissive", opacity: "opacity" }
  }, { loadTexture: async () => new THREE.Texture() });
  assert.equal(mesh.material.isMeshStandardMaterial, true);
  assert.equal(mesh.material.transparent, true);
  assert.equal(descriptor.material.type, "standard");
  assert.equal(descriptor.material.transparent, true);
  context.dispose();
});
