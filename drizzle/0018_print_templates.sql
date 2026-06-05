CREATE TABLE `print_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`document_type` text NOT NULL,
	`page_size` text NOT NULL,
	`content_json` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `print_templates` (`name`, `document_type`, `page_size`, `content_json`, `is_default`, `is_active`) VALUES
('Retail GST A4', 'INVOICE', 'A4', '{"showLogo":true,"showHeader":true,"showFooter":true,"headerLines":["{{shop.name}}","{{shop.address}}","GSTIN: {{shop.gstin}} | Phone: {{shop.phone}}"],"footerText":"Thank you for shopping with us.","fields":["invoice.number","invoice.date","customer.name","customer.phone","invoice.hsn","invoice.gst","invoice.discount","invoice.urd","payment.cash","payment.upi","payment.card","payment.udhari"],"columns":["item","purity","grossWeight","netWeight","rate","making","amount"]}', true, true),
('Counter A5 Receipt', 'RECEIPT', 'A5', '{"showLogo":false,"showHeader":true,"showFooter":true,"headerLines":["{{shop.name}}","{{shop.phone}}"],"footerText":"Exchange within store policy only.","fields":["invoice.number","invoice.date","customer.name","invoice.gst","payment.cash","payment.upi","payment.card"],"columns":["item","netWeight","amount"]}', true, true),
('Thermal 80mm Receipt', 'RECEIPT', 'THERMAL_80', '{"showLogo":false,"showHeader":true,"showFooter":true,"headerLines":["{{shop.name}}","{{shop.phone}}"],"footerText":"Thank you.","fields":["invoice.number","invoice.date","customer.name"],"columns":["item","netWeight","amount"]}', false, true),
('Jewellery Tag 50x25', 'LABEL', 'LABEL_50X25', '{"showLogo":false,"showHeader":false,"showFooter":false,"headerLines":["{{shop.name}}"],"footerText":"","fields":["item.barcode","item.category","item.purity","item.netWeight","item.huid"],"columns":[]}', true, true);
