CREATE TABLE `tft_match_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`region` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "tft_match_settings_singleton_ck" CHECK("tft_match_settings"."id" = 1)
);
