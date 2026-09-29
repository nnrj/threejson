/** Explicit optional application feature; never loaded by ordinary scene startup. */
export async function openSceneMediaStudio(source, options) {
  let module;
  try { module = await import("@threejson/host-kit/js/mediaStudio.js"); }
  catch (error) { throw new Error("Media studio is unavailable. Deploy the optional host-kit, media-kit and audio-kit modules.", { cause: error }); }
  return module.openSceneMediaStudio(source, options);
}
