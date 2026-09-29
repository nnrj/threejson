/** Optional binding to the upstream sherpa-onnx WASM API. Supply a verified runtime
 * and matching model/config; no generic ONNX guessing or bundled model downloads.
 * Run inside createWorkerAudioProducer for cancellable, non-blocking synthesis. */
export function createSherpaOnnxAudioProducer({ loadRuntime, modelManager, model, config, capabilities = {} }) {
  if (typeof loadRuntime !== "function" || !modelManager?.acquire || !config) throw new TypeError("Sherpa needs a runtime factory, installed model manager and explicit config.");
  let lease, runtime, engine, directory, busy = false, disposed = false;
  const paths = new Map(), directories = new Set();
  const clear = () => {
    engine?.free?.(); engine = null;
    for (const path of paths.values()) { try { runtime?.Module?.FS?.unlink(path); } catch {} } paths.clear();
    for (const path of [...directories].sort((a,b)=>b.length-a.length)) { try { runtime?.Module?.FS?.rmdir(path); } catch {} } directories.clear();
    lease?.release(); lease = null; runtime = null; directory = null;
  };
  async function initialize() {
    lease = await modelManager.acquire(model);
    runtime = await loadRuntime();
    if (!runtime?.Module?.FS || typeof runtime.createOfflineTts !== "function") throw new Error("Incompatible sherpa-onnx WASM runtime.");
    directory = `/threejson-${crypto.randomUUID()}`; runtime.Module.FS.mkdir(directory); directories.add(directory);
    for (const file of lease.manifest.files) {
      const parts = String(file.path || file.role).split("/");
      if (parts.some((part)=>!part || part==="." || part===".." || !/^[A-Za-z0-9_.-]+$/.test(part))) throw new Error("Invalid sherpa model file path.");
      let parent=directory;
      for(const part of parts.slice(0,-1)){parent+=`/${part}`;if(!directories.has(parent)){runtime.Module.FS.mkdir(parent);directories.add(parent);}}
      const path=`${directory}/${parts.join("/")}`;paths.set(file.role,path);
      runtime.Module.FS.writeFile(path, new Uint8Array(await lease.files[file.role].arrayBuffer()));
    }
    const resolve = (value) => {
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && value.file) {
        if (!lease.files[value.file]) throw new Error(`Missing sherpa config file role: ${value.file}`);
        return paths.get(value.file);
      }
      if (value && typeof value === "object" && Object.keys(value).length===1 && value.directory) { const path=`${directory}/${value.directory}`;if(!directories.has(path))throw new Error("Model directory is not installed.");return path; }
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolve(item)]));
      return value;
    };
    engine = runtime.createOfflineTts(runtime.Module, resolve(config));
    if (!engine?.handle || !(engine.sampleRate > 0)) throw new Error("Sherpa failed to initialize this model/config.");
  }
  return {
    capabilities: { local: true, kind: "tts", output: "pcm", ...capabilities },
    async synthesize(recipe, context = {}) {
      if (disposed || busy) throw new Error(disposed ? "TTS is disposed." : "TTS is busy.");
      if (typeof recipe.text !== "string" || !recipe.text.trim() || !Number.isFinite(recipe.speed ?? 1) || (recipe.speed ?? 1) <= 0) throw new TypeError("TTS needs text and a positive speed.");
      busy = true;
      try {
        context.signal?.throwIfAborted();
        if (!engine) await initialize(); context.signal?.throwIfAborted();
        const result = engine.generate({ text: recipe.text, sid: recipe.speaker ?? 0, speed: recipe.speed ?? 1 });
        context.signal?.throwIfAborted();
        return { sampleRate: result.sampleRate, channels: [result.samples] };
      } catch(error) { clear(); throw error; } finally { busy = false; if(disposed)clear(); }
    },
    dispose() { disposed = true; if (!busy) clear(); }
  };
}
