/** Compute geometry independently of the scene renderer. Explicit, host-owned WebGPU device. */
import { modelingError } from "../../core/modeling/registry.js";

export const MODELING_DEFORM_WGSL = `
struct Config { origin: vec3<f32>, amount: f32, count: u32, mode: u32, rowWidth: u32, padding: u32 }
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read_write> positionsOut: array<f32>;
@group(0) @binding(2) var<uniform> config: Config;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let i = invocation.x + invocation.y * config.rowWidth;
  if (i >= config.count) { return; }
  var p = vec3<f32>(source[i*3u], source[i*3u+1u], source[i*3u+2u]) - config.origin;
  if (config.mode == 0u) {
    let a = config.amount * p.y; let c = cos(a); let s = sin(a);
    p = vec3<f32>(p.x*c - p.z*s, p.y, p.x*s + p.z*c);
  } else if (config.mode == 1u) {
    let scale = 1.0 + config.amount * p.y; p.x *= scale; p.z *= scale;
  } else if (config.amount != 0.0) {
    let a = config.amount * p.y; let r = 1.0/config.amount;
    p = vec3<f32>((p.x+r)*cos(a)-r, (p.x+r)*sin(a), p.z);
  }
  p += config.origin;
  positionsOut[i*3u] = p.x; positionsOut[i*3u+1u] = p.y; positionsOut[i*3u+2u] = p.z;
}`;

export async function createWebgpuModelingBackend({ device, gpu = globalThis.navigator?.gpu } = {}) {
  let ownsDevice = false, disposed = false, lost = false, queue = Promise.resolve();
  if (!device) {
    const adapter = await gpu?.requestAdapter();
    if (!adapter) return null; // compiler auto mode retains the CPU reference implementation
    device = await adapter.requestDevice(); ownsDevice = true;
  }
  device.lost?.then(() => { lost = true; });
  let pipeline;
  try {
    const module = device.createShaderModule({ code: MODELING_DEFORM_WGSL, label: "ThreeJSON modeling deformation" });
    const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === "error");
    if (errors.length) throw modelingError("MODEL_GPU_SHADER", errors.map((m) => m.message).join("\n"));
    pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
  } catch (error) { if (ownsDevice) device.destroy(); throw error; }
  async function deform({ inputs, params, signal }) {
      if (disposed) throw modelingError("MODEL_GPU_DISPOSED", "GPU modeling backend has been disposed.");
      if (lost) throw modelingError("MODEL_GPU_DEVICE_LOST", "GPU device was lost; CPU calculation remains available.");
      signal?.throwIfAborted();
      const { finishDeformedMesh, readModelingMeshPositions } = await import("../../core/modeling/meshOperators.js");
      const mesh = inputs.mesh, positions = readModelingMeshPositions(mesh), count = positions.length / 3, size = positions.byteLength;
      const maxGroups = device.limits.maxComputeWorkgroupsPerDimension;
      if (size > device.limits.maxStorageBufferBindingSize || size > device.limits.maxBufferSize || Math.ceil(count / 64) > maxGroups * maxGroups) {
        // This is an actual device limit, never a silent reduction in vertex count.
        throw modelingError("MODEL_GPU_LIMIT", "Mesh exceeds this GPU's storage/dispatch capability; select the CPU backend.");
      }
      if (!count) return finishDeformedMesh(mesh, positions);
      const buffers = [];
      const makeBuffer = (descriptor) => { const buffer = device.createBuffer(descriptor); buffers.push(buffer); return buffer; };
      const abort = () => buffers.forEach((b) => b.destroy());
      signal?.addEventListener("abort", abort, { once: true });
      device.pushErrorScope("validation"); device.pushErrorScope("out-of-memory");
      let output, failure, readback, memoryCheck, validationCheck;
      try {
        const source = makeBuffer({ size, usage: 128 | 8 }), target = makeBuffer({ size, usage: 128 | 4 }); // STORAGE/COPY_DST; STORAGE/COPY_SRC
        readback = makeBuffer({ size, usage: 1 | 8 });
        const uniform = makeBuffer({ size: 32, usage: 64 | 8 }); // MAP_READ; UNIFORM
        const config = new ArrayBuffer(32), floats = new Float32Array(config), ints = new Uint32Array(config);
        floats.set(params.origin || [0, 0, 0]); floats[3] = params.amount; ints[4] = count;
        ints[5] = { twist: 0, taper: 1, bend: 2 }[params.mode];
        const x = Math.min(maxGroups, Math.ceil(count / 64)), y = Math.ceil(count / (x * 64)); ints[6] = x * 64;
        device.queue.writeBuffer(source, 0, positions); device.queue.writeBuffer(uniform, 0, config);
        const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [source, target, uniform].map((buffer, binding) => ({ binding, resource: { buffer } })) });
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(x, y); pass.end();
        encoder.copyBufferToBuffer(target, 0, readback, 0, size); device.queue.submit([encoder.finish()]);
      } catch (error) { failure = error; }
      finally {
        // Pop synchronously before yielding: scopes belong to the shared device, not this task.
        memoryCheck = device.popErrorScope(); validationCheck = device.popErrorScope();
      }
      try {
        if (!failure) {
          await readback.mapAsync(1); signal?.throwIfAborted();
          output = new Float32Array(readback.getMappedRange().slice(0)); readback.unmap();
        }
      } catch (error) { failure ||= error; }
      finally { signal?.removeEventListener("abort", abort); for (const buffer of buffers) buffer.destroy(); }
      const [memoryError, validationError] = await Promise.all([memoryCheck, validationCheck]);
      signal?.throwIfAborted();
      if (failure || memoryError || validationError) throw modelingError("MODEL_GPU_COMPUTE", String((failure || memoryError || validationError).message));
      return finishDeformedMesh(mesh, output);
  }
  return {
    deform(request) {
      const result = queue.then(() => deform(request));
      queue = result.catch(() => {});
      return result;
    },
    dispose() { if (disposed) return; disposed = true; if (ownsDevice) device.destroy(); }
  };
}
