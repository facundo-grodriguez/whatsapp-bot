CREATE TABLE `categories` (
	`slug` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`state` text DEFAULT 'activa' NOT NULL,
	`derived_at` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversations_channel_state_idx` ON `conversations` (`channel_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_channel_chat_unique` ON `conversations` (`channel_id`,`chat_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`provider_message_id` text,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`category` text,
	`is_purchase_intent` integer DEFAULT false NOT NULL,
	`needs_human_review` integer DEFAULT false NOT NULL,
	`reviewed_at` integer,
	`in_reply_to_id` integer,
	`wa_timestamp` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category`) REFERENCES `categories`(`slug`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_reply_to_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_provider_message_id_unique` ON `messages` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_id_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `messages_category_idx` ON `messages` (`category`);--> statement-breakpoint
CREATE INDEX `messages_created_at_idx` ON `messages` (`created_at`);