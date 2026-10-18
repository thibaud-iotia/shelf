ALTER TABLE `accounts` ADD `kind` text DEFAULT 'steam' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `rules` text;--> statement-breakpoint
ALTER TABLE `games` ADD `logo_path` text;--> statement-breakpoint
ALTER TABLE `games` ADD `screenshots` text;--> statement-breakpoint
ALTER TABLE `games` ADD `developer` text;--> statement-breakpoint
ALTER TABLE `games` ADD `genres` text;--> statement-breakpoint
ALTER TABLE `games` ADD `external_playtime_min` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `save_path` text;--> statement-breakpoint
ALTER TABLE `games` ADD `use_runner` integer DEFAULT false NOT NULL;