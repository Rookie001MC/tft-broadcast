CREATE TABLE `tft_match_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`riot_match_id` text NOT NULL,
	`region` text NOT NULL,
	`queue_id` integer NOT NULL,
	`contract_version` integer NOT NULL,
	`completed_at` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`saved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tft_match_snapshots_match_idx` ON `tft_match_snapshots` (`region`,`riot_match_id`);--> statement-breakpoint
CREATE INDEX `tft_match_snapshots_tournament_idx` ON `tft_match_snapshots` (`tournament_id`,`saved_at`);--> statement-breakpoint
CREATE TABLE `tft_match_snapshot_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`puuid` text NOT NULL,
	`placement` integer NOT NULL,
	`board_json` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `tft_match_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tft_match_snapshot_participants_puuid_uq` ON `tft_match_snapshot_participants` (`snapshot_id`,`puuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `tft_match_snapshot_participants_placement_uq` ON `tft_match_snapshot_participants` (`snapshot_id`,`placement`);--> statement-breakpoint
ALTER TABLE `winner_board_state` ADD `source_tft_match_snapshot_id` text REFERENCES tft_match_snapshots(id) ON DELETE set null;
