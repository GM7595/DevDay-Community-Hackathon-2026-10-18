import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { AppError } from '../src/common.js';
import { collect, createXClient } from '../src/x.js';
import { analyze, enrichPostSignals, prepare } from '../src/decisions.js';
import { appendForecastHistory, publicSnapshot } from '../site/public/model.js';

async function atomicJson(path, data) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

try {
  if (!process.env.OPENAI_API_KEY) throw new AppError('Set OPENAI_API_KEY in .env.');
  const client = await createXClient();
  const corpus = await collect({ client, count: 100, contextLimit: 20, onProgress: console.error });
  let report = await analyze(prepare(corpus));
  if (report.evidence.length) report = await enrichPostSignals(report);
  let previous = null;
  try { previous = JSON.parse(await readFile('site/server/seed.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const snapshot = appendForecastHistory(publicSnapshot(report), previous);
  // Preserve the previously published snapshot if collection or scoring fails.
  await mkdir('data', { recursive: true });
  await atomicJson('data/posts.json', corpus);
  await atomicJson('data/report-with-signals.json', report);
  await atomicJson('site/server/seed.json', snapshot);
  console.log(`Updated local snapshot with ${snapshot.postCount} posts. Republish the Site to update its hosted snapshot.`);
} catch (error) {
  console.error(error instanceof AppError ? error.message : 'Update failed. The last displayed snapshot was preserved.');
  process.exitCode = 1;
}
