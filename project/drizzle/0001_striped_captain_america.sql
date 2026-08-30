CREATE INDEX `idx_expenses_date_category` ON `expenses` (`occurred_at`,`category`);--> statement-breakpoint
CREATE INDEX `idx_products_category_status` ON `products` (`category_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reservations_date_status` ON `reservations` (`reserved_date`,`status`);--> statement-breakpoint
CREATE INDEX `idx_workspace_records_module` ON `workspace_records` (`module`);--> statement-breakpoint
PRAGMA optimize;
