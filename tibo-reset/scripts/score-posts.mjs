import { readFile, writeFile } from 'node:fs/promises';
import { AppError } from '../src/common.js';
import { enrichPostSignals } from '../src/decisions.js';

try {
  const input = process.argv[2] ?? 'data/report.json';
  const output = process.argv[3] ?? 'data/report-with-signals.json';
  const report = JSON.parse(await readFile(input, 'utf8'));
  const enriched = await enrichPostSignals(report);
  await writeFile(output, `${JSON.stringify(enriched, null, 2)}\n`, { mode: 0o600 });
  console.log(`Scored ${enriched.evidence.length} posts. Saved: ${output}`);
} catch (error) {
  console.error(error instanceof AppError ? error.message : 'Could not score posts. Check the input report and local environment.');
  process.exitCode = 1;
}
