/** Proposed integration boundary. This is not an existing teammate API. */
export type ConfirmedResetNotice = {
  eventId: string;
  sourcePostIds: string[];
  sourceUrl: string;
  authorId: string;
  publishedAt: string;
  scope: "codex-global";
  // A completed-reset announcement, not independent proof of platform state.
  status: "confirmed_notice";
};

export type ResetWatchSnapshot = {
  version: 1;
  serverNow: string;
  nextCursor: string;
  hasMore: boolean;
  coverage: {
    from: string;
    through: string;
    status: "current" | "stale" | "unavailable";
  };
  resetNotices: ConfirmedResetNotice[];
  forecast: null | {
    probability: number;
    windowStart: string;
    windowEnd: string;
    generatedAt: string;
    calibration: "uncalibrated" | "calibrated";
  };
};

export type CarePolicy = "conserve" | "normal" | "sprint";

export type CivilizationJournal = {
  version: 1;
  rulesVersion: "proposal-1";
  civilizationId: string;
  name: string;
  createdAt: string;
  initialQuota: number;
  policyChanges: Array<{ at: string; policy: CarePolicy }>;
  appliedNotices: ConfirmedResetNotice[];
  feedCursor: string;
  confirmedThrough: string;
  mode: "live" | "demo";
};

export type CivilizationProjection = {
  state: "growing" | "stopped" | "extinct";
  projectedAt: string;
  provisional: boolean;
  quota: number;
  research: number;
  era: string;
  stoppedAt: string | null;
  extinctAt: string | null;
  rebirthSeed: null | { resetEventId: string; receivedAt: string };
};

/**
 * Pure simulation boundaries to implement after the teammate code arrives.
 * Forecast values are deliberately absent from resource calculation.
 * Event identity is assigned by the trusted Reset Watch service, not a UI score.
 */
export type ProjectCivilization = (
  journal: CivilizationJournal,
  now: string,
) => CivilizationProjection;

export type ReadResetWatch = (input: {
  afterCursor?: string;
  civilizationCreatedAt: string;
}) => Promise<ResetWatchSnapshot>;
