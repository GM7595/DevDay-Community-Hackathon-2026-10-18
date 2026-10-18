import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { appendForecastHistory, publicSnapshot } from '../site/public/model.js';

try {
  const input = process.argv[2] ?? 'data/report-with-signals.json';
  const output = process.argv[3] ?? fileURLToPath(new URL('../site/server/seed.json', import.meta.url));
  let previous = null;
  try { previous = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const snapshot = appendForecastHistory(publicSnapshot(JSON.parse(await readFile(input, 'utf8'))), previous);
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Exported ${snapshot.postCount} public post copies; ${snapshot.evidence.filter((e) => e.signalProbability !== null).length} have signal probabilities.`);
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid report JSON.' : error.message);
  process.exitCode = 1;
}
