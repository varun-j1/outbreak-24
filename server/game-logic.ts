export const DEFAULT_RULES = {
  headStartSeconds: 45,
  matchSeconds: 12 * 60,
  extractionOpensAtSeconds: 10 * 60,
  extractionHoldSeconds: 10,
  powerupStartsAtSeconds: 75,
  powerupIntervalSeconds: 60,
  fixedPingIntervalSeconds: 0,
  stormStartsAtSeconds: 5 * 60,
  trailLifetimeSeconds: 100,
  trailExitExposureSeconds: 15,
  trailWidthMeters: 14,
  boundaryGraceSeconds: 20,
  boundaryForfeitSeconds: 60,
  captureTurnSeconds: 15,
  initialRadiusMeters: 500,
  minimumRadiusMeters: 150,
};

export type GameRules = typeof DEFAULT_RULES;
export type Coordinate = { lat: number; lng: number };
export const SURVIVOR_TEAM_PING_SECONDS = 10;
export type RecapPlayer = { id: string; displayName: string; role: string; status: string };
export type RecapClaim = { id: string; zombiePlayerId: string; targetPlayerId: string; status: string; resolution: string | null; createdAt: Date; resolvedAt: Date | null };

/** Match outcomes are derived from authoritative player and resolved-claim records. */
export function buildMatchRecap(players: RecapPlayer[], claims: RecapClaim[]) {
  const names = new Map(players.map(player => [player.id, player.displayName]));
  const captures = claims
    .filter(claim => claim.resolution === "capture")
    .sort((left, right) => (right.resolvedAt ?? right.createdAt).getTime() - (left.resolvedAt ?? left.createdAt).getTime())
    .map(claim => ({
      id: claim.id,
      zombiePlayerId: claim.zombiePlayerId,
      survivorPlayerId: claim.targetPlayerId,
      zombieName: names.get(claim.zombiePlayerId) ?? "Unknown infected",
      survivorName: names.get(claim.targetPlayerId) ?? "Unknown survivor",
      happenedAt: (claim.resolvedAt ?? claim.createdAt).toISOString(),
    }));
  const escaped = players.filter(player => player.status === "escaped");
  const forfeited = players.filter(player => player.status === "forfeited");
  const infected = players.filter(player => player.role === "zombie");
  return {
    captures,
    totals: {
      captures: captures.length,
      escaped: escaped.length,
      forfeited: forfeited.length,
      infected: infected.length,
      survivorsRemaining: players.filter(player => player.role === "survivor" && player.status === "active").length,
    },
  };
}

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (value: number) => (value * Math.PI) / 180;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Host match length drives the extraction window, item cadence, and ping frequency. */
export function deriveRules(matchMinutes: number, fixedPingIntervalMinutes = 0): GameRules {
  const matchSeconds = Math.round(clamp(matchMinutes, 6, 45) * 60);
  const extractionWindow = clamp(Math.round(matchSeconds * 0.18), 75, 180);
  return {
    ...DEFAULT_RULES,
    matchSeconds,
    extractionOpensAtSeconds: matchSeconds - extractionWindow,
    powerupStartsAtSeconds: clamp(Math.round(matchSeconds * 0.14), 45, 120),
    powerupIntervalSeconds: clamp(Math.round(matchSeconds / 10), 35, 75),
    fixedPingIntervalSeconds: fixedPingIntervalMinutes > 0 ? Math.round(clamp(fixedPingIntervalMinutes, 1, 10) * 60) : 0,
  };
}

export function metersBetween(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Approximate local projection is accurate enough for short outdoor game segments. */
export function distanceToSegmentMeters(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const latitudeScale = 111_320;
  const longitudeScale = 111_320 * Math.cos(toRadians(point.lat));
  const sx = (start.lng - point.lng) * longitudeScale;
  const sy = (start.lat - point.lat) * latitudeScale;
  const ex = (end.lng - point.lng) * longitudeScale;
  const ey = (end.lat - point.lat) * latitudeScale;
  const dx = ex - sx;
  const dy = ey - sy;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(sx, sy);
  const t = Math.max(0, Math.min(1, -(sx * dx + sy * dy) / lengthSquared));
  return Math.hypot(sx + t * dx, sy + t * dy);
}

/** Gives shorter intervals for more survivors and longer matches, while keeping uncertainty. */
export function pingIntervalSeconds(survivorCount: number, matchSecondsOrRandom?: number | (() => number), suppliedRandom = Math.random): number {
  if (typeof matchSecondsOrRandom === "function") {
    const [min, max] = survivorCount >= 3 ? [45, 60] : survivorCount === 2 ? [60, 90] : [90, 120];
    return Math.floor(min + matchSecondsOrRandom() * (max - min + 1));
  }
  const matchSeconds = typeof matchSecondsOrRandom === "number" ? matchSecondsOrRandom : DEFAULT_RULES.matchSeconds;
  const random = suppliedRandom;
  const playerAdjustment = survivorCount >= 3 ? 0.72 : survivorCount === 2 ? 0.9 : 1.1;
  const base = clamp(Math.round((matchSeconds / 11) * playerAdjustment), 35, 120);
  return Math.round(base * (0.88 + random() * 0.24));
}

export function scheduledPingIntervalSeconds(rules: GameRules, survivorCount: number, random = Math.random): number {
  return rules.fixedPingIntervalSeconds > 0 ? rules.fixedPingIntervalSeconds : pingIntervalSeconds(survivorCount, rules.matchSeconds, random);
}

export function parseRules(input?: string | null): GameRules {
  try {
    const parsed = input ? JSON.parse(input) : {};
    const derived = deriveRules((parsed.matchSeconds ?? DEFAULT_RULES.matchSeconds) / 60, (parsed.fixedPingIntervalSeconds ?? 0) / 60);
    return { ...derived, ...parsed };
  } catch { return DEFAULT_RULES; }
}

export function elapsedGameSeconds(startedAt: Date | null, pausedSeconds: number, now = new Date()): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000) - pausedSeconds);
}

export function effectiveStormRadius(game: { currentRadius: number; minimumRadius: number; stormPhase: string; stormPhaseEndsAt: Date | null }, now = new Date()): number {
  if (game.stormPhase !== "contracting" || !game.stormPhaseEndsAt) return game.currentRadius;
  const phaseStartedAt = game.stormPhaseEndsAt.getTime() - 30_000;
  const progress = Math.min(1, Math.max(0, (now.getTime() - phaseStartedAt) / 30_000));
  return Math.max(game.minimumRadius, game.currentRadius * (1 - 0.15 * progress));
}

/** Returns the announced distance by which the next storm contraction reduces the half-width. */
export function stormShrinkMeters(currentRadius: number, minimumRadius: number) {
  return Math.max(0, Math.round(currentRadius - Math.max(minimumRadius, currentRadius * 0.85)));
}

/** Zombie pings use their server expiry; survivor teammates see a brief ten-second confirmation only. */
export function canViewSurvivorPing(input: {
  viewerId: string;
  viewerRole: string;
  targetId: string;
  targetRole: string;
  pingedAt: Date | null;
  expiresAt: Date | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (input.targetRole !== "survivor" || input.targetId === input.viewerId || !input.pingedAt) return false;
  if (input.viewerRole === "zombie") return Boolean(input.expiresAt && input.expiresAt > now);
  if (input.viewerRole === "survivor") return now.getTime() - input.pingedAt.getTime() <= SURVIVOR_TEAM_PING_SECONDS * 1_000;
  return false;
}

export function markerPositionWithinBounds(center: Coordinate, point: Coordinate, radiusMeters: number, paddingMeters = 0): boolean {
  return metersBetween(center, point) <= Math.max(0, radiusMeters - paddingMeters);
}

/** Local meter offsets for the short outdoor areas supported by the game. */
export function localOffsetMeters(center: Coordinate, point: Coordinate) {
  return {
    x: (point.lng - center.lng) * 111_320 * Math.cos(toRadians(center.lat)),
    y: (point.lat - center.lat) * 111_320,
  };
}

/**
 * Tests a point against the field's rounded-square boundary. `halfWidthMeters`
 * is intentionally stored in the legacy radius fields to avoid a schema migration.
 */
export function roundedSquarePositionWithinBounds(center: Coordinate, point: Coordinate, halfWidthMeters: number, paddingMeters = 0): boolean {
  const halfWidth = Math.max(0, halfWidthMeters - paddingMeters);
  const { x, y } = localOffsetMeters(center, point);
  const horizontal = Math.abs(x);
  const vertical = Math.abs(y);
  if (horizontal > halfWidth || vertical > halfWidth) return false;

  const cornerRadius = Math.min(Math.max(12, halfWidth * 0.18), halfWidth * 0.42);
  const straightEdge = halfWidth - cornerRadius;
  if (horizontal <= straightEdge || vertical <= straightEdge) return true;
  return (horizontal - straightEdge) ** 2 + (vertical - straightEdge) ** 2 <= cornerRadius ** 2;
}
