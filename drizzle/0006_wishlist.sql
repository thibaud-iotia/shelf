CREATE TABLE `wishlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`steam_app_id` text,
	`cheapshark_id` text,
	`image_url` text,
	`from_steam` integer DEFAULT false NOT NULL,
	`by_user` integer DEFAULT false NOT NULL,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_steam_app_id_unique` ON `wishlist` (`steam_app_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_cheapshark_id_unique` ON `wishlist` (`cheapshark_id`);