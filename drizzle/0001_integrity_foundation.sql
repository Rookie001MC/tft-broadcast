CREATE TABLE `winner_board_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`source_state_updated_at` integer NOT NULL,
	`graphic_version` integer NOT NULL,
	`render_payload_json` text NOT NULL,
	`media_directory` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `winner_board_publications_graphic_version_unique` ON `winner_board_publications` (`graphic_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `winner_board_publications_media_directory_unique` ON `winner_board_publications` (`media_directory`);--> statement-breakpoint
CREATE TABLE `winner_board_state` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`winner_player_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `winner_board_state_augments` (
	`id` text PRIMARY KEY NOT NULL,
	`winner_board_state_id` text NOT NULL,
	`catalog_augment_id` text NOT NULL,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`winner_board_state_id`) REFERENCES `winner_board_state`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_augment_id`) REFERENCES `catalog_augments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `winner_board_state_champions` (
	`id` text PRIMARY KEY NOT NULL,
	`winner_board_state_id` text NOT NULL,
	`catalog_champion_id` text NOT NULL,
	`star_level` integer,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`winner_board_state_id`) REFERENCES `winner_board_state`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_champion_id`) REFERENCES `catalog_champions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `winner_board_state` (`id`, `tournament_id`, `winner_player_id`, `title`, `created_at`, `updated_at`)
SELECT 'current', `tournament_id`, `winner_player_id`, `title`, `created_at`, `updated_at`
FROM `winner_boards`
WHERE `id` = (
	SELECT COALESCE(
		(SELECT `published_winner_board_id` FROM `graphic_state` WHERE `id` = 'live'),
		(SELECT `id` FROM `winner_boards` WHERE `status` = 'draft' ORDER BY `updated_at` DESC LIMIT 1)
	)
);
--> statement-breakpoint
INSERT INTO `winner_board_state_champions` (`id`, `winner_board_state_id`, `catalog_champion_id`, `star_level`, `display_order`)
SELECT `id`, 'current', `catalog_champion_id`, `star_level`, `display_order`
FROM `winner_board_champions`
WHERE `winner_board_id` = (
	SELECT COALESCE(
		(SELECT `published_winner_board_id` FROM `graphic_state` WHERE `id` = 'live'),
		(SELECT `id` FROM `winner_boards` WHERE `status` = 'draft' ORDER BY `updated_at` DESC LIMIT 1)
	)
)
ORDER BY `display_order`, `id`;
--> statement-breakpoint
INSERT INTO `winner_board_state_augments` (`id`, `winner_board_state_id`, `catalog_augment_id`, `display_order`)
SELECT `id`, 'current', `catalog_augment_id`, `display_order`
FROM `winner_board_augments`
WHERE `winner_board_id` = (
	SELECT COALESCE(
		(SELECT `published_winner_board_id` FROM `graphic_state` WHERE `id` = 'live'),
		(SELECT `id` FROM `winner_boards` WHERE `status` = 'draft' ORDER BY `updated_at` DESC LIMIT 1)
	)
)
ORDER BY `display_order`, `id`;
--> statement-breakpoint
CREATE TABLE `__new_graphic_state` (
	`id` text PRIMARY KEY NOT NULL,
	`published_publication_id` text,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`published_publication_id`) REFERENCES `winner_board_publications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_graphic_state` (`id`, `published_publication_id`, `version`, `updated_at`)
SELECT `id`, NULL, `version`, `updated_at`
FROM `graphic_state`
WHERE `id` = 'live';
--> statement-breakpoint
DROP TABLE `graphic_state`;
--> statement-breakpoint
ALTER TABLE `__new_graphic_state` RENAME TO `graphic_state`;
--> statement-breakpoint
DROP TABLE `winner_board_augments`;
--> statement-breakpoint
DROP TABLE `winner_board_champions`;
--> statement-breakpoint
DROP TABLE `winner_boards`;
