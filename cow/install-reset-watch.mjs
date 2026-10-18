import { readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = ['engine.js', 'reset-feed.js', 'forecast-view.js', 'widget.js', 'widget.css', 'scene.js', 'bootstrap.js'];
const markerStart = '<!-- TIBO CIVILIZATION START -->';
const markerEnd = '<!-- TIBO CIVILIZATION END -->';
const embed = `${markerStart}\n<section id="tibo-civilization" aria-label="Tiboのリセットで育つ文明"></section>\n<script type="module" src="/civilization/bootstrap.js"></script>\n${markerEnd}`;

export async function installCivilization(publicDirectory) {
  const target = await realpath(publicDirectory);
  const indexPath = path.join(target, 'index.html');
  if (await realpath(indexPath) !== indexPath) throw new Error('index.html must not be a symlink');
  let html = await readFile(indexPath, 'utf8');
  if (html.includes(markerStart) !== html.includes(markerEnd)) throw new Error('Incomplete civilization installation markers');
  if (html.includes(markerStart)) {
    html = html.slice(0, html.indexOf(markerStart)) + embed + html.slice(html.indexOf(markerEnd) + markerEnd.length);
  } else {
    const anchor = html.search(/<section\b[^>]*\bid=["']timeline["']/i);
    if (anchor < 0) throw new Error('Reset Watch timeline section not found; no files were changed');
    html = html.slice(0, anchor) + embed + '\n\n    ' + html.slice(anchor);
  }
  const files = await Promise.all(assets.map(async (name) => {
    const file = path.join(root, 'civilization', name);
    if (!(await lstat(file)).isFile() || await realpath(file) !== file) throw new Error(`Invalid public asset: ${name}`);
    return [name, await readFile(file)];
  }));
  files.push(['tibo-avatar.jpg', await readFile(path.join(root, 'assets/tibo-avatar.jpg'))]);
  const destination = path.join(target, 'civilization');
  await mkdir(destination, { recursive: true });
  if (await realpath(destination) !== destination) throw new Error('Civilization asset directory must not be a symlink');
  for (const [name, bytes] of files) {
    const file = path.join(destination, name);
    try { if (!(await lstat(file)).isFile() || await realpath(file) !== file) throw new Error(`Invalid destination: ${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(file, bytes);
  }
  await writeFile(indexPath, html);
  return { destination, assets: files.map(([name]) => name) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] || path.join(root, '../tibo-reset/site/public');
  try {
    const result = await installCivilization(directory);
    console.log(`Installed ${result.assets.length} civilization assets in ${result.destination}`);
  } catch (error) {
    console.error(`Civilization installation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
