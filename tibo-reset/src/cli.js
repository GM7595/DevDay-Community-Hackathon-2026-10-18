import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppError, integer, iso } from './common.js';
import { collect, createXClient } from './x.js';
import { analyze, buildRequest, enrichPostSignals, prepare, render } from './decisions.js';

const HELP = `tibo-reset — X の投稿から臨時リセットの予測を出す実験用 CLI

npm start -- collect [--username thsottiaux] [--count 100] [--out data/posts.json]
npm start -- analyze --input data/posts.json [--target codex|api-credit] [--hours 24]
npm start -- run [--count 100] [--target codex] [--hours 24]

  --as-of ISO_DATE     予測の基準時刻（既定: 現在）
  --context-limit 20   返信元を追加取得する上限（0–100）
  --guest             認証せず取得を試す（返信や取得件数が制限される可能性あり）
  --dry-run           Decisions リクエストだけ生成。OpenAI を呼び出さない
  --signals           投稿ごとの「リセットの発表・示唆を含む確率」も解析（100件ごとに追加1リクエスト）
  --out PATH          collect: 投稿 JSON / analyze・run: レポート JSON
  --help              このヘルプ

鍵と X セッションは .env に設定。数値は未校正のモデル予測です。`;

async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  let args;
  try {
    args = parseArgs({ allowPositionals: true, options: {
      username: { type: 'string' }, count: { type: 'string', default: '100' },
      hours: { type: 'string', default: '24' }, target: { type: 'string', default: 'codex' },
      'as-of': { type: 'string' }, 'context-limit': { type: 'string', default: '20' },
      input: { type: 'string' }, out: { type: 'string' }, guest: { type: 'boolean' },
      'dry-run': { type: 'boolean' }, signals: { type: 'boolean' }, help: { type: 'boolean' },
    } });
  } catch { throw new AppError('Invalid arguments. Run npm start -- --help.'); }
  const { values, positionals } = args;
  const command = positionals[0];
  if (values.help || !command) { console.log(HELP); return; }
  if (!['collect', 'analyze', 'run'].includes(command) || positionals.length !== 1) {
    throw new AppError('Command must be collect, analyze, or run.');
  }
  const count = integer(values.count, 'count', 1, 190);
  const hours = integer(values.hours, 'hours', 1, 168);
  const contextLimit = integer(values['context-limit'], 'context-limit', 0, 100);
  if (!['codex', 'api-credit'].includes(values.target)) throw new AppError('Invalid target.');
  if (values['as-of']) iso(values['as-of'], 'as-of date');
  if (command === 'collect' && values['dry-run']) throw new AppError('Use analyze --dry-run with a local posts file.');
  let corpus;
  if (command === 'analyze') {
    if (!values.input) throw new AppError('analyze requires --input PATH.');
    try { corpus = JSON.parse(await readFile(values.input, 'utf8')); }
    catch { throw new AppError('Could not read input JSON. Check --input.'); }
    if (!corpus || typeof corpus !== 'object') throw new AppError('Input must be a JSON object.');
  } else {
    if (values.input) throw new AppError('--input is supported only for analyze.');
    if (command === 'run' && !values['dry-run'] && !process.env.OPENAI_API_KEY) {
      throw new AppError('OPENAI_API_KEY is required in .env.');
    }
    const client = await createXClient({ guest: values.guest });
    corpus = await collect({ client, username: values.username ?? 'thsottiaux', count,
      guest: values.guest, contextLimit, onProgress: (line) => console.error(line) });
    const postsPath = command === 'collect' ? values.out ?? 'data/posts.json' : 'data/posts.json';
    await save(postsPath, corpus);
    console.error(`Posts saved: ${postsPath}`);
    if (command === 'collect') {
      console.log(`${corpus.posts.length}/${count} posts collected. ${corpus.warnings.join(' ')}`);
      return;
    }
  }
  const snapshot = prepare(corpus, { count, hours, target: values.target,
    ...(values.username ? { username: values.username } : {}),
    ...(values['as-of'] ? { asOf: values['as-of'] } : {}) });
  if (values['dry-run']) {
    const path = values.out ?? 'data/decisions-request.json';
    await save(path, buildRequest(snapshot));
    console.log(`Dry run: ${snapshot.posts.length} posts, ${snapshot.posts.length + 2} questions. Request saved: ${path}`);
    for (const warning of snapshot.warnings) console.error(`注: ${warning}`);
    return;
  }
  let report = await analyze(snapshot);
  if (values.signals && report.evidence.length) report = await enrichPostSignals(report);
  const path = values.out ?? 'data/report.json';
  await save(path, report);
  console.log(render(report));
  console.error(`Report saved: ${path}`);
}

main().catch((error) => {
  // SDK errors may contain request headers/cookies; never dump them or their stack.
  console.error(error instanceof AppError ? error.message :
    'Operation failed. Check local file permissions, network access, and upstream X API compatibility.');
  process.exitCode = 1;
});
