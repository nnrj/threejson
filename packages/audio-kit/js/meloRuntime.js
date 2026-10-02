import { createSherpaOnnxAudioProducer } from "./sherpa.js";
import { getBuiltinAudioModels } from "./modelCatalog.js";

/** Adapt the pinned Emscripten build into a module factory. Remove its demo data
 * preload only: Melo resources come exclusively from hash-verified local cache.
 */
export function adaptMeloRuntime(source) {
  const head = 'var Module=typeof Module!="undefined"?Module:{};';
  const begin = source.indexOf('if(!Module["expectedDataFileDownloads"])');
  const end = source.indexOf('var arguments_=[];');
  if (!source.startsWith(head) || begin < 0 || end <= begin || !source.includes('remote_package_size:204108836})})();var arguments_=[];')) throw new Error("Unsupported pinned sherpa runtime layout.");
  const code = source.slice(head.length, begin) + source.slice(end);
  return `export default function(Module){return new Promise((resolve,reject)=>{Module.onRuntimeInitialized=()=>{Module.FS=FS;resolve(Module);};Module.onAbort=reason=>reject(new Error(String(reason)));${code}\n});}`;
}
export async function createMeloEngine({ files }) {
  const manifest = getBuiltinAudioModels()[0];
  for (const spec of manifest.files) if (!(files[spec.role] instanceof Blob) || files[spec.role].size !== spec.bytes) throw new Error(`Missing local speech file: ${spec.role}`);
  const loadRuntime = async () => {
    const runtimeUrl = URL.createObjectURL(new Blob([adaptMeloRuntime(await files.runtimeJs.text())], { type: "text/javascript" }));
    const apiUrl = URL.createObjectURL(new Blob([await files.runtimeApi.text(), "\nexport {createOfflineTts};"], { type: "text/javascript" }));
    try {
      const [runtime, api] = await Promise.all([import(/* @vite-ignore */ runtimeUrl), import(/* @vite-ignore */ apiUrl)]);
      const Module = await runtime.default({ wasmBinary: new Uint8Array(await files.runtimeWasm.arrayBuffer()),
        // Emscripten calls locateFile even when wasmBinary already supplies all
        // bytes. Return a non-network sentinel; no fetch is needed or allowed.
        locateFile() { return "data:application/wasm;base64,"; } });
      return { Module, createOfflineTts: api.createOfflineTts };
    } finally { URL.revokeObjectURL(runtimeUrl); URL.revokeObjectURL(apiUrl); }
  };
  return createSherpaOnnxAudioProducer({ loadRuntime, model: manifest,
    modelManager: { acquire: async () => ({ manifest: { ...manifest, files: manifest.files.filter(f => !f.runtime) }, files, release() {} }) },
    config: { model: { vits: { model: { file: "model" }, tokens: { file: "tokens" }, lexicon: { file: "lexicon" }, noiseScale: .6, noiseScaleW: .8, lengthScale: 1 }, numThreads: 1, debug: 0, provider: "cpu" },
      ruleFsts: { files: ["date", "number", "phone", "heteronym"] }, maxNumSentences: 1, silenceScale: .2 } });
}
