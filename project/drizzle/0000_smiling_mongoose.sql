CREATE TABLE `additives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`reference_id` integer,
	`description` text,
	`sale_plan` text DEFAULT 'DAILY',
	`status` text DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `additives_code_unique` ON `additives` (`code`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`unique_code` text NOT NULL,
	`type` text NOT NULL,
	`discount_percent` real DEFAULT 0,
	`priority` integer DEFAULT 0,
	`minimum_purchase` integer DEFAULT 0,
	`maximum_discount` integer DEFAULT 0,
	`starts_at` text,
	`ends_at` text,
	`status` text DEFAULT 'ACTIVE'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_unique_code_unique` ON `campaigns` (`unique_code`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`language` text DEFAULT 'fa' NOT NULL,
	`parent_id` integer,
	`display_order` integer DEFAULT 0,
	`max_cost_percent` real,
	`icon` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`membership_code` text NOT NULL,
	`full_name` text NOT NULL,
	`mobile` text,
	`gender` text,
	`birth_date` text,
	`customer_type` text DEFAULT 'REGULAR',
	`category` text,
	`status` text DEFAULT 'ACTIVE',
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_membership_code_unique` ON `customers` (`membership_code`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`expense_type` text NOT NULL,
	`category` text,
	`subject` text NOT NULL,
	`occurred_at` text NOT NULL,
	`amount` integer NOT NULL,
	`supplier` text,
	`fund` text NOT NULL,
	`payment_type` text NOT NULL,
	`spender` text,
	`payment_method` text DEFAULT 'FULL' NOT NULL,
	`description` text,
	`attachment_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_code_unique` ON `expenses` (`code`);--> statement-breakpoint
CREATE TABLE `financial_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_type` text NOT NULL,
	`source_fund` text,
	`destination_fund` text,
	`amount` integer NOT NULL,
	`subject` text,
	`customer_id` integer,
	`paid_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`source_warehouse_id` integer,
	`destination_warehouse_id` integer,
	`movement_type` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_price` integer DEFAULT 0,
	`invoice_code` text,
	`occurred_at` text NOT NULL,
	`supplier` text,
	`description` text,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_number` text NOT NULL,
	`customer_id` integer,
	`terminal` text,
	`subtotal` integer NOT NULL,
	`discount` integer DEFAULT 0,
	`tax` integer DEFAULT 0,
	`service_fee` integer DEFAULT 0,
	`delivery_fee` integer DEFAULT 0,
	`total` integer NOT NULL,
	`status` text NOT NULL,
	`paid_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_number_unique` ON `invoices` (`invoice_number`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`category` text,
	`reorder_point` real DEFAULT 0,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_code_unique` ON `materials` (`code`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category_id` integer,
	`price` integer NOT NULL,
	`vat_percent` real DEFAULT 0,
	`packaging_price` integer DEFAULT 0,
	`prep_minutes` integer DEFAULT 0,
	`description` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`display_order` integer DEFAULT 0,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`customer_id` integer,
	`terminal` text,
	`guest_count` integer DEFAULT 1,
	`reserved_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`fee` integer DEFAULT 0,
	`status` text DEFAULT 'PENDING',
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_code_unique` ON `reservations` (`code`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`personnel_code` text NOT NULL,
	`full_name` text NOT NULL,
	`mobile` text,
	`role` text NOT NULL,
	`merchant` text,
	`birth_date` text,
	`sms_enabled` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_personnel_code_unique` ON `staff` (`personnel_code`);--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_code_unique` ON `warehouses` (`code`);--> statement-breakpoint
CREATE TABLE `workspace_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
