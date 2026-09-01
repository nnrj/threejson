/**
 * Adds host-only fill lights to an inline preview scene so a scene authored without lights remains
 * visible. The host removes the tagged group before rebuilding or exporting authoritative data.
 */
import * as THREE from "three";

export const SCENE_AGENT_PREVIEW_LIGHTS_NAME = "__scene_agent_preview_auxiliary_lights__";

export function removeSceneAgentPreviewLights(scene) {
  if (!scene?.children) {
    return false;
  }
  let removed = false;
  for (let index = scene.children.length - 1; index >= 0; index -= 1) {
    const child = scene.children[index];
    if (child?.name === SCENE_AGENT_PREVIEW_LIGHTS_NAME || child?.userData?.__sceneAgentPreviewOnly === true) {
      scene.remove(child);
      removed = true;
    }
  }
  return removed;
}

export function syncSceneAgentPreviewLights(scene, enabled = true) {
  if (scene) {
    removeSceneAgentPreviewLights(scene);
  }
  if (!enabled || !scene?.isScene) {
    return null;
  }

  const group = new THREE.Group();
  group.name = SCENE_AGENT_PREVIEW_LIGHTS_NAME;
  group.userData = {
    __sceneAgentPreviewOnly: true,
    __threeJsonRuntimeOnly: true,
    __threeJsonExportExcluded: true,
    objJson: { objType: "light", type: "scene-agent-preview-auxiliary" }
  };

  const ambient = new THREE.AmbientLight("#ffffff", 0.55);
  ambient.name = "Scene Agent Preview Ambient";
  const directional = new THREE.DirectionalLight("#ffffff", 0.75);
  directional.name = "Scene Agent Preview Directional";
  directional.position.set(260, 420, 380);
  directional.target.position.set(0, 0, 0);
  directional.castShadow = false;
  group.add(ambient, directional, directional.target);
  scene.add(group);
  return group;
}
