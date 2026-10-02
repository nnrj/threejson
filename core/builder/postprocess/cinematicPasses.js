import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

const vertexShader = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
// Troika's material getter can return an outline/fill array, while its setter
// accepts a SINGLE base material. Shadow the accessor for the prepass instead
// of assigning/restoring that array through the setter (which corrupts Text).
function temporaryMaterial(object, material, restore) {
  const descriptor = Object.getOwnPropertyDescriptor(object, "material");
  Object.defineProperty(object, "material", { configurable: true, enumerable: true, writable: true, value: material });
  restore.push(() => { if (descriptor) Object.defineProperty(object, "material", descriptor); else delete object.material; });
}
function overrideMaterial(source, mode) {
  if (mode === "depth" && source.getDepthMaterial) return { material: source.getDepthMaterial(), owned: false };
  if (source.isShaderMaterial && /void\s+main\s*\(/.test(source.fragmentShader) && source.fragmentShader.includes("gl_FragColor")) {
    const material = source.clone(); material.uniforms = source.uniforms;
    material.fragmentShader = (mode === "depth" ? "#include <packing>\n" : "") + source.fragmentShader.replace(/void\s+main\s*\(/, "void tjSurfaceMain(") +
      `\nvoid main(){tjSurfaceMain();if(gl_FragColor.a<0.01)discard;gl_FragColor=${mode === "depth" ? "packDepthToRGBA(gl_FragCoord.z)" : "vec4(0.0,0.0,0.0,gl_FragColor.a)"};}`;
    material.transparent = mode !== "depth" && source.transparent; material.depthWrite = true; material.blending = mode === "depth" ? THREE.NoBlending : source.blending;
    return { material, owned: true };
  }
  const material = mode === "depth" ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }) :
    source.isPointsMaterial || source.isLineBasicMaterial || source.isSpriteMaterial || source.isDerivedMaterial ? source.clone() : new THREE.MeshBasicMaterial();
  for (const key of ["map", "alphaMap", "alphaTest", "side", "displacementMap", "displacementScale", "displacementBias", "opacity", "transparent", "wireframe"]) if (key in source && key in material) material[key] = source[key];
  if (mode === "dark") { material.color?.set(0); material.emissive?.set(0); }
  return { material, owned: true };
}
function materialCache(mode) {
  const cache = new Map();
  return {
    get(material) { if (!cache.has(material)) cache.set(material, overrideMaterial(material, mode)); return cache.get(material).material; },
    dispose() { for (const item of cache.values()) if (item.owned) item.material.dispose(); cache.clear(); }
  };
}

/** Bokeh depth preserves Particle V2 analytic positions/sprites and Troika SDF
 * glyph cutouts, unlike a blanket scene.overrideMaterial depth prepass. */
export class SceneDepthOfFieldPass extends BokehPass {
  constructor(scene, camera, record) { super(scene, camera, record); this.depthMaterials = materialCache("depth"); }
  render(renderer, writeBuffer, readBuffer) {
    const materials = [], clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    const background = this.scene.background, override = this.scene.overrideMaterial, target = renderer.getRenderTarget();
    try {
      this.scene.overrideMaterial = null; this.scene.background = null;
      this.scene.traverse(object => {
        const material = object.material; if (!material) return;
        temporaryMaterial(object, object.customDepthMaterial || (Array.isArray(material) ? material.map(m => this.depthMaterials.get(m)) : this.depthMaterials.get(material)), materials);
      });
      renderer.autoClear = false; renderer.setClearColor(0xffffff, 1); renderer.setRenderTarget(this._renderTargetDepth); renderer.clear(); renderer.render(this.scene, this.camera);
    } finally {
      for (const restore of materials) restore();
      this.scene.overrideMaterial = override; this.scene.background = background;
      renderer.setClearColor(clearColor, clearAlpha); renderer.autoClear = autoClear; renderer.setRenderTarget(target);
    }
    this.uniforms.tColor.value = readBuffer.texture; this.uniforms.nearClip.value = this.camera.near; this.uniforms.farClip.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this._fsQuad.render(renderer);
  }
  dispose() { this.depthMaterials.dispose(); super.dispose(); }
}

export class SelectiveBloomPass extends Pass {
  constructor(scene, camera, record = {}) {
    super(); this.scene = scene; this.camera = camera; this.targets = record.targets || [];
    this.strength = record.strength ?? 1; this.radius = record.radius ?? .4; this.threshold = record.threshold ?? .2;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }); this.dark = materialCache("dark");
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), this.strength, this.radius, this.threshold);
    this.material = new THREE.ShaderMaterial({ uniforms: { base: { value: null }, glow: { value: null } }, vertexShader,
      fragmentShader: "uniform sampler2D base;uniform sampler2D glow;varying vec2 vUv;void main(){vec4 a=texture2D(base,vUv);gl_FragColor=vec4(a.rgb+texture2D(glow,vUv).rgb,a.a);}", depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(width, height) { this.target.setSize(width, height); this.bloom.setSize(width, height); }
  render(renderer, writeBuffer, readBuffer, delta, mask) {
    const originals = [], selected = new Set(this.targets), background = this.scene.background, target = renderer.getRenderTarget();
    const clearColor = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    try {
      this.scene.background = null;
      this.scene.traverse(object => {
        const material = object.material; if (!material) return;
        let node = object, match = false;
        while (node) { if (selected.has(node.userData?.threeJsonId || node.userData?.objJson?.threeJsonId)) { match = true; break; } node = node.parent; }
        if (!match) {
          temporaryMaterial(object, Array.isArray(material) ? material.map(m => this.dark.get(m)) : this.dark.get(material), originals);
          // Text updates its derived material from these public properties in
          // onBeforeRender. Preserve glyph alpha but prevent unselected text bloom.
          if ([].concat(material).some(m => m.isTroikaTextMaterial)) {
            for (const key of ["color", "outlineColor", "strokeColor"]) { const value = object[key]; object[key] = 0; originals.push(() => { object[key] = value; }); }
            const before = object.onBeforeRender;
            object.onBeforeRender = function (...args) { before.apply(this, args); const m = args[4]; if (m?.uniforms?.uTroikaUseGlyphColors) m.uniforms.uTroikaUseGlyphColors.value = false; };
            originals.push(() => { object.onBeforeRender = before; });
          }
        }
      });
      renderer.setClearColor(0, 0); renderer.setRenderTarget(this.target); renderer.clear(); renderer.render(this.scene, this.camera);
      this.bloom.strength = this.strength; this.bloom.radius = this.radius; this.bloom.threshold = this.threshold;
      this.bloom.render(renderer, null, this.target, delta, mask);
    } finally {
      for (const restore of originals) restore();
      this.scene.background = background; renderer.setClearColor(clearColor, alpha); renderer.autoClear = autoClear; renderer.setRenderTarget(target);
    }
    this.material.uniforms.base.value = readBuffer.texture; this.material.uniforms.glow.value = this.bloom.renderTargetsHorizontal[0].texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
  }
  dispose() { this.target.dispose(); this.bloom.dispose(); this.dark.dispose(); this.material.dispose(); this.quad.dispose(); }
}

export function createCinematicPass(record = {}) {
  const pass = new ShaderPass({ uniforms: { tDiffuse: { value: null }, vignette: { value: record.vignette ?? .2 }, saturation: { value: record.saturation ?? 1 }, contrast: { value: record.contrast ?? 1 }, exposure: { value: record.exposure ?? 1 }, streak: { value: record.streak ?? 0 }, streakThreshold: { value: record.streakThreshold ?? 1 }, resolution: { value: new THREE.Vector2(1, 1) } }, vertexShader,
    fragmentShader: `uniform sampler2D tDiffuse;uniform float vignette,saturation,contrast,exposure,streak,streakThreshold;uniform vec2 resolution;varying vec2 vUv;
      void main(){vec4 source=texture2D(tDiffuse,vUv);vec3 c=source.rgb;
      if(streak>0.0){for(int i=1;i<=12;i++){float f=float(i);vec2 d=vec2(f*4.0/resolution.x,0.0);c+=(max(texture2D(tDiffuse,vUv+d).rgb-vec3(streakThreshold),vec3(0.0))+max(texture2D(tDiffuse,vUv-d).rgb-vec3(streakThreshold),vec3(0.0)))*streak/(f*12.0);}}
      c*=exposure;float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,saturation);c=(c-.18)*contrast+.18;vec2 p=vUv*2.0-1.0;c*=1.0-vignette*smoothstep(.3,1.5,dot(p,p));gl_FragColor=vec4(max(c,vec3(0.0)),source.a);}` });
  pass.setSize = (width, height) => pass.uniforms.resolution.value.set(width, height); return pass;
}
