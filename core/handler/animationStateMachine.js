/**
 * glTF AnimationMixer state machine: enabled only when the record includes animationGraph.
 *
 * Registered machines live inside `createAnimationStateMachineStore()` instances, one
 * per RuntimeContext (see core/runtime/runtimeContext.js), so each canvas's render loop
 * only advances its own state machines. Functions that receive a root/target Object3D
 * auto-resolve their scope from it (walks up to the attached scene); `updateAnimationStateMachines`
 * takes an explicit trailing `runtimeScope` (the scene). Omitting either preserves
 * today's shared-global behavior.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { getObjectByThreeJsonId } from "./objectRegistry.js";
import {
  buildAnimationParameterDefaults,
  pickAnimationTransition,
  resolveAnimationGraph
} from "./animationGraphUtil.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

/**
 * @param {import("three").Object3D|import("three").AnimationMixer|string|null|undefined} target
 * @returns {import("three").Object3D|null}
 */
function resolveAnimationRoot(target, runtimeScope) {
  if (!target) {
    return null;
  }
  if (typeof target === "string") {
    const byId = getObjectByThreeJsonId(target.trim(), runtimeScope);
    if (byId) {
      return byId;
    }
    return null;
  }
  if (target.isObject3D) {
    return target;
  }
  if (target instanceof THREE.AnimationMixer && target.getRoot) {
    const root = target.getRoot();
    return root?.isObject3D ? root : null;
  }
  return null;
}

/**
 * @param {THREE.AnimationClip[]} clips
 * @returns {Map<string, THREE.AnimationClip>}
 */
function indexClipsByName(clips) {
  const map = new Map();
  if (!Array.isArray(clips)) {
    return map;
  }
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    if (!clip) {
      continue;
    }
    const name = typeof clip.name === "string" && clip.name.trim() ? clip.name.trim() : `clip_${i}`;
    if (!map.has(name)) {
      map.set(name, clip);
    }
  }
  return map;
}

/**
 * @param {THREE.AnimationAction} action
 * @param {object} clipSpec
 * @param {object} stateDef
 */
function configureClipAction(action, clipSpec, stateDef) {
  const loop = clipSpec?.loop !== false;
  if (loop) {
    action.setLoop(THREE.LoopRepeat, Infinity);
  } else {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  const speed = Number(clipSpec?.speed ?? stateDef?.speed ?? 1);
  action.timeScale = Number.isFinite(speed) && speed > 0 ? speed : 1;
  action.enabled = true;
}

/**
 * @param {object} machine
 * @param {string} stateName
 * @param {number} crossFade
 */
function enterAnimationState(machine, stateName, crossFade = 0) {
  const stateDef = machine.graph.states[stateName];
  if (!stateDef) {
    log.warn("[animationGraph] unknown state:", stateName);
    return;
  }

  const prevActions = [...machine.activeActions];
  const nextActions = [];
  const clipSpecs = Array.isArray(stateDef.clips) ? stateDef.clips : [];

  for (let i = 0; i < clipSpecs.length; i += 1) {
    const clipSpec = clipSpecs[i];
    const clipName = typeof clipSpec?.name === "string" ? clipSpec.name.trim() : "";
    if (!clipName) {
      continue;
    }
    const clip = machine.clipsByName.get(clipName);
    if (!clip) {
      log.warn("[animationGraph] clip not found:", clipName, "for state", stateName);
      continue;
    }
    const action = machine.mixer.clipAction(clip);
    configureClipAction(action, clipSpec, stateDef);
    nextActions.push(action);
  }

  const fade = Number.isFinite(crossFade) && crossFade >= 0 ? crossFade : 0;

  if (nextActions.length === 0) {
    for (let i = 0; i < prevActions.length; i += 1) {
      prevActions[i].fadeOut(fade);
    }
    machine.activeActions = [];
    machine.currentState = stateName;
    return;
  }

  for (let i = 0; i < nextActions.length; i += 1) {
    const action = nextActions[i];
    action.reset();
    action.play();
    const fromAction = prevActions[i] ?? prevActions[0] ?? null;
    if (fromAction && fromAction !== action) {
      action.crossFadeFrom(fromAction, fade, true);
    }
  }

  for (let i = 0; i < prevActions.length; i += 1) {
    if (!nextActions.includes(prevActions[i])) {
      prevActions[i].fadeOut(fade);
    }
  }

  machine.activeActions = nextActions;
  machine.currentState = stateName;
}

/**
 * @param {object} machine
 */
function collectClipFinishedEvents(machine) {
  for (let i = 0; i < machine.activeActions.length; i += 1) {
    const action = machine.activeActions[i];
    if (!action || action.loop === THREE.LoopRepeat) {
      continue;
    }
    const clip = action.getClip();
    const duration = clip?.duration ?? 0;
    if (duration > 0 && action.time >= duration - 1e-4) {
      machine.pendingEvents.add("clipFinished");
      break;
    }
  }
}

export function createAnimationStateMachineStore(deps = {}) {
  const ownerRuntimeContext = deps.ownerRuntimeContext ?? null;
  /** @type {Map<string, object>} */
  const machinesByRootUuid = new Map();

  function getAnimationStateMachine(root) {
    const resolved = resolveAnimationRoot(root, ownerRuntimeContext);
    return resolved ? machinesByRootUuid.get(resolved.uuid) ?? null : null;
  }

  function isAnimationStateMachineRoot(root) {
    return Boolean(getAnimationStateMachine(root));
  }

  function registerAnimationStateMachine(root, gltf, descriptor = null) {
    const record = descriptor && typeof descriptor === "object" ? descriptor : root?.userData?.objJson;
    const graph = resolveAnimationGraph(record);
    if (!root || !gltf || !graph) {
      return null;
    }

    unregisterAnimationStateMachine(root);

    const clips = Array.isArray(gltf.animations) ? gltf.animations : [];
    if (clips.length === 0) {
      log.warn("[animationGraph] no animation clips on glTF:", record?.name || root.name || "");
      return null;
    }

    const mixer = new THREE.AnimationMixer(root);
    const machine = {
      root,
      mixer,
      graph,
      clipsByName: indexClipsByName(clips),
      parameters: buildAnimationParameterDefaults(graph),
      pendingEvents: new Set(),
      currentState: "",
      activeActions: []
    };

    enterAnimationState(machine, graph.defaultState, 0);
    machinesByRootUuid.set(root.uuid, machine);
    return mixer;
  }

  function unregisterAnimationStateMachine(root) {
    const resolved = resolveAnimationRoot(root, ownerRuntimeContext);
    if (!resolved) {
      return;
    }
    const machine = machinesByRootUuid.get(resolved.uuid);
    if (!machine) {
      return;
    }
    machine.mixer.stopAllAction();
    machinesByRootUuid.delete(resolved.uuid);
  }

  function setAnimationParameter(target, name, value) {
    const root = resolveAnimationRoot(target, ownerRuntimeContext);
    const machine = root ? machinesByRootUuid.get(root.uuid) : null;
    const key = typeof name === "string" ? name.trim() : "";
    if (!machine || !key) {
      return false;
    }
    const spec = machine.graph.parameters?.[key];
    const type = typeof spec?.type === "string" ? spec.type.trim().toLowerCase() : "float";
    if (type === "bool" || type === "boolean") {
      machine.parameters[key] = Boolean(value);
    } else {
      const n = Number(value);
      machine.parameters[key] = Number.isFinite(n) ? n : 0;
    }
    return true;
  }

  function fireAnimationEvent(target, eventName) {
    const root = resolveAnimationRoot(target, ownerRuntimeContext);
    const machine = root ? machinesByRootUuid.get(root.uuid) : null;
    const key = typeof eventName === "string" ? eventName.trim() : "";
    if (!machine || !key) {
      return false;
    }
    machine.pendingEvents.add(key);
    return true;
  }

  function updateAnimationStateMachines(scene, deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || machinesByRootUuid.size === 0) {
      return;
    }

    for (const machine of machinesByRootUuid.values()) {
      if (!machine?.root?.parent) {
        unregisterAnimationStateMachine(machine.root);
        continue;
      }

      collectClipFinishedEvents(machine);

      const picked = pickAnimationTransition(
        machine.currentState,
        machine.graph,
        machine.parameters,
        machine.pendingEvents
      );
      machine.pendingEvents.clear();

      if (picked && picked.to !== machine.currentState) {
        enterAnimationState(machine, picked.to, picked.crossFade);
      }

      machine.mixer.update(deltaSeconds);
    }
  }

  function clearForTests() {
    for (const machine of machinesByRootUuid.values()) {
      machine.mixer?.stopAllAction?.();
    }
    machinesByRootUuid.clear();
  }

  return {
    getAnimationStateMachine,
    isAnimationStateMachineRoot,
    registerAnimationStateMachine,
    unregisterAnimationStateMachine,
    setAnimationParameter,
    fireAnimationEvent,
    updateAnimationStateMachines,
    dispose: clearForTests
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).animationStateMachine;
}

/**
 * @param {import("three").Object3D} root
 * @param {*} [runtimeScope]
 */
export function getAnimationStateMachine(root, runtimeScope) {
  return resolveStore(runtimeScope ?? root).getAnimationStateMachine(root);
}

/**
 * @param {import("three").Object3D} root
 * @param {*} [runtimeScope]
 */
export function isAnimationStateMachineRoot(root, runtimeScope) {
  return resolveStore(runtimeScope ?? root).isAnimationStateMachineRoot(root);
}

/**
 * @param {import("three").Object3D} root
 * @param {{ animations?: THREE.AnimationClip[] }} gltf
 * @param {object} [descriptor]
 * @param {*} [runtimeScope]
 */
export function registerAnimationStateMachine(root, gltf, descriptor = null, runtimeScope) {
  return resolveStore(runtimeScope ?? root).registerAnimationStateMachine(root, gltf, descriptor);
}

/**
 * @param {import("three").Object3D|null|undefined} root
 * @param {*} [runtimeScope]
 */
export function unregisterAnimationStateMachine(root, runtimeScope) {
  return resolveStore(runtimeScope ?? root).unregisterAnimationStateMachine(root);
}

/**
 * @param {import("three").Object3D|import("three").AnimationMixer|string} target
 * @param {string} name
 * @param {boolean|number} value
 * @param {*} [runtimeScope]
 */
export function setAnimationParameter(target, name, value, runtimeScope) {
  return resolveStore(runtimeScope ?? target).setAnimationParameter(target, name, value);
}

/**
 * @param {import("three").Object3D|import("three").AnimationMixer|string} target
 * @param {string} eventName
 * @param {*} [runtimeScope]
 */
export function fireAnimationEvent(target, eventName, runtimeScope) {
  return resolveStore(runtimeScope ?? target).fireAnimationEvent(target, eventName);
}

/**
 * @param {import("three").Object3D|null|undefined} scene
 * @param {number} deltaSeconds
 */
export function updateAnimationStateMachines(scene, deltaSeconds) {
  return resolveStore(scene).updateAnimationStateMachines(scene, deltaSeconds);
}

/** For unit tests only */
export function _clearAnimationStateMachinesForTests(runtimeScope) {
  resolveStore(runtimeScope).dispose();
}
