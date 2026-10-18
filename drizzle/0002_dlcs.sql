CREATE TABLE `game_dlcs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_dlcs_source_source_id_unique` ON `game_dlcs` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `game_dlcs_game_id_idx` ON `game_dlcs` (`game_id`);