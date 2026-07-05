/**
 * 第三方粒子库适配器骨架（stub）。
 * 用法：import "threejson/extensions/particle-nebula"
 */
import {
  registerParticleEmitterProvider,
  deployParticleEmitterCore
} from "../../core/index.js";
import { PARTICLE_EMITTER_DEFAULT_OPACITY } from "../../core/theme/runtimeVisualDefaults.js";

/**
 * @param {object} record
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [ctx]
 * @returns {import("three").Object3D|null}
 */
export function deployNebulaParticleEmitter(record, scene, ctx = {}) {
  const material = record?.material && typeof record.material === "object" ? record.material : {};
  const size = Number(material.size);
  const opacity = Number(material.opacity);
  const delegated = {
    ...record,
    provider: "core",
    material: {
      ...material,
      size: Number.isFinite(size) ? size * 1.15 : 2.3,
      opacity: Number.isFinite(opacity) ? Math.min(1, opacity * 1.05) : PARTICLE_EMITTER_DEFAULT_OPACITY
    }
  };
  return deployParticleEmitterCore(delegated, scene, ctx);
}

/**
 * 注册 provider: "nebula"。可多次调用，幂等。
 */
export function registerParticleNebulaExtension() {
  registerParticleEmitterProvider("nebula", deployNebulaParticleEmitter);
}

registerParticleNebulaExtension();
