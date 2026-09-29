import { mkdir, readFile, readdir, open, unlink, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
export function defaultAudioModelCache() {
  return process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(homedir(),"AppData/Local"),"ThreeJSON/Cache/audio-models") : path.join(process.env.XDG_CACHE_HOME || path.join(homedir(),".cache"),"threejson/audio-models");
}
export async function createNodeAudioModelStorage(directory = defaultAudioModelCache()) {
  const root = path.resolve(directory); await mkdir(root,{recursive:true});
  const resolve = (key) => { if (!/^(?:file|manifest)-[A-Za-z0-9_.%\-]+$/.test(key) || key.includes("..")) throw new Error("Invalid model storage key."); return path.join(root,key); };
  const getBlob = async(key)=>{try{return new Blob([await readFile(resolve(key))]);}catch(error){if(error.code==="ENOENT")return null;throw error;}};
  return {
    kind:"filesystem", directory:root, getBlob,
    async getJson(key){const blob=await getBlob(key);return blob?JSON.parse(await blob.text()):null;},
    async putJson(key,value){const file=resolve(key), temporary=`${file}-${crypto.randomUUID()}`;const handle=await open(temporary,"wx");try{await handle.writeFile(JSON.stringify(value));}finally{await handle.close();}await rename(temporary,file);},
    async createWriter(key){const file=resolve(key), handle=await open(file,"wx");let closed=false;return{async write(chunk){await handle.writeFile(chunk);},async close(){if(!closed){closed=true;await handle.close();}},async abort(){if(!closed){closed=true;await handle.close();}}};},
    async remove(key){try{await unlink(resolve(key));}catch(error){if(error.code!=="ENOENT")throw error;}}, list:()=>readdir(root)
  };
}
