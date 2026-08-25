/** WebGL2 GPUComputationRenderer backend for the Particle V2 descriptor. */
import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { log } from "../../util/logger.js";
import { loadingManager } from "../../cache/loading.js";
import { resolvePublicAssetUrl } from "../../util/assetsBase.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject, getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../../util/util.js";
import { resolvePointsBlending } from "../pointsBuilder.js";
import { resolveRuntimeContext } from "../../runtime/runtimeContext.js";
import { resolvePosition, resolveRotation, resolveScale } from "../../util/vectorValue.js";
import { resolveParticleTextureSize } from "./particleComputeUtil.js";
import { buildParticleEmitterWorldMatrix, createSeededRandom, sampleParticleSourcePositions } from "./particleSourceSampler.js";
import { PARTICLE_ATTRACTOR_LIMIT, assertParticleCountWithinBudget, normalizeParticleEmitterV2, sampleRange } from "./particleV2Descriptor.js";
import { normalizeParticleLifecycleFrames, PARTICLE_SHADER_KEYFRAME_LIMIT } from "./particleLifecycle.js";

export { resolveParticleTextureSize } from "./particleComputeUtil.js";

const POSITION_SHADER = /* glsl */`
uniform float delta;
uniform sampler2D textureOrigin;
uniform vec3 boundMin;
uniform vec3 boundMax;
uniform int boundaryPolicy;
uniform bool loopParticles;
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 posLife=texture2D(texturePosition,uv);
  vec4 velocityAge=texture2D(textureVelocity,uv);
  vec4 originLife=texture2D(textureOrigin,uv);
  if(originLife.w<0.0){gl_FragColor=originLife;return;}
  float age=velocityAge.w;
  if(age<0.0){gl_FragColor=originLife;return;}
  if(originLife.w>0.0&&age>=originLife.w){
    gl_FragColor=loopParticles?originLife:posLife;
    return;
  }
  vec3 pos=posLife.xyz+velocityAge.xyz*delta;
  if(boundaryPolicy==1){
    if(pos.x<boundMin.x)pos.x=boundMax.x;if(pos.x>boundMax.x)pos.x=boundMin.x;
    if(pos.y<boundMin.y)pos.y=boundMax.y;if(pos.y>boundMax.y)pos.y=boundMin.y;
    if(pos.z<boundMin.z)pos.z=boundMax.z;if(pos.z>boundMax.z)pos.z=boundMin.z;
  }
  gl_FragColor=vec4(pos,originLife.w);
}`;

const VELOCITY_SHADER = /* glsl */`
uniform float delta;
uniform float elapsed;
uniform sampler2D textureOrigin;
uniform sampler2D textureInitialVelocity;
uniform vec3 acceleration;
uniform float drag;
uniform float noiseStrength;
uniform float noiseFrequency;
uniform int boundaryPolicy;
uniform vec3 boundMin;
uniform vec3 boundMax;
uniform float restitution;
uniform bool loopParticles;
uniform int attractorCount;
uniform vec4 attractors[${PARTICLE_ATTRACTOR_LIMIT}];
uniform float attractorMaxDistances[${PARTICLE_ATTRACTOR_LIMIT}];
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 current=texture2D(textureVelocity,uv);
  vec4 initial=texture2D(textureInitialVelocity,uv);
  vec4 originLife=texture2D(textureOrigin,uv);
  vec3 pos=texture2D(texturePosition,uv).xyz;
  if(originLife.w<0.0){gl_FragColor=vec4(0.0,0.0,0.0,-1.0);return;}
  float age=current.w+delta;
  if(age<0.0){gl_FragColor=vec4(0.0,0.0,0.0,age);return;}
  if(originLife.w>0.0&&age>=originLife.w){
    if(loopParticles){gl_FragColor=vec4(initial.xyz,0.0);}else{gl_FragColor=vec4(0.0,0.0,0.0,age);}
    return;
  }
  vec3 force=acceleration;
  if(noiseStrength>0.0){
    force+=vec3(sin((elapsed+uv.x*17.0)*noiseFrequency),sin((elapsed+uv.y*23.0)*noiseFrequency),cos((elapsed+uv.x*31.0)*noiseFrequency))*noiseStrength;
  }
  for(int i=0;i<${PARTICLE_ATTRACTOR_LIMIT};i++){
    if(i>=attractorCount)break;
    vec3 offset=attractors[i].xyz-pos;
    float distanceSq=max(dot(offset,offset),0.0001);
    float maxDistance=attractorMaxDistances[i];
    if(maxDistance<=0.0||distanceSq<=maxDistance*maxDistance){
      force+=offset*(attractors[i].w/distanceSq);
    }
  }
  vec3 velocity=(current.xyz+force*delta)*exp(-drag*delta);
  if(boundaryPolicy==2){
    if(pos.x<boundMin.x||pos.x>boundMax.x)velocity.x*=-restitution;
    if(pos.y<boundMin.y||pos.y>boundMax.y)velocity.y*=-restitution;
    if(pos.z<boundMin.z||pos.z>boundMax.z)velocity.z*=-restitution;
  }else if(boundaryPolicy==3){
    if(any(lessThan(pos,boundMin))||any(greaterThan(pos,boundMax))){gl_FragColor=vec4(0.0,0.0,0.0,originLife.w+1.0);return;}
  }
  gl_FragColor=vec4(velocity,age);
}`;

const RENDER_VERTEX = /* glsl */`
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform int sizeKeyCount;
uniform vec2 sizeKeys[8];
uniform bool sizeAttenuation;
uniform vec2 rotationRange;
uniform vec2 angularVelocityRange;
attribute vec2 reference;
varying float vLifeProgress;
varying float vAlive;
varying float vRotation;
float sampleSizeCurve(float t){
  float value=sizeKeys[0].y;
  for(int i=1;i<8;i++){
    if(i>=sizeKeyCount)break;
    vec2 a=sizeKeys[i-1],b=sizeKeys[i];
    if(t<=b.x)return mix(a.y,b.y,clamp((t-a.x)/max(b.x-a.x,0.00001),0.0,1.0));
    value=b.y;
  }
  return value;
}
void main(){
  vec4 posLife=texture2D(texturePosition,reference);
  float age=texture2D(textureVelocity,reference).w;
  vAlive=(age>=0.0&&(posLife.w<=0.0||age<posLife.w))?1.0:0.0;
  vLifeProgress=posLife.w>0.0?clamp(age/posLife.w,0.0,1.0):0.0;
  float randomValue=fract(sin(dot(reference,vec2(12.9898,78.233)))*43758.5453);
  float angularRandom=fract(sin(dot(reference,vec2(39.3468,11.135)))*24634.6345);
  vRotation=mix(rotationRange.x,rotationRange.y,randomValue)+max(age,0.0)*mix(angularVelocityRange.x,angularVelocityRange.y,angularRandom);
  vec4 mvPosition=modelViewMatrix*vec4(posLife.xyz,1.0);
  gl_Position=projectionMatrix*mvPosition;
  float size=sampleSizeCurve(vLifeProgress)*vAlive;
  gl_PointSize=sizeAttenuation?size*(300.0/max(-mvPosition.z,1.0)):size;
}`;

const RENDER_FRAGMENT = /* glsl */`
uniform int colorKeyCount;
uniform vec4 colorKeys[8];
uniform int opacityKeyCount;
uniform vec2 opacityKeys[8];
uniform sampler2D spriteMap;
uniform bool useSpriteMap;
uniform vec2 atlasGrid;
uniform float atlasFrameStart;
uniform float atlasFrameEnd;
varying float vLifeProgress;
varying float vAlive;
varying float vRotation;
float sampleOpacityCurve(float t){
  float value=opacityKeys[0].y;
  for(int i=1;i<8;i++){
    if(i>=opacityKeyCount)break;
    vec2 a=opacityKeys[i-1],b=opacityKeys[i];
    if(t<=b.x)return mix(a.y,b.y,clamp((t-a.x)/max(b.x-a.x,0.00001),0.0,1.0));
    value=b.y;
  }
  return value;
}
vec3 sampleColorCurve(float t){
  vec3 value=colorKeys[0].yzw;
  for(int i=1;i<8;i++){
    if(i>=colorKeyCount)break;
    vec4 a=colorKeys[i-1],b=colorKeys[i];
    if(t<=b.x)return mix(a.yzw,b.yzw,clamp((t-a.x)/max(b.x-a.x,0.00001),0.0,1.0));
    value=b.yzw;
  }
  return value;
}
void main(){
  if(vAlive<0.5)discard;
  vec2 center=gl_PointCoord-vec2(0.5);
  float c=cos(vRotation),s=sin(vRotation);
  center=mat2(c,-s,s,c)*center;
  if(!useSpriteMap&&length(center)>0.5)discard;
  float edge=1.0-smoothstep(0.35,0.5,length(center));
  float frame=floor(mix(atlasFrameStart,atlasFrameEnd,vLifeProgress)+0.5);
  vec2 cell=vec2(mod(frame,atlasGrid.x),atlasGrid.y-1.0-floor(frame/atlasGrid.x));
  vec2 sampleUv=(center+vec2(0.5)+cell)/atlasGrid;
  vec4 sampled=useSpriteMap?texture2D(spriteMap,sampleUv):vec4(1.0,1.0,1.0,edge);
  gl_FragColor=vec4(sampleColorCurve(vLifeProgress),sampleOpacityCurve(vLifeProgress))*sampled;
}`;

const BILLBOARD_RENDER_VERTEX = /* glsl */`
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform int sizeKeyCount;
uniform vec2 sizeKeys[8];
uniform bool sizeAttenuation;
uniform vec2 rotationRange;
uniform vec2 angularVelocityRange;
attribute vec2 reference;
varying vec2 vParticleUv;
varying float vLifeProgress;
varying float vAlive;
float sampleSizeCurve(float t){
  float value=sizeKeys[0].y;
  for(int i=1;i<8;i++){
    if(i>=sizeKeyCount)break;
    vec2 a=sizeKeys[i-1],b=sizeKeys[i];
    if(t<=b.x)return mix(a.y,b.y,clamp((t-a.x)/max(b.x-a.x,0.00001),0.0,1.0));
    value=b.y;
  }
  return value;
}
void main(){
  vec4 posLife=texture2D(texturePosition,reference);
  float age=texture2D(textureVelocity,reference).w;
  vAlive=(age>=0.0&&(posLife.w<=0.0||age<posLife.w))?1.0:0.0;
  vLifeProgress=posLife.w>0.0?clamp(age/posLife.w,0.0,1.0):0.0;
  vParticleUv=uv;
  vec4 mvPosition=modelViewMatrix*vec4(posLife.xyz,1.0);
  float size=sampleSizeCurve(vLifeProgress)*vAlive;
  float scale=sizeAttenuation?size:size*max(-mvPosition.z,1.0)/300.0;
  float randomValue=fract(sin(dot(reference,vec2(12.9898,78.233)))*43758.5453);
  float angularRandom=fract(sin(dot(reference,vec2(39.3468,11.135)))*24634.6345);
  float angle=mix(rotationRange.x,rotationRange.y,randomValue)+max(age,0.0)*mix(angularVelocityRange.x,angularVelocityRange.y,angularRandom);
  float c=cos(angle),s=sin(angle);
  vec2 corner=mat2(c,-s,s,c)*position.xy;
  mvPosition.xy+=corner*scale;
  gl_Position=projectionMatrix*mvPosition;
}`;

const BILLBOARD_RENDER_FRAGMENT = /* glsl */`
uniform int colorKeyCount;
uniform vec4 colorKeys[8];
uniform int opacityKeyCount;
uniform vec2 opacityKeys[8];
uniform sampler2D spriteMap;
uniform bool useSpriteMap;
uniform vec2 atlasGrid;
uniform float atlasFrameStart;
uniform float atlasFrameEnd;
varying vec2 vParticleUv;
varying float vLifeProgress;
varying float vAlive;
float sampleOpacityCurve(float t){
  float value=opacityKeys[0].y;
  for(int i=1;i<8;i++){
    if(i>=opacityKeyCount)break;
    vec2 a=opacityKeys[i-1],b=opacityKeys[i];
    if(t<=b.x)return mix(a.y,b.y,clamp((t-a.x)/max(b.x-a.x,0.00001),0.0,1.0));
    value=b.y;
  }
  return value;
}
vec3 sampleColorCurve(float t){
  vec3 value=colorKeys[0].yzw;
  for(int i=1;i<8;i++){
    if(i>=colorKeyCount)break;
    vec4 a=colorKeys[i-1],b=colorKeys[i];
    if(t<=b.x)return mix(a.yzw,b.yzw,clamp((t-a.x)/max(b.x-a.x,0.00001),0.0,1.0));
    value=b.yzw;
  }
  return value;
}
void main(){
  if(vAlive<0.5)discard;
  vec2 center=vParticleUv-vec2(0.5);
  if(!useSpriteMap&&length(center)>0.5)discard;
  float edge=1.0-smoothstep(0.35,0.5,length(center));
  float frame=floor(mix(atlasFrameStart,atlasFrameEnd,vLifeProgress)+0.5);
  vec2 cell=vec2(mod(frame,atlasGrid.x),atlasGrid.y-1.0-floor(frame/atlasGrid.x));
  vec2 sampleUv=(vParticleUv+cell)/atlasGrid;
  vec4 sampled=useSpriteMap?texture2D(spriteMap,sampleUv):vec4(1.0,1.0,1.0,edge);
  gl_FragColor=vec4(sampleColorCurve(vLifeProgress),sampleOpacityCurve(vLifeProgress))*sampled;
}`;

function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function vector(value, fallback = { x: 0, y: 0, z: 0 }) { return new THREE.Vector3(finite(value?.x, fallback.x), finite(value?.y, fallback.y), finite(value?.z, fallback.z)); }
function numberKeyUniforms(value, fallback) {
  const frames = normalizeParticleLifecycleFrames(value, fallback);
  const keys = frames.map((frame) => new THREE.Vector2(frame.t, finite(frame.value, finite(fallback, 0))));
  while (keys.length < PARTICLE_SHADER_KEYFRAME_LIMIT) keys.push(keys.at(-1).clone());
  return { count: frames.length, keys };
}
function colorKeyUniforms(value, fallback) {
  const frames = normalizeParticleLifecycleFrames(value, fallback);
  const keys = frames.map((frame) => {
    const valueColor = new THREE.Color(frame.value ?? fallback ?? "#ffffff");
    return new THREE.Vector4(frame.t, valueColor.r, valueColor.g, valueColor.b);
  });
  while (keys.length < PARTICLE_SHADER_KEYFRAME_LIMIT) keys.push(keys.at(-1).clone());
  return { count: frames.length, keys };
}
function velocityRange(value) {
  if (value && typeof value === "object" && (value.min || value.max)) return { min: vector(value.min), max: vector(value.max, vector(value.min)) };
  const exact = vector(value); return { min: exact, max: exact };
}
function atlasInfo(descriptor){const atlas=descriptor.render.sprite?.atlas??descriptor.particle.atlas??descriptor.render.atlas??{};return{columns:Math.max(1,Math.floor(finite(atlas.columns,1))),rows:Math.max(1,Math.floor(finite(atlas.rows,1))),start:Math.max(0,finite(atlas.startFrame??atlas.frame,0)),end:Math.max(0,finite(atlas.endFrame??atlas.frame,0))};}
function boundary(descriptor) {
  const config = descriptor.simulation.boundary; const source = descriptor.source;
  const half = vector({ x: finite(config.width ?? source.width, 100) / 2, y: finite(config.height ?? source.height, 100) / 2, z: finite(config.depth ?? source.depth, 100) / 2 });
  return { min: vector(config.min, half.clone().multiplyScalar(-1)), max: vector(config.max, half), policy: ({ wrap: 1, bounce: 2, kill: 3 })[config.type] || 0 };
}
function applyTransform(object, record) { const p = resolvePosition(record.position); const r = resolveRotation(record.rotation); const s = resolveScale(record.scale); object.position.set(p.x,p.y,p.z); object.rotation.set(r.x,r.y,r.z); object.scale.set(s.x,s.y,s.z); applyVisibilityFromDescriptor(object, record); }

export function createParticleGpuComputeStore() {
  const states = new WeakMap(); const targets = new Set();
  function disposeParticleGpuCompute(points) { const state = states.get(points); if (!state) return; points.removeEventListener("removed", state.onRemoved); state.gpuCompute?.dispose?.(); states.delete(points); targets.delete(points); }
  function updateParticleGpuCompute(delta) {
    if (!(delta > 0)) return;
    for (const points of targets) {
      const state = states.get(points); if (!points?.parent || !state) { disposeParticleGpuCompute(points); continue; }
      state.elapsed += delta;
      for (const variable of [state.positionVariable, state.velocityVariable]) { variable.material.uniforms.delta.value = delta; if (variable.material.uniforms.elapsed) variable.material.uniforms.elapsed.value = state.elapsed; }
      state.gpuCompute.compute();
      points.material.uniforms.texturePosition.value = state.gpuCompute.getCurrentRenderTarget(state.positionVariable).texture;
      points.material.uniforms.textureVelocity.value = state.gpuCompute.getCurrentRenderTarget(state.velocityVariable).texture;
    }
  }
  function registerEmitter(points, state) { states.set(points, state); targets.add(points); }
  function dispose() { for (const points of [...targets]) disposeParticleGpuCompute(points); }
  return { disposeParticleGpuCompute, updateParticleGpuCompute, registerEmitter, dispose };
}

function resolveStore(scope) { return resolveRuntimeContext(scope).particleGpuCompute; }
export function disposeParticleGpuCompute(points, scope) { return resolveStore(scope ?? points).disposeParticleGpuCompute(points); }
export function updateParticleGpuCompute(delta, scope) { return resolveStore(scope).updateParticleGpuCompute(delta); }

function fillTextures(originTexture, velocityTexture, descriptor, positions, random, capacity) {
  const origins = originTexture.image.data; const velocities = velocityTexture.image.data; const velocity = velocityRange(descriptor.particle.velocity);
  const rate = descriptor.emission.rate > 0 ? descriptor.emission.rate : descriptor.emission.count / Math.max(descriptor.emission.duration, 1);
  for (let i = 0; i < capacity; i++) {
    const o = i * 4;
    if (i >= descriptor.emission.count) { origins[o] = origins[o+1] = origins[o+2] = 0; origins[o+3] = -1; velocities[o] = velocities[o+1] = velocities[o+2] = 0; velocities[o+3] = -1; continue; }
    origins[o] = positions[i*3]; origins[o+1] = positions[i*3+1]; origins[o+2] = positions[i*3+2];
    const lifetime = sampleRange(descriptor.particle.lifetime, random); origins[o+3] = Number.isFinite(lifetime) ? lifetime : 0;
    velocities[o] = velocity.min.x + (velocity.max.x - velocity.min.x) * random(); velocities[o+1] = velocity.min.y + (velocity.max.y - velocity.min.y) * random(); velocities[o+2] = velocity.min.z + (velocity.max.z - velocity.min.z) * random();
    velocities[o+3] = descriptor.emission.mode === "continuous" ? -i / Math.max(rate, 1e-9) : 0;
  }
  originTexture.needsUpdate = true; velocityTexture.needsUpdate = true;
}

function referenceGeometry(count, width, height) {
  const position = new Float32Array(count * 3); const reference = new Float32Array(count * 2);
  for (let i=0;i<count;i++){reference[i*2]=((i%width)+0.5)/width;reference[i*2+1]=(Math.floor(i/width)+0.5)/height;}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(position,3));geometry.setAttribute("reference",new THREE.BufferAttribute(reference,2));trackDisposableResource(geometry);return geometry;
}

function billboardReferenceGeometry(count, width, height) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.5,-0.5,0, 0.5,-0.5,0, 0.5,0.5,0, -0.5,0.5,0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0,0, 1,0, 1,1, 0,1], 2));
  const reference = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { reference[i*2]=((i%width)+0.5)/width; reference[i*2+1]=(Math.floor(i/width)+0.5)/height; }
  geometry.setAttribute("reference", new THREE.InstancedBufferAttribute(reference, 2));
  geometry.instanceCount = count;
  trackDisposableResource(geometry);
  return geometry;
}

function renderMaterial(descriptor, billboard = false) {
  const size=numberKeyUniforms(descriptor.particle.sizeOverLife??descriptor.render.sizeOverLife,descriptor.render.size);
  const opacity=numberKeyUniforms(descriptor.particle.opacityOverLife??descriptor.render.opacityOverLife,descriptor.render.opacity);
  const colorCurve=colorKeyUniforms(descriptor.particle.colorOverLife??descriptor.render.colorOverLife,descriptor.render.color);
  const atlas=atlasInfo(descriptor);
  const material=new THREE.ShaderMaterial({uniforms:{texturePosition:{value:null},textureVelocity:{value:null},sizeKeyCount:{value:size.count},sizeKeys:{value:size.keys},sizeAttenuation:{value:descriptor.render.sizeAttenuation},rotationRange:{value:new THREE.Vector2(descriptor.particle.rotation.min,descriptor.particle.rotation.max)},angularVelocityRange:{value:new THREE.Vector2(descriptor.particle.angularVelocity.min,descriptor.particle.angularVelocity.max)},colorKeyCount:{value:colorCurve.count},colorKeys:{value:colorCurve.keys},opacityKeyCount:{value:opacity.count},opacityKeys:{value:opacity.keys},spriteMap:{value:null},useSpriteMap:{value:false},atlasGrid:{value:new THREE.Vector2(atlas.columns,atlas.rows)},atlasFrameStart:{value:atlas.start},atlasFrameEnd:{value:atlas.end}},vertexShader:billboard?BILLBOARD_RENDER_VERTEX:RENDER_VERTEX,fragmentShader:billboard?BILLBOARD_RENDER_FRAGMENT:RENDER_FRAGMENT,transparent:descriptor.render.transparent,depthWrite:descriptor.render.depthWrite,depthTest:descriptor.render.depthTest,blending:resolvePointsBlending(descriptor.render.blending)});trackDisposableResource(material);return material;
}

function finishGpuEmitter(descriptor, scene, renderer, positions, random) {
  const count=descriptor.emission.count; const compute=descriptor.simulation.compute&&typeof descriptor.simulation.compute==="object"?descriptor.simulation.compute:{};
  const {width,height}=resolveParticleTextureSize(count,compute); const maxTextureSize=finite(renderer.capabilities?.maxTextureSize,Infinity);
  if(width*height<count){const error=new Error(`Particle compute texture ${width}x${height} cannot store ${count} particles`);error.code="E_PARTICLE_COMPUTE_CAPACITY";throw error;}
  if(width>maxTextureSize||height>maxTextureSize){const error=new Error(`Particle compute texture ${width}x${height} exceeds hardware maxTextureSize ${maxTextureSize}`);error.code="E_PARTICLE_HARDWARE_LIMIT";throw error;}
  const gpu=new GPUComputationRenderer(width,height,renderer);trackDisposableResource(gpu);
  const origin=gpu.createTexture();const initialVelocity=gpu.createTexture();fillTextures(origin,initialVelocity,descriptor,positions,random,width*height);
  const positionVariable=gpu.addVariable("texturePosition",POSITION_SHADER,origin);const velocityVariable=gpu.addVariable("textureVelocity",VELOCITY_SHADER,initialVelocity);
  gpu.setVariableDependencies(positionVariable,[positionVariable,velocityVariable]);gpu.setVariableDependencies(velocityVariable,[positionVariable,velocityVariable]);
  const bounds=boundary(descriptor);const acceleration=vector(descriptor.simulation.acceleration).add(vector(descriptor.simulation.gravity)).add(vector(descriptor.particle.acceleration));
  Object.assign(positionVariable.material.uniforms,{delta:{value:0},textureOrigin:{value:origin},boundMin:{value:bounds.min},boundMax:{value:bounds.max},boundaryPolicy:{value:bounds.policy},loopParticles:{value:descriptor.emission.loop}});
  const attractors=descriptor.simulation.attractors.slice(0,PARTICLE_ATTRACTOR_LIMIT).map((item)=>new THREE.Vector4(finite(item.position?.x,0),finite(item.position?.y,0),finite(item.position?.z,0),finite(item.strength,1)));while(attractors.length<PARTICLE_ATTRACTOR_LIMIT)attractors.push(new THREE.Vector4());
  const attractorMaxDistances=descriptor.simulation.attractors.slice(0,PARTICLE_ATTRACTOR_LIMIT).map((item)=>{const distance=Number(item.maxDistance);return Number.isFinite(distance)&&distance>0?distance:0;});while(attractorMaxDistances.length<PARTICLE_ATTRACTOR_LIMIT)attractorMaxDistances.push(0);
  Object.assign(velocityVariable.material.uniforms,{delta:{value:0},elapsed:{value:0},textureOrigin:{value:origin},textureInitialVelocity:{value:initialVelocity},acceleration:{value:acceleration},drag:{value:descriptor.simulation.drag},noiseStrength:{value:descriptor.simulation.noise.strength},noiseFrequency:{value:descriptor.simulation.noise.frequency},boundaryPolicy:{value:bounds.policy},boundMin:{value:bounds.min},boundMax:{value:bounds.max},restitution:{value:finite(descriptor.simulation.boundary.restitution,1)},loopParticles:{value:descriptor.emission.loop},attractorCount:{value:Math.min(descriptor.simulation.attractors.length,PARTICLE_ATTRACTOR_LIMIT)},attractors:{value:attractors},attractorMaxDistances:{value:attractorMaxDistances}});
  const initError=gpu.init();if(initError){gpu.dispose?.();const error=new Error(`[particleEmitter] webgl-compute init failed: ${initError}`);error.code="E_PARTICLE_BACKEND_INIT_FAILED";throw error;}
  const billboard=descriptor.render.type==="billboard";const geometry=billboard?billboardReferenceGeometry(count,width,height):referenceGeometry(count,width,height);const material=renderMaterial(descriptor,billboard);material.uniforms.texturePosition.value=gpu.getCurrentRenderTarget(positionVariable).texture;material.uniforms.textureVelocity.value=gpu.getCurrentRenderTarget(velocityVariable).texture;
  const points=billboard?new THREE.Mesh(geometry,material):new THREE.Points(geometry,material);trackDisposableResource(points);points.frustumCulled=false;points.name=descriptor.name||"particle-emitter-gpu";setUserDataObjJson(points,descriptor);applyTransform(points,descriptor);scene.add(points);
  const spriteUrl=descriptor.render.sprite?.url??descriptor.render.sprite??descriptor.render.map;if(typeof spriteUrl==="string"&&spriteUrl.trim()){new THREE.TextureLoader(loadingManager).load(resolvePublicAssetUrl(spriteUrl),(texture)=>{if(!points.parent){texture.dispose();return;}trackDisposableResource(texture);material.uniforms.spriteMap.value=texture;material.uniforms.useSpriteMap.value=true;});}
  const state={gpuCompute:gpu,positionVariable,velocityVariable,elapsed:0,onRemoved:()=>disposeParticleGpuCompute(points)};points.addEventListener("removed",state.onRemoved);resolveStore(scene).registerEmitter(points,state);return registerObject(points,descriptor);
}

export function deployParticleGpuEmitter(record, scene, renderer, ctx = {}) {
  if (!record || !scene) return null;
  if (!renderer?.capabilities?.isWebGL2) {
    const error=new Error("particle simulation webgl-compute requires a WebGL2 renderer");error.code="E_PARTICLE_WEBGL2_REQUIRED";throw error;
  }
  const descriptor=normalizeParticleEmitterV2(record,{defaultBackend:"webgl-compute"});assertParticleCountWithinBudget(descriptor,ctx.particleBudget||ctx);
  const random=createSeededRandom(descriptor.emission.seed);const sampled=sampleParticleSourcePositions(descriptor.source,descriptor.emission.count,{random,seed:descriptor.emission.seed,resolveMesh:(id)=>getObjectByThreeJsonId(id,scene),targetMatrixWorld:buildParticleEmitterWorldMatrix(descriptor,scene)});
  if(sampled&&typeof sampled.then==="function")return sampled.then((positions)=>finishGpuEmitter(descriptor,scene,renderer,positions,random));
  try{return finishGpuEmitter(descriptor,scene,renderer,sampled,random);}catch(error){log.warn("[particleEmitter] GPU compute creation failed:",error);throw error;}
}

export function _resetParticleGpuComputeForTests(scope) { resolveStore(scope).dispose(); }
