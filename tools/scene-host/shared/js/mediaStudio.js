/** Explicit optional application feature; never loaded by ordinary scene startup. */
async function loadMediaHost() {
  try { return await import("@threejson/host-kit/js/mediaStudio.js"); }
  catch (error) { throw new Error("Media features need the optional host-kit, media-kit and audio-kit deployment.", { cause: error }); }
}
export const loadMediaKit = async () => (await loadMediaHost()).loadMediaKit();
export const packMediaDocument = async (...args) => (await loadMediaHost()).packMediaDocument(...args);
export const createLocalNarrationHost = async () => (await loadMediaHost()).createLocalNarrationHost();
export const createMediaAudioPlayback = async (...args) => (await loadMediaHost()).createMediaAudioPlayback(...args);
export const chooseMediaShot = async (...args) => (await loadMediaHost()).chooseMediaShot(...args);
export async function openSceneMediaStudio(source, options) {
  let module;
  try { module = await import("@threejson/host-kit/js/mediaStudio.js"); }
  catch (error) { throw new Error("Media studio is unavailable. Deploy the optional host-kit, media-kit and audio-kit modules.", { cause: error }); }
  return module.openSceneMediaStudio(source, options);
}
