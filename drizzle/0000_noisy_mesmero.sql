CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `catalog_augments` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_snapshot_id` text NOT NULL,
	`external_id` text NOT NULL,
	`display_name` text NOT NULL,
	`icon_path` text,
	`tier` integer,
	`metadata_json` text NOT NULL,
	FOREIGN KEY (`catalog_snapshot_id`) REFERENCES `catalog_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_augments_snapshot_external_uq` ON `catalog_augments` (`catalog_snapshot_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `catalog_champions` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_snapshot_id` text NOT NULL,
	`external_id` text NOT NULL,
	`display_name` text NOT NULL,
	`icon_path` text,
	`tier` integer,
	`metadata_json` text NOT NULL,
	FOREIGN KEY (`catalog_snapshot_id`) REFERENCES `catalog_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_champions_snapshot_external_uq` ON `catalog_champions` (`catalog_snapshot_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `catalog_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`locale` text NOT NULL,
	`patch_label` text NOT NULL,
	`set_label` text,
	`synced_at` integer NOT NULL,
	`is_available` integer DEFAULT false NOT NULL,
	`metadata_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`riot_id` text,
	`riot_id_key` text,
	`riot_game_name` text,
	`riot_tagline` text,
	`full_name` text NOT NULL,
	`display_name` text NOT NULL,
	`image_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_riot_id_key_unique` ON `players` (`riot_id_key`);--> statement-breakpoint
CREATE TABLE `tournament_players` (
	`tournament_id` text NOT NULL,
	`player_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`notes` text,
	PRIMARY KEY(`tournament_id`, `player_id`),
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`active_catalog_snapshot_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`active_catalog_snapshot_id`) REFERENCES `catalog_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_slug_unique` ON `tournaments` (`slug`);--> statement-breakpoint
CREATE TABLE `graphic_state` (
	`id` text PRIMARY KEY NOT NULL,
	`published_winner_board_id` text,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`published_winner_board_id`) REFERENCES `winner_boards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `winner_board_augments` (
	`id` text PRIMARY KEY NOT NULL,
	`winner_board_id` text NOT NULL,
	`catalog_augment_id` text NOT NULL,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`winner_board_id`) REFERENCES `winner_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_augment_id`) REFERENCES `catalog_augments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `winner_board_champions` (
	`id` text PRIMARY KEY NOT NULL,
	`winner_board_id` text NOT NULL,
	`catalog_champion_id` text NOT NULL,
	`star_level` integer,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`winner_board_id`) REFERENCES `winner_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_champion_id`) REFERENCES `catalog_champions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `winner_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`winner_player_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `player_import_previews` (
	`token` text PRIMARY KEY NOT NULL,
	`staged_path` text NOT NULL,
	`sha256` text NOT NULL,
	`preview_json` text NOT NULL,
	`status` text DEFAULT 'previewed' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `first_operator_claim` (
	`id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`status` text NOT NULL,
	`claimed_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "first_operator_claim_singleton_ck" CHECK("first_operator_claim"."id" = 1),
	CONSTRAINT "first_operator_claim_status_ck" CHECK("first_operator_claim"."status" IN ('pending', 'complete'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `first_operator_claim_token_unique` ON `first_operator_claim` (`token`);