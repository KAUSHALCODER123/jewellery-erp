# Database Schema

This document mirrors the active Drizzle schema in `src/db/schema.ts`.

## Customers

- `id`: integer primary key
- `name`: text, required
- `phone`: text, required, unique
- `address`: text
- `pan_number`: text
- `aadhaar_number`: text
- `kyc_photo_path`: text
- `area`: text
- `taluka`: text
- `district`: text
- `anniversary_date`: text
- `birthday_date`: text
- `ring_size`: text
- `spouse_name`: text
- `loyalty_points_balance`: integer, default `0`
- `created_at`: text, default `CURRENT_TIMESTAMP`

## Items

- `id`: integer primary key
- `barcode`: text, required, unique
- `huid`: text, unique
- `category`: text, required
- `metal_type`: text, required
- `purity_karat`: integer, required
- `gross_weight_mg`: integer, required
- `stone_weight_mg`: integer, default `0`
- `net_weight_mg`: integer, required
- `wastage_percentage`: real, default `0`
- `making_charge_type`: text, required
- `making_charge_value`: integer, required, stored in paise
- `design_name`: text
- `location`: text, default `VAULT`
- `vendor_id`: integer
- `purchase_rate_paise`: integer
- `purchase_date`: text
- `image_path`: text
- `status`: text, default `IN_STOCK`

## Invoices

- `id`: integer primary key
- `invoice_number`: text, required, unique
- `customer_id`: integer, references `customers.id`
- `total_amount_paise`: integer, required
- `gst_percentage`: real
- `gst_amount_paise`: integer, default `0`
- `hsn_code`: text
- `discount_paise`: integer, default `0`
- `wastage_total_paise`: integer, default `0`
- `urd_deduction_paise`: integer, default `0`
- `gss_credit_paise`: integer, default `0`
- `cheque_amount_paise`: integer, default `0`
- `neft_amount_paise`: integer, default `0`
- `invoice_type`: text, default `SALE`
- `payment_mode`: text, required
- `is_cash_above_limit`: boolean integer, default `false`
- `created_at`: text, default `CURRENT_TIMESTAMP`

## Invoice Lines

- `id`: integer primary key
- `invoice_id`: integer, required, references `invoices.id`
- `item_id`: integer, required, references `items.id`
- `metal_type`: text, required
- `purity_karat`: integer, required
- `gross_weight_mg`: integer, required
- `net_weight_mg`: integer, required
- `stone_weight_mg`: integer, default `0`
- `metal_rate_paise_per_gram`: integer, required
- `making_charge_paise`: integer, required
- `wastage_charge_paise`: integer, default `0`
- `gst_paise`: integer, default `0`
- `line_total_paise`: integer, required

## URD Purchases

- `id`: integer primary key
- `invoice_id`: integer, required, references `invoices.id`
- `description`: text, required
- `metal_type`: text, required
- `purity_tunch`: text, required
- `weight_mg`: integer, required
- `applied_rate_paise_per_gram`: integer, required
- `deduction_amount_paise`: integer, required

## KYC Vault

- `id`: integer primary key
- `customer_id`: integer, required, references `customers.id`
- `document_type`: text enum: `PAN`, `AADHAAR`, `PASSPORT`, `DRIVING_LICENSE`
- `document_number_masked`: text, required
- `document_image_path`: text
- `uploaded_at`: text, default `CURRENT_TIMESTAMP`
- `verified_by`: integer, references `users.id`

## Users

- `id`: integer primary key
- `username`: text, required, unique
- `full_name`: text, required, default empty string
- `password_hash`: text, required
- `role`: text enum: `ADMIN`, `MANAGER`, `ACCOUNTANT`, `COUNTER_STAFF`
- `is_active`: boolean integer, default `true`
- `last_login`: text
- `created_at`: text, default `CURRENT_TIMESTAMP`

## Repair Jobs

- `id`: integer primary key
- `customer_id`: integer, required, references `customers.id`
- `intake_photo_paths`: text/JSON
- `description`: text, required
- `status`: text enum: `RECEIVED`, `WIP`, `READY`, `DELIVERED`; default `RECEIVED`
- `estimated_charge_paise`: integer, default `0`
- `actual_charge_paise`: integer, default `0`
- `karigar_id`: integer, references `karigars.id`
- `intake_date`: text, required
- `delivery_date`: text

## Accounting And Supporting Tables

The schema also includes users, organization settings, audit logs, ledgers, journal entries, girvi loans/collateral/repayments, GSS templates/accounts/receipts, karigars, job orders, material issues, and job receipts as defined in `src/db/schema.ts`.
