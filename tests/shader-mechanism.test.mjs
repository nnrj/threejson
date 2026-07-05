import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  registerShaderPreset,
  hasShaderPreset,
  createShaderMaterialFromPreset,
  mergeShaderUniforms,
  _clearShaderPresetsForTests
} from "../core/builder/shader/shaderPresetRegistry.js";
import {
  updateShaderMotion,
  trackShaderMaterial,
  _resetShaderMotionForTests
} from "../core/builder/shader/shaderMotion.js";
import { deployShaderSurface } from "../core/builder/shader/shaderSurfaceBuilder.js";
import { registerSolidColorPreset } from "../core/builder/shader/presets/solidColorPreset.js";
import { registerCoreShaderMechanism } from "../core/builder/shader/registerCoreShader.js";
import { getObjTypeDeployer } from "../core/handler/sceneExtensionRegistry.js";

test("registerShaderPreset and createShaderMaterialFromPreset", () => {
  _clearShaderPresetsForTests();
  registerSolidColorPreset();
  assert.equal(hasShaderPreset("solidColor"), true);
  const mat = createShaderMaterialFromPreset("solidColor", {
    uniforms: { color: "#ff0000", opacity: 0.5 }
  });
  assert.ok(mat?.isShaderMaterial);
  assert.equal(mat.uniforms.color.value.getHexString(), "ff0000");
  assert.equal(mat.uniforms.opacity.value, 0.5);
  assert.equal(mat.transparent, true);
});

test("mergeShaderUniforms overlays overrides", () => {
  assert.deepEqual(
    mergeShaderUniforms({ speed: 1, tint: "#fff" }, { speed: 2 }),
    { speed: 2, tint: "#fff" }
  );
});

test("updateShaderMotion advances time uniforms", () => {
  _clearShaderPresetsForTests();
  registerShaderPreset("tick", {
    createMaterial() {
      return new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          deltaTime: { value: 0 }
        },
        vertexShader: "void main(){gl_Position=vec4(0.);}",
        fragmentShader: "void main(){gl_FragColor=vec4(1.);}"
      });
    }
  });
  const mat = createShaderMaterialFromPreset("tick");
  trackShaderMaterial(mat, "tick");
  updateShaderMotion(0.5);
  assert.equal(mat.uniforms.time.value, 0.5);
  assert.equal(mat.uniforms.deltaTime.value, 0.5);
  _resetShaderMotionForTests();
});

test("deployShaderSurface creates mesh with objJson", () => {
  _clearShaderPresetsForTests();
  registerSolidColorPreset();
  const scene = new THREE.Scene();
  const mesh = deployShaderSurface(
    {
      objType: "shaderSurface",
      shaderPreset: "solidColor",
      surface: "plane",
      geometry: { width: 4, height: 2 },
      uniforms: { color: "#00ff00" },
      position: { x: 1, y: 2, z: 3 }
    },
    scene
  );
  assert.ok(mesh);
  assert.equal(mesh.userData.objJson.objType, "shaderSurface");
  assert.equal(mesh.userData.objJson.shaderPreset, "solidColor");
  assert.equal(scene.children.includes(mesh), true);
  assert.equal(mesh.geometry.type, "PlaneGeometry");
});

test("registerCoreShaderMechanism registers shaderSurface deployer", () => {
  registerCoreShaderMechanism();
  const deployer = getObjTypeDeployer("shadersurface");
  assert.equal(typeof deployer, "function");
});
