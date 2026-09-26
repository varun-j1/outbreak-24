CREATE TABLE `gameCaptureClaims` (
	`id` varchar(32) NOT NULL,
	`gameId` varchar(32) NOT NULL,
	`zombiePlayerId` varchar(32) NOT NULL,
	`targetPlayerId` varchar(32) NOT NULL,
	`mediaId` varchar(32) NOT NULL,
	`status` enum('pending','confirmed','disputed','resolved') NOT NULL DEFAULT 'pending',
	`resolution` enum('capture','dismissed'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `gameCaptureClaims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gameEvents` (
	`id` varchar(32) NOT NULL,
	`gameId` varchar(32) NOT NULL,
	`actorPlayerId` varchar(32),
	`targetPlayerId` varchar(32),
	`type` varchar(48) NOT NULL,
	`visibility` enum('public','host','target','zombies','survivors') NOT NULL DEFAULT 'public',
	`payloadJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gameEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gameItems` (
	`id` varchar(32) NOT NULL,
	`gameId` varchar(32) NOT NULL,
	`spawnPointId` varchar(32) NOT NULL,
	`type` enum('hunt_scan','threat_scan','video_skip') NOT NULL,
	`faction` enum('survivor','zombie') NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`status` enum('active','collected','expired') NOT NULL DEFAULT 'active',
	`collectedBy` varchar(32),
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gameItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gameMedia` (
	`id` varchar(32) NOT NULL,
	`gameId` varchar(32) NOT NULL,
	`playerId` varchar(32) NOT NULL,
	`targetPlayerId` varchar(32),
	`kind` enum('photo','video') NOT NULL,
	`visibility` enum('host','target','zombies','survivors') NOT NULL,
	`storageKey` varchar(256) NOT NULL,
	`mimeType` varchar(80) NOT NULL,
	`durationSeconds` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gameMedia_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gamePlayers` (
	`id` varchar(32) NOT NULL,
	`gameId` varchar(32) NOT NULL,
	`guestToken` varchar(80) NOT NULL,
	`displayName` varchar(36) NOT NULL,
	`isHost` boolean NOT NULL DEFAULT false,
	`role` enum('survivor','zombie','spectator') NOT NULL DEFAULT 'survivor',
	`status` enum('active','turning','escaped','forfeited','disconnected') NOT NULL DEFAULT 'active',
	`isReady` boolean NOT NULL DEFAULT false,
	`lastLat` double,
	`lastLng` double,
	`lastLocationAt` timestamp,
	`lastPingLat` double,
	`lastPingLng` double,
	`lastPingAt` timestamp,
	`trailExposureUntil` timestamp,
	`boundaryOutsideSince` timestamp,
	`boundaryExposed` boolean NOT NULL DEFAULT false,
	`extractionStartedAt` timestamp,
	`inventory` enum('hunt_scan','threat_scan','video_skip'),
	`videoSkipArmed` boolean NOT NULL DEFAULT false,
	`turnEndsAt` timestamp,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gamePlayers_id` PRIMARY KEY(`id`),
	CONSTRAINT `game_players_guest_token_unique` UNIQUE(`guestToken`)
);
--> statement-breakpoint
CREATE TABLE `gamePoints` (
	`id` varchar(32) NOT NULL,
	`gameId` varchar(32) NOT NULL,
	`type` enum('extraction','powerup_candidate') NOT NULL,
	`label` varchar(32) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gamePoints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gameTrails` (
	`id` varchar(32) NOT NULL,
	`gameId` varchar(32) NOT NULL,
	`playerId` varchar(32) NOT NULL,
	`fromLat` double NOT NULL,
	`fromLng` double NOT NULL,
	`toLat` double NOT NULL,
	`toLng` double NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gameTrails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` varchar(32) NOT NULL,
	`joinCode` varchar(8) NOT NULL,
	`hostPlayerId` varchar(32) NOT NULL,
	`status` enum('setup','lobby','running','paused','finished') NOT NULL DEFAULT 'setup',
	`centerLat` double NOT NULL,
	`centerLng` double NOT NULL,
	`initialRadius` double NOT NULL,
	`minimumRadius` double NOT NULL,
	`currentRadius` double NOT NULL,
	`rulesJson` text NOT NULL,
	`startedAt` timestamp,
	`pausedAt` timestamp,
	`pausedSeconds` int NOT NULL DEFAULT 0,
	`nextPingAt` timestamp,
	`lastCaptureAt` timestamp,
	`stormPhase` enum('normal','warning','contracting') NOT NULL DEFAULT 'normal',
	`stormPhaseEndsAt` timestamp,
	`lastItemSpawnAt` timestamp,
	`winner` enum('survivors','zombies'),
	`finishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `games_id` PRIMARY KEY(`id`),
	CONSTRAINT `games_join_code_unique` UNIQUE(`joinCode`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','user') NOT NULL DEFAULT 'user';--> statement-breakpoint
CREATE INDEX `game_capture_claims_game_idx` ON `gameCaptureClaims` (`gameId`,`targetPlayerId`);--> statement-breakpoint
CREATE INDEX `game_events_game_idx` ON `gameEvents` (`gameId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `game_items_game_idx` ON `gameItems` (`gameId`,`status`);--> statement-breakpoint
CREATE INDEX `game_media_game_idx` ON `gameMedia` (`gameId`);--> statement-breakpoint
CREATE INDEX `game_players_game_idx` ON `gamePlayers` (`gameId`);--> statement-breakpoint
CREATE INDEX `game_points_game_idx` ON `gamePoints` (`gameId`);--> statement-breakpoint
CREATE INDEX `game_trails_active_idx` ON `gameTrails` (`gameId`,`expiresAt`);