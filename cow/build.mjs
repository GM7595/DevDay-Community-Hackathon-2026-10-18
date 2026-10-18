import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicFiles } from './public-assets.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export async function buildSite(sourceRoot = projectRoot) {
  const root = await realpath(sourceRoot);
  const files = await Promise.all(publicFiles.map(async (relative) => {
    const source = path.join(root, relative);
    if (!(await lstat(source)).isFile() || await realpath(source) !== source) {
      throw new Error(`Public asset must be a regular file inside the project: ${relative}`);
    }
    return { relative, content: await readFile(source) };
  }));

  const output = path.join(root, "dist");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const { relative, content } of files) {
    const destination = path.join(output, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return { output, files: [...publicFiles] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSite();
  process.stdout.write(`Built ${result.files.length} public files into dist/\n`);
}
