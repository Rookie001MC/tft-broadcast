CREATE TABLE `catalog_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_set_key` text,
	`patch_label` text NOT NULL,
	`resource_kind` text NOT NULL,
	`operation` text NOT NULL,
	`target_external_id` text,
	`manual_external_id` text,
	`display_name_override` text,
	`tier_override` integer,
	`image_path_override` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_corrections_scope_idx` ON `catalog_corrections` (`canonical_set_key`,`patch_label`,`resource_kind`);--> statement-breakpoint
ALTER TABLE `catalog_augments` ADD `correction_id` text REFERENCES catalog_corrections(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `catalog_augments` ADD `is_excluded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_augments` ADD `provenance_json` text DEFAULT '{"source":"upstream"}' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_champions` ADD `correction_id` text REFERENCES catalog_corrections(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `catalog_champions` ADD `is_excluded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_champions` ADD `provenance_json` text DEFAULT '{"source":"upstream"}' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_snapshots` ADD `canonical_set_key` text;
