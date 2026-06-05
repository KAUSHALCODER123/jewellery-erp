# Product Requirements Document (PRD) - Jewelry ERP

## 1. Product Overview
An offline-first, desktop-based ERP software specifically tailored for the Indian retail jewelry market. 
Deployment context: Single PC, fully offline, local SQLite database.

## 2. Core Business Logic (India-Specific)
* **Inventory & Weights:** Every jewelry piece tracks Gross Weight, Stone Weight, Net Weight, and Purity (Karat/Tunch). 
* **HUID Compliance:** Mandatory 6-digit alphanumeric HUID tracking for all hallmarked gold inventory. The system must prevent selling an HUID item twice.
* **Billing & Taxation (GST):** * State-aware GST calculation (CGST/SGST for intra-state, IGST for inter-state).
    * HSN Code enforcement for precious metals and stones.
    * Separate billing lines for Making Charges (often taxed differently or calculated per gram vs. flat rate).
    * Requirement for PAN/Aadhaar capture if cash transaction exceeds â‚¹2,00,000.
* **Girvi (Moneylending/Pawn):** * Calculation of simple and compound interest based on local market rules (e.g., per â‚¹100 per month).
    * Tracking of pledged items (weight, purity, photo).
    * Partial release and interest-only payment tracking.
* **Hardware Integration:** Must seamlessly capture live weights from an RS232 electronic weighing scale and scan barcodes/RFID tags.
