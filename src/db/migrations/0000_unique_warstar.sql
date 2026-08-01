CREATE TABLE `categories` (
	`slug` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_name` text NOT NULL,
	`chat_id` text NOT NULL,
	`state` text DEFAULT 'activa' NOT NULL,
	`derived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversations_session_state_idx` ON `conversations` (`session_name`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_session_chat_unique` ON `conversations` (`session_name`,`chat_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`waha_message_id` text,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`category` text,
	`is_purchase_intent` integer DEFAULT false NOT NULL,
	`needs_human_review` integer DEFAULT false NOT NULL,
	`in_reply_to_id` integer,
	`wa_timestamp` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category`) REFERENCES `categories`(`slug`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_reply_to_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_waha_message_id_unique` ON `messages` (`waha_message_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_id_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `messages_category_idx` ON `messages` (`category`);--> statement-breakpoint
CREATE INDEX `messages_created_at_idx` ON `messages` (`created_at`);