import test from "node:test";
import assert from "node:assert/strict";
import { createStagedMediaFile, saveCompletedMediaFile } from "../packages/host-kit/js/mediaExportFile.js";

test("unavailable staging falls back, but disk quota failures stay visible", async () => {
  assert.equal(await createStagedMediaFile({}), null);
  assert.equal(await createStagedMediaFile({getDirectory(){throw new DOMException("blocked", "SecurityError");}}), null);
  await assert.rejects(createStagedMediaFile({getDirectory(){throw new DOMException("full", "QuotaExceededError");}}), {name:"QuotaExceededError"});
});
test("staging owns only its unique temporary file and rejects empty output", async () => {
  let created, removed = [], file = new Blob([]);
  const directory = {getFileHandle(name){created=name;return {getFile:()=>file,createWritable:()=>"stream"};}, removeEntry(name){removed.push(name);} };
  const staged = await createStagedMediaFile({getDirectory:()=>({getDirectoryHandle:(name)=>{assert.equal(name,"threejson-media-exports");return directory;}})});
  await assert.rejects(staged.getFile(), {code:"MEDIA_EMPTY_OUTPUT"});
  file = new Blob(["finished"]);assert.equal((await staged.getFile()).size, 8);
  assert.equal(staged.openWritable(), "stream");await staged.dispose();await staged.dispose();
  assert.deepEqual(removed, [created]);assert.match(created, /^[\da-f-]+\.tmp$/);
});
test("failed save retains completed bytes for retry without rerendering", async () => {
  const file = new Blob(["encoded-video"]); let committed = 0, saved;
  await assert.rejects(saveCompletedMediaFile(file, {createWritable:()=>{throw new Error("disk unavailable");}}), /disk unavailable/);
  const handle = {createWritable:()=>new WritableStream({write(data){saved=data;},close(){committed++;}}),getFile:()=>new Blob([saved])};
  await saveCompletedMediaFile(file,handle);
  assert.equal(committed,1);assert.equal(await new Blob([saved]).text(),"encoded-video");
  const controller=new AbortController();controller.abort();
  await assert.rejects(saveCompletedMediaFile(file,handle,{signal:controller.signal}), {name:"AbortError"});
  assert.equal(committed,1);
});
