import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { Header } from "tar";
import {
  comparePackageTarball, diffPackageContents, formatPackageDifferences, readPackageContents
} from "../tools/dev/release/packageContents.mjs";

function archive(entries, { time = 0, uid = 0, eof = true } = {}) {
  const blocks = [];
  for (const item of [{ path: "package/package.json", data: '{"name":"fixture","version":"1.0.0"}' }, ...entries]) {
    const data = Buffer.from(item.data || "");
    const header = new Header({ path: item.path, type: item.type || "File", linkpath: item.linkpath,
      size: data.length, mode: item.mode ?? 0o644, mtime: new Date(time), uid, gid: uid });
    assert.equal(header.encode(), false);
    blocks.push(header.block, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  if (eof) blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function metadata(bytes) {
  return { integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}

function inspect(bytes, options = {}) {
  return readPackageContents(Readable.from([bytes]), metadata(bytes), options);
}

test("package comparison ignores tar order, ownership and timestamps, but checks raw file bytes", async () => {
  const entries = [{ path: "package/a.bin", data: Buffer.from([0, 128, 255]) }, { path: "package/empty" }];
  const a = archive(entries);
  const b = archive([...entries].reverse(), { time: 1_000_000, uid: 123 });
  assert.notEqual(metadata(a).integrity, metadata(b).integrity);
  assert.deepEqual(diffPackageContents(await inspect(a), await inspect(b)), {
    equal: true, added: [], removed: [], modified: []
  });
});

test("file diff catches additions, removals, binary changes, line endings and executable bits", async () => {
  const published = archive([
    { path: "package/bin", data: Buffer.from([0x80]) },
    { path: "package/text", data: "a\n" },
    { path: "package/cli", data: "run", mode: 0o644 },
    { path: "package/removed" }, { path: "package/size", data: "1" }
  ]);
  const local = archive([
    { path: "package/bin", data: Buffer.from([0x81]) },
    { path: "package/text", data: "a\r\n" },
    { path: "package/cli", data: "run", mode: 0o755 },
    { path: "package/added" }, { path: "package/size", data: "11" }
  ]);
  const diff = diffPackageContents(await inspect(local), await inspect(published));
  assert.deepEqual(diff, { equal: false, added: ["added"], removed: ["removed"], modified: ["bin", "cli", "size", "text"] });
  assert.match(formatPackageDifferences(diff), /新增 1，删除 1，修改 4/);
  assert.match(formatPackageDifferences(diff), /~ bin/);
});

test("comparison rejects unverified and malformed archives", async () => {
  const bytes = archive([]);
  await assert.rejects(readPackageContents(Readable.from([bytes]), metadata(Buffer.from("not the archive"))), /integrity mismatch/);
  await assert.rejects(readPackageContents(Readable.from([bytes]), {}), /lacks a usable/);
  await assert.rejects(readPackageContents(Readable.from([bytes]), { integrity: "unknown-hash" }), /Unsupported/);
  await assert.rejects(inspect(Buffer.from("not tar")), /archive|Archive/i);
  await assert.rejects(inspect(archive([], { eof: false })), /EOF/);
  await assert.rejects(inspect(bytes.subarray(0, bytes.length - 20)));
});

test("package comparison accepts verified legacy SHA1 metadata", async () => {
  const bytes = archive([]);
  const result = await readPackageContents(Readable.from([bytes]), { shasum: createHash("sha1").update(bytes).digest("hex") });
  assert.ok(result.has("package.json"));
});

test("unsafe, duplicate, linked and colliding entries fail closed without extraction", async () => {
  for (const name of ["/package/absolute", "package/../outside", "package/a/./b", "package/a//b", "other/file", "package/C:drive"]) {
    await assert.rejects(inspect(archive([{ path: name }])), /Unsafe/);
  }
  await assert.rejects(inspect(archive([{ path: "package/duplicate" }, { path: "package/duplicate" }])), /Duplicate/);
  for (const type of ["SymbolicLink", "Link"]) {
    await assert.rejects(inspect(archive([{ path: "package/link", type, linkpath: "package/package.json" }])), /Unsupported/);
  }
  await assert.rejects(inspect(archive([{ path: "package/a" }, { path: "package/a/b" }])), /collision/);
});

test("archive size and entry budgets are enforced", async () => {
  const bytes = archive([{ path: "package/a", data: "test" }]);
  await assert.rejects(inspect(bytes, { maxEntries: 1 }), /entry limit/);
  await assert.rejects(inspect(bytes, { maxUnpackedBytes: 1 }), /size limit/);
  await assert.rejects(inspect(bytes, { maxArchiveBytes: 1 }), /size limit/);
});

test("optional remote comparison verifies both archives and rejects failed downloads", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "threejson-release-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const local = archive([{ path: "package/a", data: "identical" }]);
  const remote = archive([{ path: "package/a", data: "identical" }], { time: 1_000 });
  const file = path.join(directory, "local.tgz");
  fs.writeFileSync(file, local);
  const published = { ...metadata(remote), tarball: "https://registry.example.invalid/package.tgz" };
  let requests = 0;
  const result = await comparePackageTarball(file, metadata(local), published, {
    fetchImpl: async (_url, options) => {
      requests++;
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      return new Response(remote);
    }
  });
  assert.equal(requests, 1);
  assert.equal(result.equal, true);
  await assert.rejects(comparePackageTarball(file, metadata(local), published, {
    fetchImpl: async () => new Response("missing", { status: 404 })
  }), /HTTP 404/);
  await assert.rejects(comparePackageTarball(file, metadata(local), published, {
    fetchImpl: async () => new Response(local)
  }), /integrity mismatch/);
  await assert.rejects(comparePackageTarball(file, metadata(local), { ...published, tarball: "http://localhost/package.tgz" }), /HTTPS/);
});
