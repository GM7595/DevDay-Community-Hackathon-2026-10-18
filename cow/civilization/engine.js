/**
 * Deterministic, browser-safe civilization journal. All timestamps are epoch ms.
 * Rules mirror design/civilization-rules.json; no wall clock or network is read.
 *
 * Persist projection.journal after feed updates: it retains confirmed notices and
 * coverage so reopening the page replays exactly the same timeline. A feed must
 * provide every confirmed notice since creation, not merely its latest notice.
 *
 * Projection status: alive (working), stopped (24-hour grace), pending (predicted
 * death beyond known feed coverage), extinct (death covered by the feed).
 * remainingHours excludes grace; extinctionInHours includes grace. deathAt is
 * final only; projectedDeathAt also describes future and provisional death.
 */
export const POLICIES = Object.freeze({
  conserve: Object.freeze({ label: '節約', fullQuotaHours: 168, researchPerHour: 0.35 }),
  normal: Object.freeze({ label: 'ふつう', fullQuotaHours: 120, researchPerHour: 1 }),
  sprint: Object.freeze({ label: '全力', fullQuotaHours: 72, researchPerHour: 1.6 }),
});

export const ERAS = Object.freeze([
  { id: 'stone', label: '石器時代', research: 0, landmark: 'たき火と小屋' },
  { id: 'agriculture', label: '農耕時代', research: 2, landmark: '畑と風車' },
  { id: 'kingdom', label: '王国時代', research: 12, landmark: '市場と城' },
  { id: 'industry', label: '工業時代', research: 48, landmark: '工場と鉄道' },
  { id: 'information', label: '情報時代', research: 144, landmark: '高層ビルとデータセンター' },
  { id: 'future', label: '未来文明', research: 300, landmark: '空中都市と宇宙港' },
].map(Object.freeze));

const HOUR = 3_600_000;
const GRACE = 24 * HOUR;
const EPSILON_MS = 0.01;
const round = value => Math.round(value * 1e9) / 1e9;

function timestamp(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be an epoch-millisecond timestamp`);
  return value;
}

function assertJournal(journal) {
  if (!journal || journal.version !== 1 || !Array.isArray(journal.policyChanges)) {
    throw new TypeError('Unsupported civilization journal');
  }
  timestamp(journal.createdAt, 'createdAt');
}

function cleanNotices(notices) {
  const valid = notices.filter(notice => notice && typeof notice.eventId === 'string'
    && notice.eventId.length > 0 && Number.isFinite(notice.publishedAt) && notice.publishedAt >= 0)
    .map(({ eventId, publishedAt, sourceUrl }) => ({
      eventId, publishedAt, sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : '',
    }))
    .sort((a, b) => a.publishedAt - b.publishedAt || a.eventId.localeCompare(b.eventId)
      || a.sourceUrl.localeCompare(b.sourceUrl));
  const ids = new Set();
  return valid.filter(notice => {
    if (ids.has(notice.eventId)) return false;
    ids.add(notice.eventId);
    return true;
  });
}

/** A single local lineage; generation changes only after a final death. */
export function createCivilization({ id, name = '小さな文明', now }) {
  timestamp(now, 'now');
  if (typeof id !== 'string' || !id) throw new TypeError('A civilization id is required');
  return {
    version: 1, id, name: String(name).trim().slice(0, 64) || '小さな文明',
    generation: 1, createdAt: now,
    policyChanges: [{ at: now, policy: 'normal' }],
    notices: [], confirmedThrough: now, ancestors: [], consumedSeedEventIds: [],
  };
}

/** Policy changes are persistent timeline events, never clicks that grant work. */
export function changePolicy(journal, policy, now) {
  assertJournal(journal);
  timestamp(now, 'now');
  if (!Object.hasOwn(POLICIES, policy)) throw new TypeError('Unknown policy');
  if (now < journal.createdAt) throw new RangeError('Policy change predates this generation');
  const current = projectCivilization(journal, now);
  if (current.status === 'extinct' || current.policy === policy) return journal;
  return {
    ...journal,
    policyChanges: journal.policyChanges.filter(change => change.at !== now)
      .concat({ at: now, policy }).sort((a, b) => a.at - b.at),
  };
}

/**
 * Replays policy + reset history from the generation's birth. Later-arriving
 * historical notices can repair a provisional loss without a resurrection hack.
 * ConfirmedThrough certifies complete reset history up to that instant.
 */
export function projectCivilization(journal, now, { notices = [], confirmedThrough } = {}) {
  assertJournal(journal);
  timestamp(now, 'now');
  if (now < journal.createdAt) throw new RangeError('Projection predates this generation');
  if (!Array.isArray(notices)) throw new TypeError('notices must be an array');
  if (confirmedThrough !== undefined && confirmedThrough !== null) timestamp(confirmedThrough, 'confirmedThrough');
  const known = cleanNotices(journal.notices || []);
  // Previously accepted IDs are immutable. A duplicate cannot move its timestamp
  // forward to manufacture an additional refill.
  const knownIds = new Set(known.map(notice => notice.eventId));
  const mergedNotices = cleanNotices(known.concat(notices.filter(notice => !knownIds.has(notice?.eventId))));
  const coverage = Math.min(now, Math.max(journal.createdAt, journal.confirmedThrough ?? journal.createdAt,
    confirmedThrough ?? journal.createdAt));
  const updatedJournal = { ...journal, notices: mergedNotices, confirmedThrough: coverage };
  const consumedSeeds = new Set(journal.consumedSeedEventIds || []);
  const changes = journal.policyChanges.filter(change => Number.isFinite(change.at)
    && change.at >= journal.createdAt && change.at <= now && Object.hasOwn(POLICIES, change.policy));
  const usableNotices = mergedNotices.filter(notice => notice.publishedAt >= journal.createdAt
    && notice.publishedAt <= now && !consumedSeeds.has(notice.eventId));
  const events = changes.map(change => ({ at: change.at, kind: 'policy', change }))
    .concat(usableNotices.map(notice => ({ at: notice.publishedAt, kind: 'reset', notice })))
    .sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'reset' ? -1 : 1));

  let cursor = journal.createdAt;
  let quota = 100;
  let research = 0;
  let workedHours = 0;
  let policy = 'normal';
  let stoppedAt = null;
  let fatalAt = null;
  let lastResetAt = null;
  const appliedNoticeIds = [];
  const seedNotices = [];

  function advance(to) {
    if (fatalAt !== null) { cursor = to; return; }
    if (quota > 0) {
      const rule = POLICIES[policy];
      const stop = cursor + quota / 100 * rule.fullQuotaHours * HOUR;
      const workingUntil = Math.min(to, stop);
      const hours = Math.max(0, workingUntil - cursor) / HOUR;
      research += hours * rule.researchPerHour;
      workedHours += hours;
      quota = Math.max(0, quota - hours * 100 / rule.fullQuotaHours);
      if (to >= stop - EPSILON_MS) {
        quota = 0;
        stoppedAt = stop;
      }
    }
    // At the exact boundary a reset still wins. Finalization after all events
    // handles death when no same-timestamp reset was present.
    if (stoppedAt !== null && to > stoppedAt + GRACE + EPSILON_MS) fatalAt = stoppedAt + GRACE;
    cursor = to;
  }

  for (const event of events) {
    advance(event.at);
    if (event.kind === 'policy') {
      if (fatalAt === null) policy = event.change.policy;
      continue;
    }
    if (fatalAt !== null) {
      if (!consumedSeeds.has(event.notice.eventId)) seedNotices.push(event.notice);
      continue;
    }
    quota = 100;
    stoppedAt = null;
    lastResetAt = event.at;
    appliedNoticeIds.push(event.notice.eventId);
  }
  advance(now);
  if (fatalAt === null && stoppedAt !== null && now >= stoppedAt + GRACE - EPSILON_MS) {
    fatalAt = stoppedAt + GRACE;
  }

  const finalDeath = fatalAt !== null && coverage >= fatalAt - EPSILON_MS;
  const status = fatalAt !== null ? (finalDeath ? 'extinct' : 'pending') : quota > 0 ? 'alive' : 'stopped';
  const remainingHours = quota / 100 * POLICIES[policy].fullQuotaHours;
  const projectedDeathAt = fatalAt ?? (stoppedAt === null ? now + remainingHours * HOUR + GRACE : stoppedAt + GRACE);
  const eraIndex = ERAS.findLastIndex(era => research + 1e-9 >= era.research);
  const era = ERAS[eraIndex];
  const nextEra = ERAS[eraIndex + 1] || null;
  const rebirthNotice = seedNotices[0] || null;
  return {
    journal: updatedJournal, id: journal.id, name: journal.name, generation: journal.generation,
    now, createdAt: journal.createdAt, status, quota: round(quota), research: round(research), policy,
    era, nextEra, eraProgress: nextEra ? Math.min(1, Math.max(0, (research - era.research) / (nextEra.research - era.research))) : 1,
    workedHours: round(workedHours), survivalHours: round(((fatalAt ?? now) - journal.createdAt) / HOUR),
    remainingHours: round(remainingHours), extinctionInHours: round(Math.max(0, projectedDeathAt - now) / HOUR),
    stoppedAt, deathAt: finalDeath ? fatalAt : null, projectedDeathAt,
    confirmedThrough: coverage, coveragePending: coverage < now,
    lastResetAt, appliedNoticeIds, rebirthAvailable: finalDeath && rebirthNotice !== null, rebirthNotice,
  };
}

/** One unclaimed seed maximum: existing reset backlog cannot fund many lives. */
export function rebirthCivilization(journal, now, options = {}) {
  const previous = projectCivilization(journal, now, options);
  if (!previous.rebirthAvailable) return previous.journal;
  const next = createCivilization({ id: journal.id, name: options.name ?? journal.name, now });
  const consumed = new Set(journal.consumedSeedEventIds || []);
  for (const notice of previous.journal.notices) {
    if (notice.publishedAt > previous.deathAt && notice.publishedAt <= now) consumed.add(notice.eventId);
  }
  return {
    ...next,
    generation: journal.generation + 1,
    notices: previous.journal.notices,
    // Earlier coverage was sufficient to certify the previous death. A new
    // generation starts now with its seed, so it needs no pre-birth coverage.
    confirmedThrough: now,
    consumedSeedEventIds: [...consumed],
    seedEventId: previous.rebirthNotice.eventId,
    ancestors: [...(journal.ancestors || []), {
      generation: journal.generation, name: journal.name, createdAt: journal.createdAt,
      deathAt: previous.deathAt, research: previous.research, era: previous.era.id,
      seedEventId: previous.rebirthNotice.eventId,
    }],
  };
}
