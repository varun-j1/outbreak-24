ALTER TABLE `gamePlayers` ADD `rejoinCode` varchar(12) NOT NULL;--> statement-breakpoint
ALTER TABLE `gamePlayers` ADD CONSTRAINT `game_players_rejoin_code_unique` UNIQUE(`gameId`,`rejoinCode`);