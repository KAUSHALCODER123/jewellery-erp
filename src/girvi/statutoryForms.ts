// Declarative registry for statutory moneylending forms (e.g. Maharashtra
// Money-Lending (Regulation) Act forms 8/9/10/12).
//
// IMPORTANT: the official legal wording must be supplied by the licensee / their
// CA and entered here (or overridden via a print template). Nothing in this file
// fabricates statutory text — placeholder paragraphs are clearly marked.

export type StatutoryFormSection =
  | { kind: "fields"; rows: Array<{ label: string; binding: StatutoryFieldBinding }> }
  | { kind: "collateral_table" }
  | { kind: "text"; paragraphs: string[] };

export type StatutoryFieldBinding =
  | "loan_number"
  | "issue_date"
  | "customer_name"
  | "customer_address"
  | "customer_phone"
  | "principal_rupees"
  | "interest_rate"
  | "licence_number"
  | "licence_authority"
  | "licence_expiry"
  | "shop_name"
  | "shop_address"
  | "statement_date";

export type StatutoryForm = {
  code: string;
  title: string;
  description: string;
  sections: StatutoryFormSection[];
};

export const STATUTORY_FORMS: StatutoryForm[] = [
  {
    // Placeholder demonstrating the end-to-end plumbing. Replace `title` and the
    // text section with the official form wording before statutory use.
    code: "LOAN_DECLARATION",
    title: "Moneylending Loan Declaration (Draft)",
    description: "Draft declaration of a pledge loan issued under the shop's moneylending licence.",
    sections: [
      {
        kind: "fields",
        rows: [
          { label: "Licensee", binding: "shop_name" },
          { label: "Licence No.", binding: "licence_number" },
          { label: "Licensing Authority", binding: "licence_authority" },
          { label: "Licence Valid Till", binding: "licence_expiry" },
          { label: "Loan No.", binding: "loan_number" },
          { label: "Date of Loan", binding: "issue_date" },
          { label: "Borrower", binding: "customer_name" },
          { label: "Borrower Address", binding: "customer_address" },
          { label: "Principal Amount", binding: "principal_rupees" },
          { label: "Rate of Interest", binding: "interest_rate" },
          { label: "Date of Statement", binding: "statement_date" }
        ]
      },
      { kind: "collateral_table" },
      {
        kind: "text",
        paragraphs: [
          "[DRAFT — NOT FOR STATUTORY FILING] The official wording of this form under the applicable Money-Lending (Regulation) Act must be provided by the licensee or their chartered accountant and configured in the form registry before use.",
          "Declared that the above particulars are true to the best of my knowledge and belief."
        ]
      }
    ]
  }
];

export function findStatutoryForm(code: string) {
  const normalized = code.trim().toUpperCase();
  return STATUTORY_FORMS.find((form) => form.code === normalized) ?? null;
}
