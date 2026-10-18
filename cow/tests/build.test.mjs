import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../build.mjs";

const expectedFiles = ["arcade.html", "assets/tibo-avatar.jpg", "civilization-page.css", "civilization/bootstrap.js", "civilization/engine.js", "civilization/forecast-view.js", "civilization/reset-feed.js", "civilization/scene.js", "civilization/widget.css", "civilization/widget.js", "details.css", "game.js", "index.html", "style.css"];

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tibo-build-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of expectedFiles) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), `Public fixture: ${file}`);
  }
  return root;
}

async function listFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const file = path.join(relative, entry.name);
    return entry.isDirectory() ? listFiles(root, file) : file;
  }))).flat().sort();
}

test("build excludes private, server, test and unlisted asset files, including stale output", async (t) => {
  const root = await fixture(t);
  const privateFiles = [".env.local", "server.mjs", "src/decisions.js", "api/decisions.js", "tests/private.test.mjs", "assets/unlisted.txt", "dist/.env.local", "dist/stale.js"];
  for (const file of privateFiles) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "PRIVATE_FIXTURE_MUST_NOT_BE_PUBLISHED");
  }
  const { output } = await buildSite(root);
  assert.deepEqual(await listFiles(output), expectedFiles);
  for (const file of expectedFiles) {
    assert.equal(await readFile(path.join(output, file), "utf8"), `Public fixture: ${file}`);
  }
});

test("build refuses an allowlisted asset that links to a private file", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, ".env.local"), "PRIVATE_FIXTURE_MUST_NOT_BE_PUBLISHED");
  await rm(path.join(root, "assets/tibo-avatar.jpg"));
  await symlink(path.join(root, ".env.local"), path.join(root, "assets/tibo-avatar.jpg"));
  await assert.rejects(buildSite(root), /regular file inside the project/);
});
