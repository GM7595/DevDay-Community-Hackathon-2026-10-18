import test from 'node:test';
import assert from 'node:assert/strict';
import { appendForecastHistory, publicSnapshot } from '../site/public/model.js';
import { nearestPoint, percentLabel, plotLayout, timelineSeries } from '../site/public/timeline-model.js';

const asOf = '2026-10-18T06:00:00.000Z';
const report = (extra = {}) => ({ username: 'demo_account', target: 'codex', asOf,
  deadline: '2026-10-19T06:00:00.000Z', status: 'insufficient_evidence', rawModelProbability: 0.09,
  evidence: [
    { post: { id: '2', author: 'demo_account', text: 'Synthetic second post', createdAt: '2026-10-18T05:00:00Z' }, signalProbability: 0, category: 'already_reset' },
    { post: { id: '1', author: 'demo_account', text: 'Synthetic first post', createdAt: '2026-10-10T06:00:00Z' }, signalProbability: 0.01, category: 'irrelevant' },
    { post: { id: '3', author: 'demo_account', text: 'Synthetic unscored post', createdAt: '2026-10-18T05:30:00Z' }, signalProbability: null, category: 'refusal' },
  ], ...extra });

test('chronological post series uses post scores rather than forecast or classification confidence', () => {
  const data = publicSnapshot(report());
  const points = timelineSeries(data, data.evidence);
  assert.deepEqual(points.map((p) => p.id), ['1', '2', '3']);
  assert.deepEqual(points.map((p) => p.probability), [0.01, 0, null]);
  assert.equal(timelineSeries(data, data.evidence, { range: '48h' }).length, 2);
  assert.equal(timelineSeries(data, data.evidence, { range: '7d' }).length, 2);
});

test('a single saved forecast yields one real historical point, never a curve per post', () => {
  const data = publicSnapshot(report());
  const points = timelineSeries(data, data.evidence, { mode: 'history' });
  assert.equal(points.length, 1);
  assert.equal(points[0].time, Date.parse(asOf));
  assert.equal(points[0].probability, 0.09);
  assert.equal(points[0].record.status, 'insufficient_evidence');
});

test('history appends real runs, deduplicates re-export and isolates targets and authors', () => {
  const before = publicSnapshot(report({ asOf: '2026-10-17T06:00:00Z', deadline: '2026-10-18T06:00:00Z', rawModelProbability: 0.2 }));
  const data = appendForecastHistory(publicSnapshot(report()), before);
  assert.equal(data.forecastHistory.length, 2);
  assert.deepEqual(data.forecastHistory.map((p) => p.probability), [0.2, 0.09]);
  assert.equal(appendForecastHistory(data, data).forecastHistory.length, 2);
  assert.equal(publicSnapshot(data).forecastHistory.length, 2);
  assert.equal(appendForecastHistory({ ...data, target: 'api-credit' }, before).forecastHistory.length, 1);
  assert.equal(appendForecastHistory({ ...data, username: 'someone_else' }, before).forecastHistory.length, 1);
});

test('history allowlists fields and rejects invalid dates, probabilities and windows', () => {
  const data = publicSnapshot(report({ forecastHistory: [
    { asOf: 'bad', deadline: asOf, status: 'estimated', probability: 0.7 },
    { asOf, deadline: '2025-01-01', status: 'estimated', probability: 0.7 },
    { asOf: '2026-10-17T06:00:00Z', deadline: asOf, status: 'estimated', probability: 7, token: 'not-public' },
  ] }));
  assert.equal(data.forecastHistory.length, 2);
  assert.equal(data.forecastHistory[0].probability, null);
  assert.ok(!JSON.stringify(data).includes('not-public'));
});

test('auto zoom has a visible 5% floor and preserves zero while omitting unknown scores', () => {
  const data = publicSnapshot(report());
  const points = timelineSeries(data, data.evidence);
  const chart = plotLayout(points, 650, 330);
  assert.equal(chart.yMax, 0.05);
  assert.equal(chart.measured.length, 2);
  assert.equal(chart.measured[1].probability, 0);
  assert.ok(chart.measured[0].y < chart.measured[1].y);
  assert.equal(plotLayout(points, 650, 330, 'full').yMax, 1);
  assert.equal(percentLabel(0.0005), '0.05%');
});

test('empty and one-point charts keep finite geometry and bounded marks at mobile widths', () => {
  for (const points of [[], [{ id: 'one', time: Date.parse(asOf), probability: 1 }]]) {
    const chart = plotLayout(points, 270, 282);
    assert.ok(chart.maxTime > chart.minTime);
    for (const point of chart.measured) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(point.x >= chart.margin.left && point.x <= 270 - chart.margin.right);
      assert.ok(point.y >= chart.margin.top && point.y <= 282 - chart.margin.bottom);
    }
  }
});

test('nearest point selection resolves nearby points by both time and probability', () => {
  const points = [{ id: 'low', x: 20, y: 200 }, { id: 'high', x: 20, y: 30 }, { id: 'later', x: 90, y: 200 }];
  assert.equal(nearestPoint(points, 22, 35).id, 'high');
  assert.equal(nearestPoint(points, 88, 198).id, 'later');
  assert.equal(nearestPoint([], 0, 0), null);
});
