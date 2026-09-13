# Portable archive resources

`.tjz` still contains a JSON entry, manifest and ordinary files. `assetLibrary`,
`lib://` and `pack://` remain supported; no R2 or server dependency is introduced.

On import, archive paths are namespaced as
`pack://_archive/<SHA-256 of archive bytes>/<file path>`. Portable file entries live
in the scene or object `assetLibrary`:

```json
{
  "threeJsonId": "archive:_archive/<hash>/assets/image.png",
  "assetKind": "file",
  "archivePath": "_archive/<hash>/assets/image.png",
  "url": "data:image/png;base64,...",
  "byteLength": 1234
}
```

`file` is a storage entry, not a material/geometry preset. Object imports may keep
their own asset libraries. The runtime indexes these entries without mutating the
authoring document. Textures, GLTF child files, BufferGeometry binary attributes,
audio, fonts and event-script loaders resolve references within the owning scene.

The portable JSON form has base64 size overhead. `.tjz` export extracts those bytes
back into archive files and leaves stable references in JSON, without embedding a
second base64 copy. `preserve` retains existing embedded files; `tryPack` additionally
tries eligible remote resources. These policies do not change authoritative remote
URLs unless the user requests packing. Browser cache is acceleration, not the only
copy of imported archive bytes.

No `blob:` URL is persisted by archive import. Disposing an old runtime therefore
cannot invalidate another scene's imported resources. Two archives with identical
internal filenames cannot collide. Missing bytes and conflicting file identities
produce explicit diagnostics; arbitrary generated URLs are never substituted.

This does not recover bytes already lost from an old saved `blob:`-only scene.
Reimport the original `.tjz` or restore its authoritative resource URL in that case.
Third-party TSL modules with relative module dependencies still require a host
module resolver; ordinary file mapping is not an ESM dependency bundler.

Background/environment replacement owns each slot separately. A failed resource
retains its previous value and reports `BACKDROP_RESOURCE_FAILED`. SceneSession
replacement with an existing viewport uses strict backdrop preparation, preserving
the whole previous viewport on failure. Hosts can explicitly choose
`backdropFailurePolicy: "preserve" | "error"`.
