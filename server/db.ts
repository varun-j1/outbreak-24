import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  gameCaptureClaims,
  gameEvents,
  gameItems,
  gameMedia,
  gamePlayers,
  gamePoints,
  games,
  gameTrails,
  InsertUser,
  users,
} from "../drizzle/schema";
import { DEFAULT_RULES, distanceToSegmentMeters, effectiveStormRadius, elapsedGameSeconds, markerPositionWithinBounds, metersBetween, parseRules, pingIntervalSeconds } from "./game-logic";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
const id = () => crypto.randomUUID().replace(/-/g, "");
const token = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
const rejoinCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
};

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) _db = drizzle(process.env.DATABASE_URL);
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The game database is unavailable.");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field];
      updateSet[field] = user[field] ?? null;
    }
  }
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
}

async function makeJoinCode() {
  const db = await requireDb();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    const existing = await db.select({ id: games.id }).from(games).where(eq(games.joinCode, code)).limit(1);
    if (!existing.length) return code;
  }
  throw new Error("Could not reserve a join code. Please try again.");
}

export type GuestSession = { gameId: string; playerToken: string };

export async function createGame(displayName: string) {
  const db = await requireDb();
  const gameId = id();
  const hostPlayerId = id();
  const playerToken = token();
  const hostRejoinCode = rejoinCode();
  const joinCode = await makeJoinCode();
  const defaultCenter = { lat: 37.7749, lng: -122.4194 };
  await db.insert(games).values({
    id: gameId,
    joinCode,
    hostPlayerId,
    status: "setup",
    centerLat: defaultCenter.lat,
    centerLng: defaultCenter.lng,
    initialRadius: DEFAULT_RULES.initialRadiusMeters,
    minimumRadius: DEFAULT_RULES.minimumRadiusMeters,
    currentRadius: DEFAULT_RULES.initialRadiusMeters,
    rulesJson: JSON.stringify(DEFAULT_RULES),
    lastCaptureAt: new Date(),
  });
  await db.insert(gamePlayers).values({
    id: hostPlayerId,
    gameId,
    guestToken: playerToken,
    rejoinCode: hostRejoinCode,
    displayName,
    isHost: true,
    role: "survivor",
  });
  await addEvent(gameId, "game_created", hostPlayerId, null, "public", { name: displayName });
  return { joinCode, gameId, playerToken, playerId: hostPlayerId, rejoinCode: hostRejoinCode };
}

export async function joinGame(joinCode: string, displayName: string) {
  const db = await requireDb();
  const game = (await db.select().from(games).where(eq(games.joinCode, joinCode)).limit(1))[0];
  if (!game) throw new Error("That join code does not exist.");
  if (game.status === "running" || game.status === "finished") throw new Error("This match is not accepting new players.");
  const existingPlayers = await db.select({ id: gamePlayers.id }).from(gamePlayers).where(eq(gamePlayers.gameId, game.id));
  if (existingPlayers.length >= 8) throw new Error("This lobby is full.");
  const playerId = id();
  const playerToken = token();
  const playerRejoinCode = rejoinCode();
  await db.insert(gamePlayers).values({ id: playerId, gameId: game.id, guestToken: playerToken, rejoinCode: playerRejoinCode, displayName, role: "survivor" });
  await addEvent(game.id, "player_joined", playerId, null, "public", { name: displayName });
  return { joinCode: game.joinCode, gameId: game.id, playerToken, playerId, rejoinCode: playerRejoinCode };
}

export async function rejoinGame(joinCode: string, recoveryCode: string) {
  const db = await requireDb();
  const game = (await db.select().from(games).where(eq(games.joinCode, joinCode)).limit(1))[0];
  if (!game) throw new Error("That join code does not exist.");
  const player = (await db.select().from(gamePlayers).where(and(eq(gamePlayers.gameId, game.id), eq(gamePlayers.rejoinCode, recoveryCode))).limit(1))[0];
  if (!player) throw new Error("That recovery code does not match this game.");
  const playerToken = token();
  await db.update(gamePlayers).set({ guestToken: playerToken, status: player.status === "disconnected" ? "active" : player.status }).where(eq(gamePlayers.id, player.id));
  await addEvent(game.id, "player_rejoined", player.id, null, "public", { name: player.displayName });
  return { joinCode: game.joinCode, gameId: game.id, playerToken, playerId: player.id, rejoinCode: player.rejoinCode };
}

export async function getSessionPlayer(session: GuestSession) {
  const db = await requireDb();
  const player = (await db.select().from(gamePlayers).where(and(eq(gamePlayers.gameId, session.gameId), eq(gamePlayers.guestToken, session.playerToken))).limit(1))[0];
  if (!player) throw new Error("This game session has expired. Rejoin with the lobby code.");
  return player;
}

export async function addEvent(
  gameId: string,
  type: string,
  actorPlayerId: string | null,
  targetPlayerId: string | null,
  visibility: "public" | "host" | "target" | "zombies" | "survivors",
  payload: Record<string, unknown> = {},
) {
  const db = await requireDb();
  await db.insert(gameEvents).values({ id: id(), gameId, type, actorPlayerId, targetPlayerId, visibility, payloadJson: JSON.stringify(payload) });
}

export async function updateSetup(session: GuestSession, setup: { centerLat: number; centerLng: number; initialRadius: number; minimumRadius: number; points: Array<{ id?: string; type: "extraction" | "powerup_candidate"; label: string; lat: number; lng: number }> }) {
  const db = await requireDb();
  const player = await getSessionPlayer(session);
  if (!player.isHost) throw new Error("Only the host can configure the playing area.");
  if (setup.minimumRadius > setup.initialRadius) throw new Error("The minimum radius cannot exceed the starting radius.");
  const extractionPoints = setup.points.filter(point => point.type === "extraction");
  if (extractionPoints.length > 2) throw new Error("Use at most two extraction points.");
  if (extractionPoints.some(point => !markerPositionWithinBounds({ lat: setup.centerLat, lng: setup.centerLng }, point, setup.minimumRadius, 20))) {
    throw new Error("Extraction points must fit inside the smallest zone.");
  }
  await db.update(games).set({
    centerLat: setup.centerLat,
    centerLng: setup.centerLng,
    initialRadius: setup.initialRadius,
    minimumRadius: setup.minimumRadius,
    currentRadius: setup.initialRadius,
    status: "lobby",
  }).where(eq(games.id, session.gameId));
  await db.delete(gamePoints).where(eq(gamePoints.gameId, session.gameId));
  if (setup.points.length) {
    await db.insert(gamePoints).values(setup.points.map(point => ({
      id: point.id ?? id(), gameId: session.gameId, type: point.type, label: point.label, lat: point.lat, lng: point.lng,
    })));
  }
  await addEvent(session.gameId, "setup_saved", player.id, null, "public", { points: setup.points.length });
}

export async function setReady(session: GuestSession, isReady: boolean) {
  const db = await requireDb();
  const player = await getSessionPlayer(session);
  await db.update(gamePlayers).set({ isReady }).where(eq(gamePlayers.id, player.id));
  await addEvent(session.gameId, isReady ? "ready" : "not_ready", player.id, null, "public", { name: player.displayName });
}

export async function assignZombie(session: GuestSession, playerId: string, isZombie: boolean) {
  const db = await requireDb();
  const host = await getSessionPlayer(session);
  if (!host.isHost) throw new Error("Only the host can assign the initial zombie.");
  const target = (await db.select().from(gamePlayers).where(and(eq(gamePlayers.id, playerId), eq(gamePlayers.gameId, session.gameId))).limit(1))[0];
  if (!target) throw new Error("Player not found.");
  await db.update(gamePlayers).set({ role: isZombie ? "zombie" : "survivor" }).where(eq(gamePlayers.id, playerId));
}

export async function startGame(session: GuestSession) {
  const db = await requireDb();
  const host = await getSessionPlayer(session);
  if (!host.isHost) throw new Error("Only the host can start the match.");
  const game = (await db.select().from(games).where(eq(games.id, session.gameId)).limit(1))[0];
  if (!game || game.status === "running") throw new Error("This match cannot be started.");
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, session.gameId));
  if (players.length < 2) throw new Error("At least two players are needed to start.");
  let zombies = players.filter(player => player.role === "zombie");
  if (!zombies.length) {
    const chosen = players[Math.floor(Math.random() * players.length)];
    await db.update(gamePlayers).set({ role: "zombie" }).where(eq(gamePlayers.id, chosen.id));
    zombies = [chosen];
  }
  const now = new Date();
  await db.update(games).set({
    status: "running", startedAt: now, pausedAt: null, pausedSeconds: 0, nextPingAt: new Date(now.getTime() + 55_000),
    lastCaptureAt: now, stormPhase: "normal", stormPhaseEndsAt: null, lastItemSpawnAt: now, winner: null, finishedAt: null,
  }).where(eq(games.id, session.gameId));
  await db.update(gamePlayers).set({ status: "active", extractionStartedAt: null, boundaryOutsideSince: null, boundaryExposed: false }).where(eq(gamePlayers.gameId, session.gameId));
  await addEvent(session.gameId, "match_started", host.id, null, "public", { headStartSeconds: parseRules(game.rulesJson).headStartSeconds });
}

export async function pauseGame(session: GuestSession, paused: boolean) {
  const db = await requireDb();
  const host = await getSessionPlayer(session);
  if (!host.isHost) throw new Error("Only the host can pause or resume.");
  const game = (await db.select().from(games).where(eq(games.id, session.gameId)).limit(1))[0];
  if (!game) throw new Error("Game not found.");
  const now = new Date();
  if (paused && game.status === "running") {
    await db.update(games).set({ status: "paused", pausedAt: now }).where(eq(games.id, game.id));
  } else if (!paused && game.status === "paused") {
    const pausedFor = game.pausedAt ? Math.round((now.getTime() - game.pausedAt.getTime()) / 1000) : 0;
    await db.update(games).set({ status: "running", pausedAt: null, pausedSeconds: game.pausedSeconds + pausedFor }).where(eq(games.id, game.id));
  }
  await addEvent(session.gameId, paused ? "match_paused" : "match_resumed", host.id, null, "public", {});
}

export async function tickGame(gameId: string) {
  const db = await requireDb();
  const game = (await db.select().from(games).where(eq(games.id, gameId)).limit(1))[0];
  if (!game || game.status !== "running") return;
  const now = new Date();
  const rules = parseRules(game.rulesJson);
  const elapsed = elapsedGameSeconds(game.startedAt, game.pausedSeconds, now);
  if (elapsed >= rules.matchSeconds) {
    await db.update(games).set({ status: "finished", winner: "zombies", finishedAt: now }).where(eq(games.id, game.id));
    await addEvent(game.id, "match_finished", null, null, "public", { winner: "zombies", reason: "time_expired" });
    return;
  }
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, game.id));
  if (
    elapsed > 20 &&
    players.some(player =>
      player.status === "active" &&
      (!player.lastLocationAt || now.getTime() - player.lastLocationAt.getTime() > 20_000),
    )
  ) {
    await db.update(games).set({ status: "paused", pausedAt: now }).where(eq(games.id, game.id));
    await addEvent(game.id, "safety_pause", null, null, "public", { reason: "location_stale" });
    return;
  }
  for (const player of players.filter(player => player.status === "turning" && player.turnEndsAt && player.turnEndsAt <= now)) {
    await db.update(gamePlayers).set({ role: "zombie", status: "active", inventory: null, videoSkipArmed: false, turnEndsAt: null }).where(eq(gamePlayers.id, player.id));
    await addEvent(game.id, "player_turned", player.id, null, "public", { name: player.displayName });
  }
  const survivors = players.filter(player => player.role === "survivor" && player.status === "active");
  if (!survivors.length) {
    await db.update(games).set({ status: "finished", winner: "zombies", finishedAt: now }).where(eq(games.id, game.id));
    await addEvent(game.id, "match_finished", null, null, "public", { winner: "zombies", reason: "no_survivors" });
    return;
  }
  if (game.nextPingAt && game.nextPingAt <= now) {
    for (const player of survivors) {
      if (player.lastLat !== null && player.lastLng !== null) {
        await db.update(gamePlayers).set({ lastPingLat: player.lastLat, lastPingLng: player.lastLng, lastPingAt: now }).where(eq(gamePlayers.id, player.id));
      }
      if (player.videoSkipArmed) {
        await db.update(gamePlayers).set({ videoSkipArmed: false }).where(eq(gamePlayers.id, player.id));
        await addEvent(game.id, "video_skip_used", player.id, null, "target", {});
      } else {
        await db.update(gamePlayers).set({ videoDueAt: new Date(now.getTime() + 20_000), videoUploadDeadlineAt: new Date(now.getTime() + 50_000) }).where(eq(gamePlayers.id, player.id));
      }
    }
    const next = new Date(now.getTime() + pingIntervalSeconds(survivors.length) * 1000);
    await db.update(games).set({ nextPingAt: next }).where(eq(games.id, game.id));
    await addEvent(game.id, "survivor_ping", null, null, "public", { survivorCount: survivors.length, nextPingAt: next.toISOString() });
  }
  for (const player of players.filter(player => player.videoUploadDeadlineAt && player.videoUploadDeadlineAt <= now)) {
    await db.update(gamePlayers).set({ videoDueAt: null, videoUploadDeadlineAt: null }).where(eq(gamePlayers.id, player.id));
    await addEvent(game.id, "video_missing", player.id, null, "host", { name: player.displayName });
  }
  const secondsSinceCapture = game.lastCaptureAt ? (now.getTime() - game.lastCaptureAt.getTime()) / 1000 : 0;
  if (game.stormPhase === "normal" && secondsSinceCapture >= 120 && game.currentRadius > game.minimumRadius) {
    await db.update(games).set({ stormPhase: "warning", stormPhaseEndsAt: new Date(now.getTime() + 30_000) }).where(eq(games.id, game.id));
    await addEvent(game.id, "storm_warning", null, null, "public", { seconds: 30 });
  } else if (game.stormPhase === "warning" && game.stormPhaseEndsAt && game.stormPhaseEndsAt <= now) {
    await db.update(games).set({ stormPhase: "contracting", stormPhaseEndsAt: new Date(now.getTime() + 30_000) }).where(eq(games.id, game.id));
    await addEvent(game.id, "storm_contracting", null, null, "public", { percent: 15 });
  } else if (game.stormPhase === "contracting" && game.stormPhaseEndsAt && game.stormPhaseEndsAt <= now) {
    const nextRadius = Math.max(game.minimumRadius, game.currentRadius * 0.85);
    await db.update(games).set({ currentRadius: nextRadius, stormPhase: "normal", stormPhaseEndsAt: null, lastCaptureAt: now }).where(eq(games.id, game.id));
    await addEvent(game.id, "storm_contracted", null, null, "public", { radius: nextRadius });
  }
  if ((!game.lastItemSpawnAt || now.getTime() - game.lastItemSpawnAt.getTime() >= 60_000)) {
    const activeItems = await db.select().from(gameItems).where(and(eq(gameItems.gameId, game.id), eq(gameItems.status, "active"), gt(gameItems.expiresAt, now)));
    const points = await db.select().from(gamePoints).where(and(eq(gamePoints.gameId, game.id), eq(gamePoints.type, "powerup_candidate")));
    const effectiveRadius = effectiveStormRadius(game, now);
    const announcedNextRadius = game.stormPhase === "normal" ? effectiveRadius : Math.max(game.minimumRadius, game.currentRadius * 0.85);
    const eligible = points.filter(point => markerPositionWithinBounds({ lat: game.centerLat, lng: game.centerLng }, point, Math.min(effectiveRadius, announcedNextRadius)));
    if (activeItems.length < 2 && eligible.length) {
      const point = eligible[Math.floor(Math.random() * eligible.length)];
      const faction: "survivor" | "zombie" = Math.random() > 0.5 ? "survivor" : "zombie";
      const type: "hunt_scan" | "threat_scan" | "video_skip" = faction === "zombie" ? "hunt_scan" : Math.random() > 0.5 ? "threat_scan" : "video_skip";
      await db.insert(gameItems).values({ id: id(), gameId: game.id, spawnPointId: point.id, faction, type, lat: point.lat, lng: point.lng, expiresAt: new Date(now.getTime() + 90_000) });
    }
    await db.update(games).set({ lastItemSpawnAt: now }).where(eq(games.id, game.id));
  }
  const activeRadius = effectiveStormRadius(game, now);
  const activeItems = await db.select().from(gameItems).where(and(eq(gameItems.gameId, game.id), eq(gameItems.status, "active")));
  for (const item of activeItems.filter(item => item.expiresAt <= now || !markerPositionWithinBounds({ lat: game.centerLat, lng: game.centerLng }, item, activeRadius))) {
    await db.update(gameItems).set({ status: "expired" }).where(eq(gameItems.id, item.id));
  }
}

export async function reportLocation(session: GuestSession, location: { lat: number; lng: number; accuracy: number }) {
  const db = await requireDb();
  await tickGame(session.gameId);
  const player = await getSessionPlayer(session);
  const game = (await db.select().from(games).where(eq(games.id, session.gameId)).limit(1))[0];
  if (!game || game.status !== "running" || player.status !== "active") return;
  const now = new Date();
  const rules = parseRules(game.rulesJson);
  const previous = player.lastLat !== null && player.lastLng !== null && player.lastLocationAt && now.getTime() - player.lastLocationAt.getTime() <= 20_000
    ? { lat: player.lastLat, lng: player.lastLng }
    : null;
  const current = { lat: location.lat, lng: location.lng };
  const distanceToCenter = metersBetween({ lat: game.centerLat, lng: game.centerLng }, current);
  const safelyInside = distanceToCenter <= effectiveStormRadius(game, now) + Math.max(10, location.accuracy || 0);
  let boundaryOutsideSince = player.boundaryOutsideSince;
  let boundaryExposed = player.boundaryExposed;
  let status: "active" | "forfeited" = player.status;
  if (!safelyInside) {
    boundaryOutsideSince ??= now;
    const outsideSeconds = (now.getTime() - boundaryOutsideSince.getTime()) / 1000;
    boundaryExposed = outsideSeconds >= rules.boundaryGraceSeconds;
    if (outsideSeconds >= rules.boundaryForfeitSeconds) {
      status = "forfeited";
      await addEvent(game.id, "boundary_forfeit", player.id, null, "public", { name: player.displayName });
    }
  } else {
    boundaryOutsideSince = null;
    boundaryExposed = false;
  }
  let trailExposureUntil = player.trailExposureUntil;
  if (player.role === "zombie" && previous && elapsedGameSeconds(game.startedAt, game.pausedSeconds, now) >= rules.headStartSeconds) {
    const moved = metersBetween(previous, current);
    if (moved > 1 && moved < 120) {
      await db.insert(gameTrails).values({ id: id(), gameId: game.id, playerId: player.id, fromLat: previous.lat, fromLng: previous.lng, toLat: current.lat, toLng: current.lng, expiresAt: new Date(now.getTime() + rules.trailLifetimeSeconds * 1000) });
    }
  }
  if (player.role === "survivor") {
    const trails = await db.select().from(gameTrails).where(and(eq(gameTrails.gameId, game.id), gt(gameTrails.expiresAt, now)));
    if (trails.some(trail => distanceToSegmentMeters(current, { lat: trail.fromLat, lng: trail.fromLng }, { lat: trail.toLat, lng: trail.toLng }) <= rules.trailWidthMeters + Math.max(0, location.accuracy || 0))) {
      trailExposureUntil = new Date(now.getTime() + rules.trailExitExposureSeconds * 1000);
    }
  }
  let extractionStartedAt = player.extractionStartedAt;
  if (player.role === "survivor" && status === "active" && elapsedGameSeconds(game.startedAt, game.pausedSeconds, now) >= rules.extractionOpensAtSeconds) {
    const extraction = await db.select().from(gamePoints).where(and(eq(gamePoints.gameId, game.id), eq(gamePoints.type, "extraction")));
    const insideExtraction = extraction.some(point => metersBetween(current, point) <= 20 + Math.max(0, location.accuracy || 0));
    if (insideExtraction) {
      extractionStartedAt ??= now;
      const pending = await db.select().from(gameCaptureClaims).where(and(eq(gameCaptureClaims.gameId, game.id), eq(gameCaptureClaims.targetPlayerId, player.id), eq(gameCaptureClaims.status, "pending")));
      if (!pending.length && now.getTime() - extractionStartedAt.getTime() >= rules.extractionHoldSeconds * 1000) {
        await db.update(gamePlayers).set({ status: "escaped" }).where(eq(gamePlayers.id, player.id));
        await db.update(games).set({ status: "finished", winner: "survivors", finishedAt: now }).where(eq(games.id, game.id));
        await addEvent(game.id, "extraction_complete", player.id, null, "public", { name: player.displayName });
      }
    } else {
      extractionStartedAt = null;
    }
  }
  await db.update(gamePlayers).set({ lastLat: current.lat, lastLng: current.lng, lastLocationAt: now, boundaryOutsideSince, boundaryExposed, status, trailExposureUntil, extractionStartedAt }).where(eq(gamePlayers.id, player.id));
}

export async function collectItem(session: GuestSession, itemId: string) {
  const db = await requireDb();
  const player = await getSessionPlayer(session);
  if (player.inventory) throw new Error("Use your carried item before collecting another.");
  const item = (await db.select().from(gameItems).where(and(eq(gameItems.id, itemId), eq(gameItems.gameId, session.gameId))).limit(1))[0];
  if (!item || item.status !== "active" || item.expiresAt < new Date()) throw new Error("That item is no longer available.");
  if (item.faction !== player.role || player.lastLat === null || player.lastLng === null || metersBetween({ lat: player.lastLat, lng: player.lastLng }, item) > 30) throw new Error("Move closer to collect this item.");
  await db.update(gameItems).set({ status: "collected", collectedBy: player.id }).where(eq(gameItems.id, item.id));
  await db.update(gamePlayers).set({ inventory: item.type }).where(eq(gamePlayers.id, player.id));
  await addEvent(session.gameId, "item_collected", player.id, null, player.role === "zombie" ? "zombies" : "survivors", { type: item.type });
}

export async function useItem(session: GuestSession) {
  const db = await requireDb();
  const player = await getSessionPlayer(session);
  if (!player.inventory) throw new Error("No item is carried.");
  const inventory = player.inventory;
  await db.update(gamePlayers).set({ inventory: null, videoSkipArmed: inventory === "video_skip" }).where(eq(gamePlayers.id, player.id));
  if (inventory === "video_skip") {
    await addEvent(session.gameId, "video_skip_armed", player.id, null, "target", { type: inventory });
  } else {
    const targets = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, session.gameId));
    const snapshots = targets.filter(target => inventory === "hunt_scan" ? target.role === "survivor" : target.role === "zombie").filter(target => target.lastLat !== null && target.lastLng !== null).map(target => ({ id: target.id, name: target.displayName, lat: target.lastLat, lng: target.lastLng }));
    await addEvent(session.gameId, "scan_used", player.id, null, player.role === "zombie" ? "zombies" : "survivors", { type: inventory, snapshots });
  }
}

export async function resolveCapture(session: GuestSession, claimId: string, resolution: "confirm" | "dispute" | "host_capture" | "host_dismiss") {
  const db = await requireDb();
  const player = await getSessionPlayer(session);
  const claim = (await db.select().from(gameCaptureClaims).where(and(eq(gameCaptureClaims.id, claimId), eq(gameCaptureClaims.gameId, session.gameId))).limit(1))[0];
  if (!claim || claim.status === "resolved") throw new Error("Capture claim not found.");
  const isTarget = claim.targetPlayerId === player.id;
  if ((resolution === "confirm" || resolution === "dispute") && !isTarget) throw new Error("Only the targeted player can respond to this claim.");
  if ((resolution === "host_capture" || resolution === "host_dismiss") && !player.isHost) throw new Error("Only the host can resolve a disputed claim.");
  const capture = resolution === "confirm" || resolution === "host_capture";
  const now = new Date();
  if (resolution === "dispute") {
    await db.update(gameCaptureClaims).set({ status: "disputed" }).where(eq(gameCaptureClaims.id, claim.id));
    await addEvent(session.gameId, "capture_disputed", player.id, claim.zombiePlayerId, "host", { claimId });
    return;
  }
  await db.update(gameCaptureClaims).set({ status: "resolved", resolution: capture ? "capture" : "dismissed", resolvedAt: now }).where(eq(gameCaptureClaims.id, claim.id));
  if (capture) {
    await db.update(gamePlayers).set({ status: "turning", turnEndsAt: new Date(now.getTime() + DEFAULT_RULES.captureTurnSeconds * 1000), inventory: null, videoSkipArmed: false }).where(eq(gamePlayers.id, claim.targetPlayerId));
    await db.update(games).set({ lastCaptureAt: now }).where(eq(games.id, session.gameId));
    await addEvent(session.gameId, "capture_confirmed", claim.zombiePlayerId, claim.targetPlayerId, "public", { turnSeconds: DEFAULT_RULES.captureTurnSeconds });
  } else {
    await addEvent(session.gameId, "capture_dismissed", player.id, claim.zombiePlayerId, "public", {});
  }
}

export async function gameSnapshot(session: GuestSession) {
  await tickGame(session.gameId);
  const db = await requireDb();
  const viewer = await getSessionPlayer(session);
  const game = (await db.select().from(games).where(eq(games.id, session.gameId)).limit(1))[0];
  if (!game) throw new Error("Game not found.");
  const [allPlayers, points, trails, items, events, media, claims] = await Promise.all([
    db.select().from(gamePlayers).where(eq(gamePlayers.gameId, game.id)),
    db.select().from(gamePoints).where(eq(gamePoints.gameId, game.id)),
    db.select().from(gameTrails).where(and(eq(gameTrails.gameId, game.id), gt(gameTrails.expiresAt, new Date()))),
    db.select().from(gameItems).where(and(eq(gameItems.gameId, game.id), eq(gameItems.status, "active"))),
    db.select().from(gameEvents).where(eq(gameEvents.gameId, game.id)).orderBy(desc(gameEvents.createdAt)).limit(40),
    db.select().from(gameMedia).where(eq(gameMedia.gameId, game.id)).orderBy(desc(gameMedia.createdAt)).limit(20),
    db.select().from(gameCaptureClaims).where(eq(gameCaptureClaims.gameId, game.id)).orderBy(desc(gameCaptureClaims.createdAt)),
  ]);
  const now = new Date();
  const isHost = viewer.isHost;
  const canSeeLiveSurvivor = (target: typeof allPlayers[number]) => target.id === viewer.id || (viewer.role === "zombie" && (!!target.trailExposureUntil && target.trailExposureUntil > now || target.boundaryExposed));
  const visiblePlayers = allPlayers.map(target => {
    const base = { id: target.id, name: target.displayName, role: target.role, status: target.status, isHost: target.isHost, isReady: target.isReady, exposureUntil: target.trailExposureUntil, boundaryExposed: target.boundaryExposed, lastLocationAt: target.lastLocationAt };
    if (canSeeLiveSurvivor(target) || (viewer.role === "zombie" && target.role === "zombie")) return { ...base, lat: target.lastLat, lng: target.lastLng, positionKind: "live" as const };
    if (target.role === "survivor" && target.lastPingLat !== null && target.lastPingLng !== null) return { ...base, lat: target.lastPingLat, lng: target.lastPingLng, positionKind: "snapshot" as const };
    return { ...base, lat: null, lng: null, positionKind: "hidden" as const };
  });
  const visibleEvents = events.filter(event => event.visibility === "public" || (event.visibility === "host" && isHost) || (event.visibility === "target" && event.targetPlayerId === viewer.id) || (event.visibility === "zombies" && viewer.role === "zombie") || (event.visibility === "survivors" && viewer.role === "survivor"));
  const visibleMedia = media.filter(entry => isHost || entry.playerId === viewer.id || entry.targetPlayerId === viewer.id || (entry.visibility === "zombies" && viewer.role === "zombie") || (entry.visibility === "survivors" && viewer.role === "survivor")).map(entry => ({ ...entry, url: `/manus-storage/${entry.storageKey}` }));
  const visibleClaims = claims.filter(claim => isHost || claim.targetPlayerId === viewer.id || claim.zombiePlayerId === viewer.id);
  const visibleItems = items.filter(item => item.faction === viewer.role).filter(item => item.expiresAt > now);
  const rules = parseRules(game.rulesJson);
  const staleLocationSeconds = viewer.lastLocationAt ? Math.max(0, Math.floor((now.getTime() - viewer.lastLocationAt.getTime()) / 1000)) : null;
  return {
    game: { ...game, currentRadius: effectiveStormRadius(game, now), rules, elapsedSeconds: elapsedGameSeconds(game.startedAt, game.pausedSeconds, now) },
    viewer: { id: viewer.id, name: viewer.displayName, role: viewer.role, status: viewer.status, isHost: viewer.isHost, inventory: viewer.inventory, videoSkipArmed: viewer.videoSkipArmed, videoDueAt: viewer.videoDueAt, videoUploadDeadlineAt: viewer.videoUploadDeadlineAt, staleLocationSeconds, extractionStartedAt: viewer.extractionStartedAt, boundaryOutsideSince: viewer.boundaryOutsideSince },
    players: visiblePlayers,
    points,
    trails: viewer.role === "zombie" || isHost ? trails : [],
    items: visibleItems,
    events: visibleEvents.map(event => ({ ...event, payload: event.payloadJson ? JSON.parse(event.payloadJson) : {} })),
    media: visibleMedia,
    claims: visibleClaims,
  };
}

export async function createMediaEntry(input: { gameId: string; playerId: string; targetPlayerId?: string | null; kind: "photo" | "video"; visibility: "host" | "target" | "zombies" | "survivors"; storageKey: string; mimeType: string; durationSeconds?: number | null }) {
  const db = await requireDb();
  const mediaId = id();
  await db.insert(gameMedia).values({ id: mediaId, ...input });
  if (input.kind === "photo" && input.targetPlayerId) {
    const pending = await db.select().from(gameCaptureClaims).where(and(eq(gameCaptureClaims.gameId, input.gameId), eq(gameCaptureClaims.targetPlayerId, input.targetPlayerId), inArray(gameCaptureClaims.status, ["pending", "disputed"])));
    if (pending.length) throw new Error("That player already has a pending capture claim.");
    await db.insert(gameCaptureClaims).values({ id: id(), gameId: input.gameId, zombiePlayerId: input.playerId, targetPlayerId: input.targetPlayerId, mediaId, status: "pending" });
    await addEvent(input.gameId, "capture_requested", input.playerId, input.targetPlayerId, "target", { mediaId });
  } else {
    await db.update(gamePlayers).set({ videoDueAt: null, videoUploadDeadlineAt: null }).where(eq(gamePlayers.id, input.playerId));
    await addEvent(input.gameId, "surroundings_video", input.playerId, null, "zombies", { mediaId });
  }
  return mediaId;
}
