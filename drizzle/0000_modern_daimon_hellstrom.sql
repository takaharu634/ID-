CREATE TABLE `data_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`raw_object_key` text NOT NULL,
	`summary_object_key` text NOT NULL,
	`pitch_count` integer NOT NULL,
	`game_count` integer NOT NULL,
	`team_count` integer NOT NULL,
	`is_active` integer DEFAULT false NOT NULL
);
