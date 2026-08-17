CREATE TABLE `tft_match_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`riot_match_id` text NOT NULL,
	`region` text NOT NULL,
	`tournament_id` text NOT NULL,
	`selected_player_id` text NOT NULL,
	`active_catalog_snapshot_id` text NOT NULL,
	`contract_version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`saved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tft_match_snapshots_match_idx` ON `tft_match_snapshots` (`region`,`riot_match_id`);--> statement-breakpoint
CREATE INDEX `tft_match_snapshots_tournament_idx` ON `tft_match_snapshots` (`tournament_id`,`saved_at`);--> statement-breakpoint
ALTER TABLE `winner_board_state` ADD `source_tft_match_snapshot_id` text REFERENCES tft_match_snapshots(id) ON DELETE SET NULL;
