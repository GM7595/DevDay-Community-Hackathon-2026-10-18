import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, lstat, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installCivilization } from "../install-reset-watch.mjs";

const forecast = '<section id="forecast"><h1>Existing prediction</h1><output>68%</output></section>';
const timeline = '<section id="timeline"><canvas id="chart"></canvas><button>Existing filter</button></section>';
const original = `<!doctype html><main>${forecast}${timeline}</main><script type="module" src="/app.js"></script>`;
const allowed = ["bootstrap.js", "engine.js", "forecast-view.js", "reset-feed.js", "scene.js", "tibo-avatar.jpg", "widget.css", "widget.js"];

async function fixture(t, html = original) {
  const directory = await mkdtemp(path.join(tmpdir(), "tibo-integration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "index.html"), html);
  await writeFile(path.join(directory, "app.js"), "// Existing host application\n");
  return realpath(directory);
}

test("integration preserves the forecast, timeline and host application and copies only eight public assets", async (t) => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, ".env"), "PRIVATE_SENTINEL=not-a-real-key\n");
  const result = await installCivilization(directory);
  const html = await readFile(path.join(directory, "index.html"), "utf8");
  assert.ok(html.includes(forecast));
  assert.ok(html.includes(timeline));
  assert.ok(html.includes('<script type="module" src="/app.js"></script>'));
  assert.ok(html.indexOf('id="tibo-civilization"') < html.indexOf('id="timeline"'));
  assert.equal(await readFile(path.join(directory, "app.js"), "utf8"), "// Existing host application\n");
  assert.deepEqual([...result.assets].sort(), allowed);
  assert.deepEqual((await readdir(result.destination)).sort(), allowed);
  for (const name of allowed) {
    const installed = path.join(result.destination, name);
    assert.ok((await lstat(installed)).isFile());
    const source = new URL(name === "tibo-avatar.jpg" ? `../assets/${name}` : `../civilization/${name}`, import.meta.url);
    assert.deepEqual(await readFile(installed), await readFile(source));
  }
  assert.equal(await readFile(path.join(directory, ".env"), "utf8"), "PRIVATE_SENTINEL=not-a-real-key\n");
});

test("reinstalling is idempotent and retains unrelated host files", async (t) => {
  const directory = await fixture(t);
  const result = await installCivilization(directory);
  await writeFile(path.join(result.destination, "host-notes.txt"), "keep this file");
  const first = await readFile(path.join(directory, "index.html"), "utf8");
  await installCivilization(directory);
  const second = await readFile(path.join(directory, "index.html"), "utf8");
  assert.equal(second, first);
  assert.equal((second.match(/id="tibo-civilization"/g) ?? []).length, 1);
  assert.equal((second.match(/src="\/civilization\/bootstrap\.js"/g) ?? []).length, 1);
  assert.equal(await readFile(path.join(result.destination, "host-notes.txt"), "utf8"), "keep this file");
});

test("a missing timeline or incomplete markers cause no filesystem mutation", async (t) => {
  for (const html of [`<main>${forecast}</main>`, `${original}<!-- TIBO CIVILIZATION START -->`]) {
    const directory = await fixture(t, html);
    const before = (await readdir(directory)).sort();
    await assert.rejects(installCivilization(directory), /timeline section not found|Incomplete civilization/);
    assert.deepEqual((await readdir(directory)).sort(), before);
    assert.equal(await readFile(path.join(directory, "index.html"), "utf8"), html);
    assert.equal(await readFile(path.join(directory, "app.js"), "utf8"), "// Existing host application\n");
  }
});

test("Sites integration edits client/index.html while keeping browser assets in public", async (t) => {
  const site = await fixture(t);
  await mkdir(path.join(site, "client"));
  await mkdir(path.join(site, "public"));
  await writeFile(path.join(site, "client/index.html"), original);
  // An unrelated static index must not take precedence over Sites' real route.
  await writeFile(path.join(site, "public/index.html"), "keep this static file");
  await writeFile(path.join(site, "public/app.js"), "// Existing application\n");
  const result = await installCivilization(path.join(site, "public"));
  const html = await readFile(path.join(site, "client/index.html"), "utf8");
  assert.equal(result.htmlFile, path.join(site, "client/index.html"));
  assert.ok(html.includes(forecast) && html.includes(timeline));
  assert.ok(html.indexOf('id="tibo-civilization"') < html.indexOf('id="timeline"'));
  assert.deepEqual((await readdir(path.join(site, "public/civilization"))).sort(), allowed);
  assert.equal(await readFile(path.join(site, "public/app.js"), "utf8"), "// Existing application\n");
  assert.equal(await readFile(path.join(site, "public/index.html"), "utf8"), "keep this static file");
  await installCivilization(path.join(site, "public"));
  assert.equal(await readFile(result.htmlFile, "utf8"), html, "Sites installation is idempotent");
});

test("a separate explicit HTML template is supported", async (t) => {
  const site = await fixture(t);
  await mkdir(path.join(site, "public"));
  const htmlFile = path.join(site, "custom.html");
  await writeFile(htmlFile, original);
  const result = await installCivilization(path.join(site, "public"), { htmlFile });
  assert.equal(result.htmlFile, htmlFile);
  assert.ok((await readFile(htmlFile, "utf8")).includes('id="tibo-civilization"'));
  assert.equal(await readFile(path.join(site, "index.html"), "utf8"), original);
});

test("missing or symlinked HTML templates fail before public assets are created", async (t) => {
  const site = await fixture(t);
  const publicDirectory = path.join(site, "public");
  await mkdir(publicDirectory);
  await assert.rejects(installCivilization(publicDirectory), /HTML template not found/);
  await mkdir(path.join(site, "client"));
  await symlink(path.join(site, "index.html"), path.join(site, "client/index.html"));
  await assert.rejects(installCivilization(publicDirectory), /regular file, not a symlink/);
  assert.deepEqual(await readdir(publicDirectory), []);
  assert.equal(await readFile(path.join(site, "index.html"), "utf8"), original);
});
