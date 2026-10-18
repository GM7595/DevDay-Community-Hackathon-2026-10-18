import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POLICIES, ERAS, createCivilization, changePolicy, projectCivilization, rebirthCivilization } from '../civilization/engine.js';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 9, 18);
const at = hours => START + hours * HOUR;
const city = () => createCivilization({ id: 'test-city', name: 'Test city', now: START });
const notice = (id, hours) => ({ eventId: id, publishedAt: at(hours), sourceUrl: `https://example.test/${id}` });
const project = (journal, hours, notices = [], extra = {}) => projectCivilization(journal, at(hours), {
  notices, confirmedThrough: at(hours), ...extra,
});

test('policy and era constants match the reviewed balance proposal', async () => {
  const rules = JSON.parse(await readFile(new URL('../design/civilization-rules.json', import.meta.url)));
  assert.deepEqual(POLICIES, rules.policies);
  assert.deepEqual(ERAS, rules.eras);
  assert.equal(rules.stoppedGraceHours, 24);
});

test('each policy exhausts capacity at its exact threshold and dies after 24 hours', () => {
  for (const [policy, rule] of Object.entries(POLICIES)) {
    const journal = changePolicy(city(), policy, START);
    const stopped = project(journal, rule.fullQuotaHours);
    assert.equal(stopped.status, 'stopped', policy);
    assert.equal(stopped.quota, 0);
    assert.equal(stopped.research, rule.fullQuotaHours * rule.researchPerHour);
    assert.equal(stopped.stoppedAt, at(rule.fullQuotaHours));
    assert.equal(project(journal, rule.fullQuotaHours + 24 - 1 / HOUR).status, 'stopped');
    const dead = project(journal, rule.fullQuotaHours + 24);
    assert.equal(dead.status, 'extinct');
    assert.equal(dead.deathAt, at(rule.fullQuotaHours + 24));
    assert.equal(dead.research, stopped.research);
  }
});

test('four-day reset cadence allows a normal civilization to reach the future', () => {
  const result = project(city(), 320, [notice('one', 96), notice('two', 192), notice('three', 288)]);
  assert.equal(result.status, 'alive');
  assert.equal(result.research, 320);
  assert.equal(result.era.id, 'future');
  assert.equal(result.nextEra, null);
  assert.equal(result.quota, 73.333333333);
  assert.equal(result.appliedNoticeIds.length, 3);
});

test('repeated four-day resets rescue sprint exactly at every death boundary', () => {
  const journal = changePolicy(city(), 'sprint', START);
  const result = project(journal, 320, [notice('one', 96), notice('two', 192), notice('three', 288)]);
  assert.equal(result.status, 'alive');
  assert.equal(result.research, 396.8);
  assert.equal(result.era.id, 'future');
  assert.equal(result.quota, 55.555555556);
  assert.deepEqual(result.appliedNoticeIds, ['one', 'two', 'three']);
});

test('each era becomes visible at its research threshold', () => {
  for (const era of ERAS) {
    const notices = [96, 192, 288].filter(hours => hours <= era.research).map(hours => notice(`n${hours}`, hours));
    assert.equal(project(city(), era.research, notices).era.id, era.id);
  }
});

test('policy timeline integrates work exactly without rewards from repeated clicks', () => {
  let journal = changePolicy(city(), 'sprint', at(24));
  journal = changePolicy(journal, 'conserve', at(36));
  const before = JSON.stringify(journal);
  assert.equal(changePolicy(journal, 'conserve', at(36)), journal);
  const result = project(journal, 48);
  assert.equal(result.research, 47.4);
  assert.equal(result.quota, 56.19047619);
  assert.equal(result.policy, 'conserve');
  assert.equal(JSON.stringify(journal), before, 'projection must not mutate journal');
});

test('reload replays retained notices and policy history identically', () => {
  const input = changePolicy(city(), 'conserve', at(20));
  const first = project(input, 100, [notice('n1', 96)]);
  const stored = JSON.parse(JSON.stringify(first.journal));
  const resumed = project(stored, 200, [notice('n2', 192)]);
  const direct = project(input, 200, [notice('n2', 192), notice('n1', 96)]);
  assert.deepEqual(resumed, direct);
});

test('unsorted duplicates, old announcements, and future notices cannot add refills', () => {
  const duplicate = notice('refill', 96);
  const result = project(city(), 100, [notice('future', 110), duplicate, notice('old', -5), duplicate]);
  assert.deepEqual(result.appliedNoticeIds, ['refill']);
  assert.equal(result.quota, 96.666666667);
  const movedDuplicate = project(result.journal, 101, [notice('refill', 101)]);
  assert.equal(movedDuplicate.lastResetAt, at(96));
  assert.equal(movedDuplicate.quota, 95.833333333);
  assert.equal(project(result.journal, 110).quota, 100, 'stored future notice applies only at its timestamp');
});

test('a reset at the exact death timestamp wins, but one millisecond later cannot resurrect', () => {
  const saved = project(city(), 144, [notice('at-boundary', 144)]);
  assert.equal(saved.status, 'alive');
  assert.equal(saved.quota, 100);
  assert.equal(saved.research, 120);
  assert.equal(saved.deathAt, null);
  const tooLate = projectCivilization(city(), at(145), {
    notices: [{ ...notice('late', 144), publishedAt: at(144) + 1 }], confirmedThrough: at(145),
  });
  assert.equal(tooLate.status, 'extinct');
  assert.equal(tooLate.quota, 0);
  assert.equal(tooLate.research, 120);
  assert.equal(tooLate.rebirthAvailable, true);
});

test('insufficient feed coverage never finalizes an assumed death', () => {
  const pending = project(city(), 200, [], { confirmedThrough: at(100) });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.projectedDeathAt, at(144));
  assert.equal(pending.deathAt, null);
  assert.equal(pending.rebirthAvailable, false);
  const partial = project(pending.journal, 200, [], { confirmedThrough: at(143) });
  assert.equal(partial.status, 'pending');
  const complete = project(partial.journal, 200, [], { confirmedThrough: at(144) });
  assert.equal(complete.status, 'extinct');
  assert.equal(complete.deathAt, at(144));
});

test('a delayed historical reset repairs provisional loss via chronological replay', () => {
  const pending = project(city(), 200, [], { confirmedThrough: at(80) });
  const repaired = project(pending.journal, 200, [notice('missed', 96)]);
  assert.equal(repaired.status, 'alive');
  assert.equal(repaired.research, 200);
  assert.equal(repaired.quota, 13.333333333);
  assert.equal(repaired.deathAt, null);
  assert.equal(repaired.rebirthAvailable, false);
});

test('true death is permanent; a later reset supplies one rebirth seed', () => {
  const previous = project(city(), 260, [notice('seed-1', 192), notice('seed-2', 240)]);
  assert.equal(previous.status, 'extinct');
  assert.equal(previous.research, 120);
  assert.equal(previous.rebirthAvailable, true);
  const reborn = rebirthCivilization(previous.journal, at(260), { confirmedThrough: at(260), name: 'Second city' });
  assert.equal(reborn.generation, 2);
  assert.equal(reborn.createdAt, at(260));
  assert.equal(reborn.name, 'Second city');
  assert.equal(reborn.ancestors.length, 1);
  assert.equal(reborn.ancestors[0].deathAt, at(144));
  assert.deepEqual(reborn.consumedSeedEventIds, ['seed-1', 'seed-2']);
  const newborn = project(reborn, 260);
  assert.equal(newborn.quota, 100);
  assert.equal(newborn.research, 0);
  assert.equal(newborn.era.id, 'stone');
  const later = project(reborn, 404);
  assert.equal(later.status, 'extinct');
  assert.equal(later.rebirthAvailable, false, 'old backlog cannot buy another life');
  const unchanged = rebirthCivilization(later.journal, at(404));
  assert.equal(unchanged.generation, 2);
});

test('live, stopped and provisional cities cannot consume a rebirth seed', () => {
  assert.equal(rebirthCivilization(city(), at(1)).generation, 1);
  assert.equal(rebirthCivilization(city(), at(130)).generation, 1);
  const pending = project(city(), 200, [notice('seed', 192)], { confirmedThrough: at(100) });
  assert.equal(rebirthCivilization(pending.journal, at(200)).generation, 1);
});

test('claiming a seed at its publication timestamp does not also apply it as a reset', () => {
  const reborn = rebirthCivilization(city(), at(192), {
    notices: [notice('seed', 192)], confirmedThrough: at(192),
  });
  assert.equal(reborn.generation, 2);
  const result = project(reborn, 192);
  assert.equal(result.quota, 100);
  assert.equal(result.research, 0);
  assert.deepEqual(result.appliedNoticeIds, []);
});

test('null or absent feed coverage stays provisional and retains past certified coverage', () => {
  const unknown = projectCivilization(city(), at(200), { confirmedThrough: null });
  assert.equal(unknown.status, 'pending');
  const certified = project(city(), 150);
  const offline = projectCivilization(certified.journal, at(200), { confirmedThrough: null });
  assert.equal(offline.status, 'extinct');
  assert.equal(offline.confirmedThrough, at(150));
});

test('rebirth while feed is stale begins a reloadable generation at its own birth coverage', () => {
  const previous = project(city(), 260, [notice('seed', 192)], { confirmedThrough: at(200) });
  assert.equal(previous.rebirthAvailable, true);
  const reborn = rebirthCivilization(previous.journal, at(260));
  assert.equal(reborn.generation, 2);
  assert.equal(reborn.confirmedThrough, reborn.createdAt);
  const reloaded = JSON.parse(JSON.stringify(reborn));
  assert.equal(projectCivilization(reloaded, at(261)).status, 'alive');
  assert.equal(projectCivilization(reloaded, at(404)).status, 'pending');
});
