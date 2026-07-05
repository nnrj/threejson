import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

if (typeof globalThis.FileReader === "undefined" && typeof globalThis.Blob !== "undefined") {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onloadend = null;
      this.onerror = null;
    }

    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          if (typeof this.onload === "function") {
            this.onload({ target: this });
          }
          if (typeof this.onloadend === "function") {
            this.onloadend({ target: this });
          }
        })
        .catch((error) => {
          if (typeof this.onerror === "function") {
            this.onerror(error);
          }
        });
    }

    readAsDataURL(blob) {
      blob.arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]);
          }
          this.result = `data:application/octet-stream;base64,${Buffer.from(binary, "binary").toString("base64")}`;
          if (typeof this.onload === "function") {
            this.onload({ target: this });
          }
          if (typeof this.onloadend === "function") {
            this.onloadend({ target: this });
          }
        })
        .catch((error) => {
          if (typeof this.onerror === "function") {
            this.onerror(error);
          }
        });
    }
  };
}

import {
  exportMesh,
  exportMeshObject,
  normalizeMeshFormat
} from "../core/handler/meshExportHandler.js";
import { prepareMeshExportRoot } from "../core/util/meshExportPrepare.js";
import { shouldSkipSceneExportNode } from "../core/util/sceneExportNode.js";

function makeSceneWithBox(threeJsonId = "box-1") {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  mesh.userData.objJson = {
    objType: "box",
    name: "export-box",
    threeJsonId,
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#ff0000" }
  };
  scene.add(mesh);
  return { scene, mesh };
}

test("normalizeMeshFormat accepts glb and rejects unknown", () => {
  assert.equal(normalizeMeshFormat("GLB"), "glb");
  assert.throws(() => normalizeMeshFormat("dae"), /E_MESH_EXPORT_FORMAT_INVALID/);
});

test("prepareMeshExportRoot scene scope skips runtime-only top-level nodes", () => {
  const { scene } = makeSceneWithBox();
  const helper = new THREE.AxesHelper(2);
  helper.userData.objJson = { objType: "axesHelper", name: "axes" };
  scene.add(helper);

  const prepared = prepareMeshExportRoot(scene, { scope: "scene", shouldSkipObject: shouldSkipSceneExportNode });
  assert.equal(prepared.stats.meshCount, 1);
  assert.ok(prepared.warnings.some((w) => w.code === "skipped_nodes"));
});

test("prepareMeshExportRoot selection scope clones subtree only", () => {
  const { scene, mesh } = makeSceneWithBox("main");
  const other = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshBasicMaterial()
  );
  other.userData.objJson = { objType: "box", name: "other", threeJsonId: "other" };
  scene.add(other);

  const prepared = prepareMeshExportRoot(scene, {
    scope: "selection",
    selectedObject3D: mesh
  });
  assert.equal(prepared.stats.meshCount, 1);
  assert.equal(prepared.exportRoot.children.length, 0);
  assert.equal(prepared.exportRoot.isMesh, true);
});

test("exportMesh produces non-empty GLB for simple box", async () => {
  const { scene } = makeSceneWithBox();
  const result = await exportMesh(scene, { format: "glb", scope: "scene" });
  assert.equal(result.format, "glb");
  assert.equal(result.extension, "glb");
  assert.ok(result.data instanceof ArrayBuffer);
  assert.ok(result.data.byteLength > 20);
  assert.ok(result.stats.meshCount >= 1);
});

test("exportMesh GLTF returns JSON string by default", async () => {
  const { scene } = makeSceneWithBox();
  const result = await exportMesh(scene, { format: "gltf", scope: "scene" });
  assert.equal(result.format, "gltf");
  assert.equal(typeof result.data, "string");
  const parsed = JSON.parse(result.data);
  assert.ok(parsed.asset || parsed.scenes || parsed.nodes);
});

test("exportMesh OBJ returns ascii string", async () => {
  const { scene } = makeSceneWithBox();
  const result = await exportMesh(scene, {
    format: "obj",
    scope: "scene",
    outputType: "string"
  });
  assert.equal(typeof result.data, "string");
  assert.ok(result.data.includes("v "));
});

test("exportMesh STL binary returns ArrayBuffer", async () => {
  const { scene } = makeSceneWithBox();
  const result = await exportMesh(scene, { format: "stl", scope: "scene" });
  assert.ok(result.data instanceof ArrayBuffer);
  assert.ok(result.data.byteLength > 80);
});

test("exportMeshObject resolves object by threeJsonId", async () => {
  const { scene, mesh } = makeSceneWithBox("obj-glb-1");
  mesh.userData.objJson.threeJsonId = "obj-glb-1";
  const result = await exportMeshObject(scene, "obj-glb-1", { format: "glb" });
  assert.ok(result.data.byteLength > 20);
  assert.ok(result.fileNameHint.includes("export-box") || result.fileNameHint.endsWith(".glb"));
});

test("exportMesh throws E_MESH_EXPORT_EMPTY when no mesh geometry", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.userData.objJson = { objType: "group", name: "empty-group", threeJsonId: "g1" };
  scene.add(group);
  assert.throws(
    () => prepareMeshExportRoot(scene, { scope: "scene" }),
    (error) => error.code === "E_MESH_EXPORT_EMPTY"
  );
});
