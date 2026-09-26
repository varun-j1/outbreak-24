import { boolean, double, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "user"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const games = mysqlTable("games", {
  id: varchar("id", { length: 32 }).primaryKey(),
  joinCode: varchar("joinCode", { length: 8 }).notNull(),
  hostPlayerId: varchar("hostPlayerId", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["setup", "lobby", "running", "paused", "finished"]).default("setup").notNull(),
  centerLat: double("centerLat").notNull(),
  centerLng: double("centerLng").notNull(),
  initialRadius: double("initialRadius").notNull(),
  minimumRadius: double("minimumRadius").notNull(),
  currentRadius: double("currentRadius").notNull(),
  rulesJson: text("rulesJson").notNull(),
  startedAt: timestamp("startedAt"),
  pausedAt: timestamp("pausedAt"),
  pausedSeconds: int("pausedSeconds").default(0).notNull(),
  nextPingAt: timestamp("nextPingAt"),
  lastCaptureAt: timestamp("lastCaptureAt"),
  stormPhase: mysqlEnum("stormPhase", ["normal", "warning", "contracting"]).default("normal").notNull(),
  stormPhaseEndsAt: timestamp("stormPhaseEndsAt"),
  lastItemSpawnAt: timestamp("lastItemSpawnAt"),
  winner: mysqlEnum("winner", ["survivors", "zombies"]),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("games_join_code_unique").on(table.joinCode)]);

export const gamePlayers = mysqlTable("gamePlayers", {
  id: varchar("id", { length: 32 }).primaryKey(),
  gameId: varchar("gameId", { length: 32 }).notNull(),
  guestToken: varchar("guestToken", { length: 80 }).notNull(),
  rejoinCode: varchar("rejoinCode", { length: 12 }).notNull(),
  displayName: varchar("displayName", { length: 36 }).notNull(),
  profileImageKey: varchar("profileImageKey", { length: 256 }),
  isHost: boolean("isHost").default(false).notNull(),
  role: mysqlEnum("role", ["survivor", "zombie", "spectator"]).default("survivor").notNull(),
  status: mysqlEnum("status", ["active", "turning", "escaped", "forfeited", "disconnected"]).default("active").notNull(),
  isReady: boolean("isReady").default(false).notNull(),
  lastLat: double("lastLat"),
  lastLng: double("lastLng"),
  lastLocationAt: timestamp("lastLocationAt"),
  lastPingLat: double("lastPingLat"),
  lastPingLng: double("lastPingLng"),
  lastPingAt: timestamp("lastPingAt"),
  trailExposureUntil: timestamp("trailExposureUntil"),
  boundaryOutsideSince: timestamp("boundaryOutsideSince"),
  boundaryExposed: boolean("boundaryExposed").default(false).notNull(),
  extractionStartedAt: timestamp("extractionStartedAt"),
  inventory: mysqlEnum("inventory", ["hunt_scan", "threat_scan", "video_skip"]),
  videoSkipArmed: boolean("videoSkipArmed").default(false).notNull(),
  videoDueAt: timestamp("videoDueAt"),
  videoUploadDeadlineAt: timestamp("videoUploadDeadlineAt"),
  turnEndsAt: timestamp("turnEndsAt"),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("game_players_guest_token_unique").on(table.guestToken),
  uniqueIndex("game_players_rejoin_code_unique").on(table.gameId, table.rejoinCode),
  index("game_players_game_idx").on(table.gameId),
]);

export const gamePoints = mysqlTable("gamePoints", {
  id: varchar("id", { length: 32 }).primaryKey(),
  gameId: varchar("gameId", { length: 32 }).notNull(),
  type: mysqlEnum("type", ["extraction", "powerup_candidate"]).notNull(),
  label: varchar("label", { length: 32 }).notNull(),
  lat: double("lat").notNull(),
  lng: double("lng").notNull(),
  isActive: boolean("isActive").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("game_points_game_idx").on(table.gameId)]);

export const gameTrails = mysqlTable("gameTrails", {
  id: varchar("id", { length: 32 }).primaryKey(),
  gameId: varchar("gameId", { length: 32 }).notNull(),
  playerId: varchar("playerId", { length: 32 }).notNull(),
  fromLat: double("fromLat").notNull(),
  fromLng: double("fromLng").notNull(),
  toLat: double("toLat").notNull(),
  toLng: double("toLng").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("game_trails_active_idx").on(table.gameId, table.expiresAt)]);

export const gameItems = mysqlTable("gameItems", {
  id: varchar("id", { length: 32 }).primaryKey(),
  gameId: varchar("gameId", { length: 32 }).notNull(),
  spawnPointId: varchar("spawnPointId", { length: 32 }).notNull(),
  type: mysqlEnum("type", ["hunt_scan", "threat_scan", "video_skip"]).notNull(),
  faction: mysqlEnum("faction", ["survivor", "zombie"]).notNull(),
  lat: double("lat").notNull(),
  lng: double("lng").notNull(),
  status: mysqlEnum("status", ["active", "collected", "expired"]).default("active").notNull(),
  collectedBy: varchar("collectedBy", { length: 32 }),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("game_items_game_idx").on(table.gameId, table.status)]);

export const gameMedia = mysqlTable("gameMedia", {
  id: varchar("id", { length: 32 }).primaryKey(),
  gameId: varchar("gameId", { length: 32 }).notNull(),
  playerId: varchar("playerId", { length: 32 }).notNull(),
  targetPlayerId: varchar("targetPlayerId", { length: 32 }),
  kind: mysqlEnum("kind", ["photo", "video"]).notNull(),
  visibility: mysqlEnum("visibility", ["host", "target", "zombies", "survivors"]).notNull(),
  storageKey: varchar("storageKey", { length: 256 }).notNull(),
  mimeType: varchar("mimeType", { length: 80 }).notNull(),
  durationSeconds: int("durationSeconds"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("game_media_game_idx").on(table.gameId)]);

export const gameCaptureClaims = mysqlTable("gameCaptureClaims", {
  id: varchar("id", { length: 32 }).primaryKey(),
  gameId: varchar("gameId", { length: 32 }).notNull(),
  zombiePlayerId: varchar("zombiePlayerId", { length: 32 }).notNull(),
  targetPlayerId: varchar("targetPlayerId", { length: 32 }).notNull(),
  mediaId: varchar("mediaId", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "disputed", "resolved"]).default("pending").notNull(),
  resolution: mysqlEnum("resolution", ["capture", "dismissed"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
}, table => [index("game_capture_claims_game_idx").on(table.gameId, table.targetPlayerId)]);

export const gameEvents = mysqlTable("gameEvents", {
  id: varchar("id", { length: 32 }).primaryKey(),
  gameId: varchar("gameId", { length: 32 }).notNull(),
  actorPlayerId: varchar("actorPlayerId", { length: 32 }),
  targetPlayerId: varchar("targetPlayerId", { length: 32 }),
  type: varchar("type", { length: 48 }).notNull(),
  visibility: mysqlEnum("visibility", ["public", "host", "target", "zombies", "survivors"]).default("public").notNull(),
  payloadJson: text("payloadJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("game_events_game_idx").on(table.gameId, table.createdAt)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
