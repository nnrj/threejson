import { BufferAttribute, InstancedBufferAttribute, Vector4, DataTexture, RGBAFormat, FloatType, NearestFilter } from "three";
import { sampleTimelineWindow } from "./signals.js";

/** Analytic vertex effects on the existing Particle V2 points/billboard shader.
 * Positions/targets upload once; each rendered frame updates only uniforms.
 * No transform feedback/compute extension or WebGPU dependency is required.
 */
export function createWebglParticleEffects(bindings, options = {}) {
  const object = bindings[0].object, geometry = object.geometry, original = object.material;
  const position = geometry.getAttribute("particlePosition") ? "particlePosition" : "position";
  const marker = `vec4 mvPosition=modelViewMatrix*vec4(${position},1.0);`;
  if (!original?.isShaderMaterial || !original.vertexShader.includes(marker) || !geometry.getAttribute("particleSize")) throw Object.assign(new Error("WebGL analytic effects require a Particle V2 CPU/static points or billboard shader."), { code: "PARTICLE_EFFECT_GPU_UNAVAILABLE" });
  const material = original.clone(), Attribute = position === "particlePosition" ? InstancedBufferAttribute : BufferAttribute;
  const owned = [], uniforms = [], textures = [];
  let declarations = "", statements = `vec3 tjPosition=${position};\n`;
  const addAttribute = (name, data, size) => {
    if (geometry.getAttribute(name)) throw new Error(`Reserved particle effect attribute already exists: ${name}`);
    geometry.setAttribute(name, new Attribute(data, size)); owned.push(name);
  };
  try {
    const count = bindings[0].attr.count;
    addAttribute("tjEffectIndex", Float32Array.from({ length: count }, (_, i) => i / Math.max(1, count - 1)), 1);
    declarations += "attribute float tjEffectIndex;\n";
    for (const [i, binding] of bindings.entries()) {
      const name = `tjEffect${i}`, type = binding.effect.operator;
      const state = { value: new Vector4() }, params = { value: new Vector4() };
      material.uniforms[`${name}State`] = state; material.uniforms[`${name}Params`] = params;
      uniforms.push({ binding, state, params });
      declarations += `uniform vec4 ${name}State; uniform vec4 ${name}Params;\n`;
      statements += `{vec4 s=${name}State;vec4 a=${name}Params;if(s.x>0.5){float t=s.y;float p=clamp((s.z-s.w*tjEffectIndex)/max(0.000001,1.0-s.w),0.0,1.0);`;
      if (binding.effect.easing === "smoothstep") statements += "p=p*p*(3.0-2.0*p);";
      if (type === "wave") statements += "tjPosition.y+=sin(tjPosition.x*a.y+t*a.z)*a.x;";
      else if (type === "orbit") statements += "tjPosition.xz+=vec2(cos(t*a.y),sin(t*a.y))*a.x;";
      else if (type === "swirl") statements += "float angle=t*a.x+tjPosition.y*a.y;float c=cos(angle);float sn=sin(angle);tjPosition.xz=vec2(tjPosition.x*c-tjPosition.z*sn,tjPosition.x*sn+tjPosition.z*c);";
      else if (type === "wavefront") statements += "float d=length(tjPosition.xz)-t*a.z;tjPosition.y+=sin(d*a.y)*exp(-d*d/(a.w*a.w))*a.x;";
      else if (type === "flow") {
        const count = binding.flow.length / 3, size = Math.ceil(Math.sqrt(count));
        if (options.maxTextureSize && size > options.maxTextureSize) throw Object.assign(new Error(`Flow lookup texture ${size} exceeds this device's ${options.maxTextureSize} limit.`), { code: "PARTICLE_FLOW_GPU_CAPACITY" });
        const data = new Float32Array(size * size * 4);
        for (let j = 0; j < count; j++) data.set(binding.flow.subarray(j * 3, j * 3 + 3), j * 4);
        const texture = new DataTexture(data, size, size, RGBAFormat, FloatType); texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true; textures.push(texture);
        material.uniforms[`${name}Path`] = { value: texture };
        declarations += `uniform sampler2D ${name}Path;vec3 ${name}At(float i){return texture2D(${name}Path,(vec2(mod(i,${size}.0),floor(i/${size}.0))+0.5)/${size}.0).xyz;}\n`;
        statements += `float u=fract(t*a.x+tjEffectIndex*a.y+a.z)*${count - 1}.0;float i=floor(u);tjPosition=mix(${name}At(i),${name}At(i+1.0),u-i)+tjPosition*a.w;`;
      }
      else if (type === "morph" || type === "scatter") {
        const attr = `${name}Target`;
        addAttribute(attr, type === "morph" ? binding.destination : binding.scatter, 3);
        declarations += `attribute vec3 ${attr};\n`;
        statements += type === "morph" ? `tjPosition=mix(tjPosition,${attr},p);` : `tjPosition+=${attr}*a.x*p;`;
      } else throw Object.assign(new Error(`No analytic WebGL compiler for particle operator: ${type}`), { code: "PARTICLE_EFFECT_GPU_UNAVAILABLE" });
      statements += "}}\n";
    }
    material.vertexShader = declarations + original.vertexShader.replace(marker, `${statements}vec4 mvPosition=modelViewMatrix*vec4(tjPosition,1.0);`);
    material.needsUpdate = true; object.material = material;
  } catch (e) { for (const name of owned) geometry.deleteAttribute(name); textures.forEach(t => t.dispose()); material.dispose(); throw e; }
  return {
    evaluateAt(time) {
      for (const { binding, state, params } of uniforms) {
        const effect = binding.effect, a = effect.params || {}, w = sampleTimelineWindow(effect, time);
        state.value.set(w ? 1 : 0, w?.time || 0, effect.duration === undefined ? Math.min(1, w?.time || 0) : w?.progress || 0, Math.max(0, Math.min(.999999, effect.stagger || 0)));
        switch (effect.operator) {
          case "wave": params.value.set(a.amplitude ?? 1, a.frequency ?? 1, a.speed ?? 1, 0); break;
          case "wavefront": params.value.set(a.amplitude ?? 1, a.frequency ?? 4, a.speed ?? 2, a.width ?? 2); break;
          case "orbit": params.value.set(a.radius ?? 1, a.speed ?? 1, 0, 0); break;
          case "swirl": params.value.set(a.speed ?? 1, a.twist ?? .2, 0, 0); break;
          case "scatter": params.value.set(a.distance ?? 5, 0, 0, 0); break;
          case "flow": params.value.set(a.speed ?? .1, a.length ?? 1, a.phase ?? 0, a.spread ?? 0); break;
        }
      }
    },
    dispose() { if (object.material === material) object.material = original; material.dispose(); textures.forEach(t => t.dispose()); for (const name of owned) geometry.deleteAttribute(name); }
  };
}
