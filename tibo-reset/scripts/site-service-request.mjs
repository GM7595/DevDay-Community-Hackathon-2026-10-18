// Read supported Sites service access through hidden stdin; never put it in argv.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write('Ready for Site request JSON on stdin (input is hidden).\n');
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  if (!buffer.includes('\n')) return;
  process.stdin.pause();
  try {
    const input = JSON.parse(buffer.trim());
    const url = new URL(input.url);
    if (url.origin !== 'https://tibo-reset-watch.soumame.chatgpt.site') throw Error('Wrong Site origin');
    const response = await fetch(url, { method: input.method ?? 'GET', redirect: 'error',
      headers: { 'OAI-Sites-Authorization': `Bearer ${input.token}` }, signal: AbortSignal.timeout(300000) });
    const body = await response.json();
    // Public result metadata only. Never dump an upstream error or full response.
    const fields = ['source','status','errorCode','errorDetail','failedStage','collectedAt','newestPostAt','postCount',
      'asOf','lastSuccessAt','nextExpectedAt','rescoredPostCount'];
    const result = Object.fromEntries(fields.filter(key => Object.hasOwn(body,key)).map(key=>[key,body[key]]));
    if (body.operation) result.operation = body.operation;
    if (body.forecastHistory) result.historyCount = body.forecastHistory.length;
    console.log(JSON.stringify({ httpStatus: response.status, ...result }));
    process.exitCode = response.ok ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ error: 'Site request failed', type: error.name })); process.exitCode = 1; }
  finally { buffer = ''; if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.destroy(); }
});
