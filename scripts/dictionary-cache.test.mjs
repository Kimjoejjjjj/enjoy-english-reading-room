import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("dictionary cache preserves output and recovers from invalid or incomplete generation", { timeout: 180000 }, async () => {
  await mkdir(path.join(root, ".tmp"), { recursive: true });
  const fixture = await mkdtemp(path.join(root, ".tmp", "dictionary-cache-"));
  const dictionary = path.join(fixture, "vendor", "dictionaries");
  const generated = path.join(dictionary, "generated");
  const script = path.join(fixture, "build.mjs");
  const manifestPath = path.join(generated, "manifest.json");
  const shard = path.join(generated, "entries-a.json");
  const run = () => spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8", timeout: 30000 });
  const success = (cached) => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, cached ? /skipped generation/ : /Prepared Open English WordNet/);
  };
  try {
    await mkdir(dictionary, { recursive: true });
    await copyFile(path.join(root, "scripts", "build-oewn-index.mjs"), script);
    await copyFile(path.join(root, "vendor", "dictionaries", "english-wordnet-2025-json.zip"), path.join(dictionary, "english-wordnet-2025-json.zip"));
    success(false);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(Object.keys(manifest.files).length, 54);
    const original = await readFile(shard);
    const before = (await stat(shard)).mtimeMs;
    success(true);
    assert.equal((await stat(shard)).mtimeMs, before);

    await rm(shard);
    success(false);
    assert.deepEqual(await readFile(shard), original);
    // Same-length corruption must also invalidate the cache.
    const damaged = Buffer.from(original);
    damaged[10] ^= 1;
    await writeFile(shard, damaged);
    success(false);
    assert.deepEqual(await readFile(shard), original);

    await writeFile(script, `${await readFile(script, "utf8")}\n// fingerprint test\n`);
    success(false);
    const updated = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.notEqual(updated.generatorSha256, manifest.generatorSha256);
    assert.deepEqual(updated.files, manifest.files);

    await writeFile(manifestPath, "null");
    success(false);
    // Force a write failure after the completion marker has been invalidated.
    await writeFile(manifestPath, "{}");
    await rm(shard);
    await mkdir(shard);
    assert.notEqual(run().status, 0);
    await assert.rejects(readFile(manifestPath), { code: "ENOENT" });
    await rm(shard, { recursive: true });
    success(false);
    for (const [name, expected] of Object.entries(manifest.files)) {
      assert.equal(hash(await readFile(path.join(generated, name))), expected);
    }
    success(true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
