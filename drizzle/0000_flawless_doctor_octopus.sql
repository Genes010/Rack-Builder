CREATE TABLE `rack_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`object_key` text NOT NULL,
	`rack_count` integer DEFAULT 0 NOT NULL,
	`gear_count` integer DEFAULT 0 NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rack_projects_updated_at_idx` ON `rack_projects` (`updated_at`);