import * as THREE from "three";

import {
  getMovementRootWorldPosition,
  setMovementRootWorldPosition
} from "../../core/handler/controls/movementRootUtil.js";
import { resolveSceneExtensions } from "../../core/util/extensionsUtil.js";
import { addStaticCollidersFromScene } from "./sceneColliders.js";

const PHYSICS_EXTENSION_ID = "physics-rapier";

/**
 * 为第一人称 controls 注册 Rapier CharacterController（`controls.collision.provider: "rapier"`）。
 *
 * @param {{
 *   scene: import("three").Object3D,
 *   camera: import("three").PerspectiveCamera,
 *   controls: object,
 *   controlsConfig?: object,
 *   sceneJson?: object,
 *   sceneConfig?: object,
 *   worldInfo?: object,
 *   pluginHost: { register: (p: object) => void },
 *   RAPIER: object
 * }} ctx
 * @returns {Promise<object|null>}
 */
export async function bootstrapRapierFirstPersonFromScene(ctx) {
  const controls = ctx?.controls;
  const camera = ctx?.camera;
  const scene = ctx?.scene;
  const pluginHost = ctx?.pluginHost;
  const RAPIER = ctx?.RAPIER;

  if (!controls || controls.threeJsonControlsKind !== "firstPerson") {
    return null;
  }
  if (!scene || !camera || !pluginHost || !RAPIER) {
    return null;
  }
  if (typeof controls.setCollisionProvider !== "function") {
    return null;
  }

  const sceneJson = ctx?.sceneJson && typeof ctx.sceneJson === "object" ? ctx.sceneJson : {};
  const sceneConfig = ctx?.sceneConfig && typeof ctx.sceneConfig === "object"
    ? ctx.sceneConfig
    : sceneJson.sceneConfig && typeof sceneJson.sceneConfig === "object"
      ? sceneJson.sceneConfig
      : {};
  const worldInfo = ctx?.worldInfo && typeof ctx.worldInfo === "object"
    ? ctx.worldInfo
    : sceneJson.worldInfo && typeof sceneJson.worldInfo === "object"
      ? sceneJson.worldInfo
      : {};

  const controlsConfig = ctx?.controlsConfig && typeof ctx.controlsConfig === "object"
    ? ctx.controlsConfig
    : sceneConfig.controls && typeof sceneConfig.controls === "object"
      ? sceneConfig.controls
      : {};

  const collision = controlsConfig.collision && typeof controlsConfig.collision === "object"
    ? controlsConfig.collision
    : {};
  if (collision.enabled === false) {
    return null;
  }
  const provider = typeof collision.provider === "string" ? collision.provider.trim().toLowerCase() : "";
  if (provider !== "rapier") {
    return null;
  }

  if (typeof RAPIER.init === "function") {
    await RAPIER.init();
  }

  const sceneExt = resolveSceneExtensions(sceneConfig, worldInfo)[PHYSICS_EXTENSION_ID];
  const gravityRaw = sceneExt && typeof sceneExt === "object" ? sceneExt.gravity : null;
  const gravity = {
    x: Number.isFinite(gravityRaw?.x) ? gravityRaw.x : 0,
    y: Number.isFinite(gravityRaw?.y) ? gravityRaw.y : 0,
    z: Number.isFinite(gravityRaw?.z) ? gravityRaw.z : 0
  };

  const world = new RAPIER.World(gravity);
  const playerRef = typeof collision.playerRefName === "string" ? collision.playerRefName.trim() : "player";
  addStaticCollidersFromScene(world, RAPIER, scene, { skipRefName: playerRef });

  const capsuleRadius = Number.isFinite(collision.capsuleRadius) ? collision.capsuleRadius : 0.35;
  const capsuleHalfHeight = Number.isFinite(collision.capsuleHalfHeight) ? collision.capsuleHalfHeight : 0.75;
  const snapToGround = Number.isFinite(collision.snapToGround) ? collision.snapToGround : 0.45;

  const movementRoot = controls.movementRoot ?? camera;
  const start = getMovementRootWorldPosition(movementRoot);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y, start.z)
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius),
    body
  );

  const characterController = world.createCharacterController(0.05);
  characterController.enableSnapToGround(snapToGround);
  characterController.setApplyImpulsesToDynamicBodies(true);

  controls.floorSnap = false;

  const desiredMove = new THREE.Vector3();

  controls.setCollisionProvider({
    applyMovement({ moveDelta, movementRoot: root }) {
      const activeRoot = root ?? movementRoot;
      desiredMove.set(moveDelta.x, moveDelta.y, moveDelta.z);
      characterController.computeColliderMovement(collider, desiredMove);
      const corrected = characterController.computedMovement();
      const t = body.translation();
      const next = {
        x: t.x + corrected.x,
        y: t.y + corrected.y,
        z: t.z + corrected.z
      };
      body.setNextKinematicTranslation(next);
      world.step();
      const tr = body.translation();
      setMovementRootWorldPosition(activeRoot, camera, tr);
    },
    resolve() {}
  });

  const plugin = {
    name: "rapier-first-person",
    dispose() {
      try {
        world.free();
      } catch (_) {
        /* ignore */
      }
    }
  };
  pluginHost.register(plugin);

  return {
    world,
    body,
    collider,
    characterController,
    plugin
  };
}
