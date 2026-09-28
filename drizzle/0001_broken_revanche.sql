CREATE TABLE `trackman_push_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`resource_id` text,
	`expires_at` integer NOT NULL,
	`last_message` text
);
--> statement-breakpoint
CREATE TABLE `trackman_push_files` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`completed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trackman_push_state` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`script_url` text,
	`last_event_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`last_result` text
);
