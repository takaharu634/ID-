CREATE TABLE `feature_daily_views` (
	`day` text NOT NULL,
	`feature` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `feature`)
);
