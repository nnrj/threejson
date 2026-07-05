import { registerObjTypeDeployer } from "../../handler/sceneExtensionRegistry.js";
import { deployParticleEmitter } from "./particleEmitterBuilder.js";

let registered = false;

export function registerCoreParticleMechanism() {
  if (registered) {
    return;
  }
  registerObjTypeDeployer("particleemitter", (record, scene, ctx) => {
    deployParticleEmitter(record, scene, ctx);
  });
  registered = true;
}

registerCoreParticleMechanism();

