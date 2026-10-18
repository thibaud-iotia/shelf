CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`display_name` text NOT NULL,
	`external_user_id` text NOT NULL,
	`credentials_ref` text,
	`last_sync_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_source_external_unique` ON `accounts` (`source`,`external_user_id`);--> statement-breakpoint
CREATE TABLE `collection_games` (
	`collection_id` integer NOT NULL,
	`game_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`collection_id`, `game_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_name_unique` ON `collections` (`name`);--> statement-breakpoint
CREATE TABLE `game_tags` (
	`game_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`game_id`, `tag_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`ownership` text DEFAULT 'manual' NOT NULL,
	`install_state` text DEFAULT 'unknown' NOT NULL,
	`install_path` text,
	`executable_path` text,
	`launch_args` text,
	`cover_path` text,
	`hero_path` text,
	`description` text,
	`release_date` text,
	`igdb_id` integer,
	`favorite` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_source_source_id_unique` ON `games` (`source`,`source_id`);--> statement-breakpoint
CREATE TABLE `play_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_sec` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `play_sessions_game_id_idx` ON `play_sessions` (`game_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);