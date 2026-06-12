import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState, useRef } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";
import { DateInput } from "./ui.js";

type GirviMoneylendingModuleProps = {
  apiBaseUrl?: string;
};

type ActiveTab = "issue" | "active" | "closed" | "auction";

type AuctionDueLoan = {
  loan_id: number;
  loan_number: string;
  customer_name: string;
  issue_date: string;
  redemption_deadline: string;
  days_overdue: number;
  total_due_rupees: string;
};

type CustomerOption = {
  id: number;
  name: string;
  phone?: string | null;
  pan_number?: string | null;
  aadhaar_number?: string | null;
};

type IssueForm = {
  customerId: string;
  principalRupees: string;
  disbursementLedgerId: string;
  loanNumber: string;
  issueDate: string;
  nextDueDate: string;
  panNumber: string;
  aadhaarNumber: string;
  interestRatePercentage: string;
  interestType: "SIMPLE" | "COMPOUND";
  ratePeriod: "MONTHLY" | "ANNUALLY";
  interestPeriodType: string;
  loanLetterFeeRupees: string;
  noticeFeeRupees: string;
  customerPhotoPath: string;
  thumbprintPath: string;
};

// One pledged collateral item. The loan accepts many of these (the grid below).
type CollateralRow = {
  key: string;
  itemDescription: string;
  metalType: "GOLD" | "SILVER";
  purityKarat: string;
  grossWeightGrams: string;
  stoneWeightGrams: string;
  rateOverrideRupees: string;
  imagePath: string;
};

// Where a captured/uploaded image should be stored: a loan-level field or a specific collateral row.
type CaptureTarget =
  | { kind: "loanField"; field: "customerPhotoPath" | "thumbprintPath" }
  | { kind: "collateral"; key: string };

type GirviPrintLanguage = "en" | "mr" | "hi" | "gu";

type ActiveLoan = {
  id: number;
  loan_number: string;
  customer_name?: string | null;
  principal_amount_paise: number;
  issue_date: string;
  collateral_summary?: string | null;
};

type RepaymentBreakdown = {
  loan_id: number;
  outstanding_principal_paise: number;
  accrued_interest_paise: number;
  outstanding_fees_paise: number;
  loan_letter_fee_due_paise: number;
  notice_fee_due_paise: number;
  total_due_paise: number;
};

const HIGH_VALUE_CASH_KYC_LIMIT_PAISE = 20000000;
const LTV_PERCENTAGE = 75;

const initialIssueForm: IssueForm = {
  customerId: "",
  principalRupees: "",
  disbursementLedgerId: "",
  loanNumber: "",
  issueDate: getToday(),
  nextDueDate: "",
  panNumber: "",
  aadhaarNumber: "",
  interestRatePercentage: "",
  interestType: "SIMPLE",
  ratePeriod: "MONTHLY",
  interestPeriodType: "MONTHLY",
  loanLetterFeeRupees: "0.00",
  noticeFeeRupees: "0.00",
  customerPhotoPath: "",
  thumbprintPath: ""
};

function emptyCollateralRow(key: string): CollateralRow {
  return {
    key,
    itemDescription: "",
    metalType: "GOLD",
    purityKarat: "22",
    grossWeightGrams: "",
    stoneWeightGrams: "0",
    rateOverrideRupees: "",
    imagePath: ""
  };
}

export default function GirviMoneylendingModule({ apiBaseUrl = "" }: GirviMoneylendingModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("issue");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [issueForm, setIssueForm] = useState<IssueForm>(initialIssueForm);
  const collateralKeyRef = useRef(1);
  const [collateralRows, setCollateralRows] = useState<CollateralRow[]>(() => [emptyCollateralRow("c0")]);
  const [liveGoldRateRupees, setLiveGoldRateRupees] = useState("0.00");
  const [activeLoans, setActiveLoans] = useState<ActiveLoan[]>([]);
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [loanSearch, setLoanSearch] = useState("");
  const [auctionDue, setAuctionDue] = useState<AuctionDueLoan[]>([]);
  const [auctionLoading, setAuctionLoading] = useState(false);

  // Repayment form states
  const [repaymentRupees, setRepaymentRupees] = useState("");
  const [discountRupees, setDiscountRupees] = useState("0.00");
  const [noticeFeePaidRupees, setNoticeFeePaidRupees] = useState("0.00");
  const [loanLetterFeePaidRupees, setLoanLetterFeePaidRupees] = useState("0.00");
  const [receiptLedgerId, setReceiptLedgerId] = useState("1");
  const [lastRepaymentId, setLastRepaymentId] = useState<number | null>(null);

  const [repaymentBreakdown, setRepaymentBreakdown] = useState<RepaymentBreakdown | null>(null);
  const [pavatiLoan, setPavatiLoan] = useState<{ id: number; loanNumber: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Webcam states & refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isWebcamOpen, setIsWebcamOpen] = useState(false);
  const [activeCaptureField, setActiveCaptureField] = useState<CaptureTarget | null>(null);

  // Localization for print documents
  const [pavatiLanguage, setPavatiLanguage] = useState<GirviPrintLanguage>("en");
  const [noticeLanguage, setNoticeLanguage] = useState<GirviPrintLanguage>("en");

  // Moneylending licence details printed on statements and statutory forms.
  const [licenceForm, setLicenceForm] = useState({ number: "", authority: "", expiry: "" });

  // Closed (Settled) & Defaulted loan registries (Tab 3)
  const [settledLoans, setSettledLoans] = useState<ActiveLoan[]>([]);
  const [defaultedLoans, setDefaultedLoans] = useState<ActiveLoan[]>([]);
  const [selectedClosedLoanId, setSelectedClosedLoanId] = useState("");
  const [closedSearch, setClosedSearch] = useState("");
  const [closedSubTab, setClosedSubTab] = useState<"settled" | "defaulted">("settled");

  // Administration & Biometric states
  const [defaultNoticeFeeRupees, setDefaultNoticeFeeRupees] = useState("100.00");
  const [isBiometricModalOpen, setIsBiometricModalOpen] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState("");

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  async function loadSettledLoans() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/loans?status=SETTLED`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { loans?: ActiveLoan[] } | null;
      setSettledLoans(response.ok && result?.loans ? result.loans : []);
    } catch {
      setSettledLoans([]);
    }
  }

  async function loadDefaultedLoans() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/loans?status=DEFAULTED`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { loans?: ActiveLoan[] } | null;
      setDefaultedLoans(response.ok && result?.loans ? result.loans : []);
    } catch {
      setDefaultedLoans([]);
    }
  }

  function reloadAllLoans() {
    void loadActiveLoans();
    void loadSettledLoans();
    void loadDefaultedLoans();
  }

  useEffect(() => {
    void loadCustomers();
    void loadRates();
    void loadNextLoanNumber();
    void loadLicence();
    reloadAllLoans();
  }, []);

  useEffect(() => {
    if (activeTab === "auction") void loadAuctionDue();
  }, [activeTab]);

  async function loadNextLoanNumber() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/next-loan-number`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { loan_number?: string } | null;
      if (response.ok && result?.loan_number) {
        setIssueForm((current) => (current.loanNumber.trim() ? current : { ...current, loanNumber: result.loan_number as string }));
      }
    } catch { /* leave blank; server auto-generates on issue */ }
  }

  useEffect(() => {
    if (selectedLoanId) {
      void loadRepaymentBreakdown(selectedLoanId);
    } else {
      setRepaymentBreakdown(null);
      setLastRepaymentId(null);
    }
  }, [selectedLoanId]);

  // Net metal weight (gross - stone) per row; the rate is an authorized override or the live/stored rate.
  function rowNetWeightMg(row: CollateralRow) {
    return Math.max(0, gramsToMg(row.grossWeightGrams) - gramsToMg(row.stoneWeightGrams));
  }
  function rowRatePaisePerGram(row: CollateralRow) {
    return row.rateOverrideRupees.trim() ? rupeesToPaise(row.rateOverrideRupees) : rupeesToPaise(liveGoldRateRupees);
  }
  function rowValuePaise(row: CollateralRow) {
    return Math.floor((rowNetWeightMg(row) * rowRatePaisePerGram(row)) / 1000);
  }

  // Aggregate collateral valuation drives the 75% LTV ceiling for the whole loan.
  const collateralValuationPaise = useMemo(
    () => collateralRows.reduce((total, row) => total + rowValuePaise(row), 0),
    [collateralRows, liveGoldRateRupees]
  );
  const maxPermissibleLoanPaise = Math.floor((collateralValuationPaise * LTV_PERCENTAGE) / 100);
  const principalPaise = rupeesToPaise(issueForm.principalRupees);
  const principalExceedsLtv = principalPaise > maxPermissibleLoanPaise && principalPaise > 0;
  const kycRequired = principalPaise >= HIGH_VALUE_CASH_KYC_LIMIT_PAISE;
  const kycMissing = kycRequired && (!issueForm.panNumber.trim() || !issueForm.aadhaarNumber.trim());
  // A row counts only once it has a description and a positive net weight.
  const validCollateralRows = collateralRows.filter((row) => row.itemDescription.trim() && rowNetWeightMg(row) > 0);
  const issueSubmitDisabled =
    !issueForm.customerId ||
    !issueForm.disbursementLedgerId ||
    validCollateralRows.length === 0 ||
    principalPaise <= 0 ||
    principalExceedsLtv ||
    kycMissing;

  function updateCollateralRow(key: string, patch: Partial<CollateralRow>) {
    setCollateralRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function addCollateralRow() {
    setCollateralRows((rows) => [...rows, emptyCollateralRow(`c${collateralKeyRef.current++}`)]);
  }
  function removeCollateralRow(key: string) {
    setCollateralRows((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== key) : rows));
  }

  const selectedLoan = activeLoans.find((loan) => String(loan.id) === selectedLoanId) ?? null;
  const repaymentPaise = rupeesToPaise(repaymentRupees);

  // Split calculation with discounts and fee allocations included
  const repaymentSplit = useMemo(() => {
    const outstandingPrincipal = repaymentBreakdown?.outstanding_principal_paise ?? 0;
    const accruedInterest = repaymentBreakdown?.accrued_interest_paise ?? 0;
    const outstandingNotice = repaymentBreakdown?.notice_fee_due_paise ?? 0;
    const outstandingLetter = repaymentBreakdown?.loan_letter_fee_due_paise ?? 0;

    const noticePaid = Math.min(rupeesToPaise(noticeFeePaidRupees), outstandingNotice);
    const letterPaid = Math.min(rupeesToPaise(loanLetterFeePaidRupees), outstandingLetter);
    const discount = rupeesToPaise(discountRupees);

    const maxInterestToPay = Math.max(0, accruedInterest - discount);
    const interestAllocated = Math.min(Math.max(0, repaymentPaise - noticePaid - letterPaid), maxInterestToPay);
    const principalAllocated = Math.min(
      Math.max(0, repaymentPaise - noticePaid - letterPaid - interestAllocated),
      outstandingPrincipal
    );

    return {
      noticePaid,
      letterPaid,
      interestAllocated,
      principalAllocated
    };
  }, [repaymentRupees, noticeFeePaidRupees, loanLetterFeePaidRupees, discountRupees, repaymentBreakdown]);

  const filteredLoans = activeLoans.filter((loan) => {
    const needle = loanSearch.trim().toLowerCase();
    if (!needle) return true;
    return `${loan.loan_number} ${loan.customer_name ?? ""}`.toLowerCase().includes(needle);
  });

  async function loadCustomers() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/crm/customers?limit=100`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { customers?: CustomerOption[] } | null;
      setCustomers(response.ok && result?.customers ? result.customers : []);
    } catch {
      setCustomers([]);
    }
  }

  async function loadRates() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/rates`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { rates?: Record<string, string> } | null;

      if (response.ok && result?.rates) {
        setLiveGoldRateRupees(result.rates.gold_22k_rate_per_gram_rupees ?? result.rates.gold_24k_rate_per_gram_rupees ?? "0.00");
      }
    } catch {
      setLiveGoldRateRupees("0.00");
    }
  }

  async function loadLicence() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/moneylending-licence`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as {
        moneylending_licence_number?: string;
        moneylending_licence_authority?: string;
        moneylending_licence_expiry?: string;
      } | null;

      if (response.ok && result) {
        setLicenceForm({
          number: result.moneylending_licence_number ?? "",
          authority: result.moneylending_licence_authority ?? "",
          expiry: result.moneylending_licence_expiry ?? ""
        });
      }
    } catch {
      // Licence stays editable with blank defaults.
    }
  }

  async function saveLicence() {
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/moneylending-licence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          moneylending_licence_number: licenceForm.number,
          moneylending_licence_authority: licenceForm.authority,
          moneylending_licence_expiry: licenceForm.expiry
        })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;
      if (!response.ok) {
        setError(result?.errors?.join(" ") || "Failed to save licence details.");
        return;
      }
      setMessage("Moneylending licence details saved.");
    } catch {
      setError("Failed to save licence details.");
    }
  }

  async function loadAuctionDue() {
    setAuctionLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/auction-due`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { loans?: AuctionDueLoan[] } | null;
      setAuctionDue(response.ok && result?.loans ? result.loans : []);
    } catch {
      setAuctionDue([]);
    } finally {
      setAuctionLoading(false);
    }
  }

  async function loadActiveLoans() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/loans?status=ACTIVE`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { loans?: ActiveLoan[] } | null;
      setActiveLoans(response.ok && result?.loans ? result.loans : []);
    } catch {
      setActiveLoans([]);
    }
  }

  async function loadRepaymentBreakdown(loanId: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/repay/calculate`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          loan_id: Number(loanId),
          intended_repayment_date: getToday()
        })
      });
      const result = (await response.json().catch(() => null)) as RepaymentBreakdown | { errors?: string[] } | null;

      if (!response.ok || !isRepaymentBreakdown(result)) {
        throw new Error(getErrorMessage(result, "Could not calculate repayment."));
      }

      setRepaymentBreakdown(result);
      setRepaymentRupees(paiseToRupees(result.total_due_paise));
      setDiscountRupees("0.00");
      setNoticeFeePaidRupees(paiseToRupees(result.notice_fee_due_paise));
      setLoanLetterFeePaidRupees(paiseToRupees(result.loan_letter_fee_due_paise));
    } catch (caught) {
      setRepaymentBreakdown(null);
      setError(caught instanceof Error ? caught.message : "Could not calculate repayment.");
    }
  }

  async function uploadImage(fileOrBlob: File | Blob, target: CaptureTarget) {
    const upload = new FormData();
    const file = fileOrBlob instanceof File ? fileOrBlob : new File([fileOrBlob], "capture.png", { type: "image/png" });
    upload.append("image", file);

    try {
      setError("");
      setMessage("");
      const response = await fetch(`${apiBaseUrl}/api/upload/image`, {
        method: "POST",
        headers: authHeaders,
        body: upload
      });
      const result = (await response.json().catch(() => null)) as { image_path?: string; url?: string; errors?: string[] } | null;

      if (!response.ok || !result) {
        throw new Error(result?.errors?.join(" ") || "Upload failed.");
      }

      const path = result.image_path ?? result.url ?? "";
      if (target.kind === "loanField") {
        setIssueForm((current) => ({ ...current, [target.field]: path }));
        setMessage(`${target.field === "customerPhotoPath" ? "Customer photo" : "Thumbprint"} uploaded successfully.`);
      } else {
        updateCollateralRow(target.key, { imagePath: path });
        setMessage("Collateral photo uploaded successfully.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    }
  }

  // Webcam actions
  async function startWebcam(field: CaptureTarget) {
    try {
      setError("");
      setActiveCaptureField(field);
      setIsWebcamOpen(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 480 }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(err => console.error("Error playing video:", err));
      }
    } catch (caught) {
      setIsWebcamOpen(false);
      setError("Webcam hardware not accessible. Please upload file instead.");
    }
  }

  function stopWebcam() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsWebcamOpen(false);
    setActiveCaptureField(null);
  }

  function capturePhoto() {
    if (videoRef.current && activeCaptureField) {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            void uploadImage(blob, activeCaptureField);
          }
        }, "image/png");
      }
      stopWebcam();
    }
  }

  async function issueLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (principalPaise > maxPermissibleLoanPaise) {
      setError("Principal amount exceeds the 75% LTV limit.");
      return;
    }

    if (issueSubmitDisabled) {
      setError("Complete required fields before issuing the loan.");
      return;
    }

    const payload = {
      customer_id: Number(issueForm.customerId),
      principal_amount_paise: principalPaise,
      disbursement_ledger_id: Number(issueForm.disbursementLedgerId),
      loan_number: issueForm.loanNumber.trim(),
      interest_rate_percentage: Number(issueForm.interestRatePercentage),
      interest_type: issueForm.interestType,
      rate_period: issueForm.ratePeriod,
      interest_period_type: issueForm.interestPeriodType,
      loan_letter_fee_paise: rupeesToPaise(issueForm.loanLetterFeeRupees),
      notice_fee_paise: rupeesToPaise(issueForm.noticeFeeRupees),
      customer_photo_path: issueForm.customerPhotoPath || null,
      thumbprint_path: issueForm.thumbprintPath || null,
      issue_date: issueForm.issueDate,
      next_due_date: issueForm.nextDueDate || null,
      collateral: validCollateralRows.map((row) => ({
        item_description: row.itemDescription.trim(),
        metal_type: row.metalType,
        purity_karat: Number(row.purityKarat),
        gross_weight_mg: gramsToMg(row.grossWeightGrams),
        stone_deduction_mg: gramsToMg(row.stoneWeightGrams),
        rate_override_paise_per_gram: row.rateOverrideRupees.trim()
          ? rupeesToPaise(row.rateOverrideRupees)
          : null,
        image_path: row.imagePath || null
      })),
      kyc_override: kycRequired
        ? {
            pan_number: issueForm.panNumber.trim(),
            aadhaar_number: issueForm.aadhaarNumber.trim()
          }
        : null
    };

    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/issue`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as { loan?: { id?: number; loan_number?: string }; errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not issue Girvi loan.");
      }

      const id = result?.loan?.id ?? 0;
      setPavatiLoan({ id, loanNumber: result?.loan?.loan_number ?? issueForm.loanNumber });
      setIssueForm(initialIssueForm);
      setCollateralRows([emptyCollateralRow(`c${collateralKeyRef.current++}`)]);
      void loadNextLoanNumber();
      reloadAllLoans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not issue Girvi loan.");
    }
  }

  async function saveRepayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!selectedLoanId || repaymentPaise <= 0) {
      setError("Select a loan and enter a repayment amount.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/repay`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          loan_id: Number(selectedLoanId),
          receipt_ledger_id: Number(receiptLedgerId),
          amount_paise: repaymentPaise,
          payment_date: getToday(),
          discount_paise: rupeesToPaise(discountRupees),
          notice_fee_paid_paise: rupeesToPaise(noticeFeePaidRupees),
          loan_letter_fee_paid_paise: rupeesToPaise(loanLetterFeePaidRupees)
        })
      });
      const result = (await response.json().catch(() => null)) as { repayment?: { id: number }; errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not save repayment.");
      }

      setMessage("Repayment saved successfully.");
      if (result?.repayment?.id) {
        setLastRepaymentId(result.repayment.id);
      }
      setRepaymentRupees("");
      void loadRepaymentBreakdown(selectedLoanId);
      reloadAllLoans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save repayment.");
    }
  }

  async function markLoanDefaulted() {
    if (!selectedLoanId) return;
    setError("");
    setMessage("");
    try {
      const feePaise = rupeesToPaise(defaultNoticeFeeRupees);
      const response = await fetch(`${apiBaseUrl}/api/girvi/loans/${selectedLoanId}/default`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notice_fee_paise: feePaise
        })
      });
      const result = (await response.json().catch(() => null)) as { loan?: any; errors?: string[] } | null;
      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Failed to mark loan as defaulted.");
      }
      setMessage(`Loan ${result?.loan?.loan_number ?? ""} has been marked defaulted.`);
      setSelectedLoanId("");
      reloadAllLoans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to mark loan as defaulted.");
    }
  }

  async function forfeitCollateral(loanId: number) {
    if (!confirm("Are you sure you want to forfeit this loan's collateral and transfer items to inventory? This action is irreversible.")) {
      return;
    }
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/girvi/loans/${loanId}/forfeit-transfer`, {
        method: "POST",
        headers: authHeaders
      });
      const result = (await response.json().catch(() => null)) as { message?: string; errors?: string[] } | null;
      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Failed to forfeit collateral.");
      }
      setMessage(result?.message || "Collateral forfeited and transferred successfully.");
      setSelectedClosedLoanId("");
      reloadAllLoans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to forfeit collateral.");
    }
  }

  async function scanBiometricFingerprint() {
    setError("");
    setMessage("");
    setIsBiometricModalOpen(true);
    setBiometricStatus("Initializing biometric scanner on local port 11100...");

    const pidOptions = `
      <PidOptions ver="1.0">
        <Opts fCount="1" fType="0" iCount="0" iType="0" pCount="0" pType="0" format="0" pidVer="2.0" timeout="10000" posh="UNKNOWN" env="P" />
      </PidOptions>
    `.trim();

    try {
      const response = await fetch("http://localhost:11100/rd/capture", {
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "Accept": "text/xml"
        },
        body: pidOptions
      });
      
      const xmlText = await response.text();
      if (xmlText.includes('errCode="0"') || xmlText.includes('errCode=\'0\'')) {
        setBiometricStatus("Fingerprint captured successfully! Processing template...");
        
        const canvas = document.createElement("canvas");
        canvas.width = 300;
        canvas.height = 300;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#020617";
          ctx.fillRect(0, 0, 300, 300);
          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = 3;
          for (let r = 20; r < 140; r += 12) {
            ctx.beginPath();
            ctx.arc(150, 160, r, Math.PI, 0, false);
            ctx.stroke();
          }
          for (let r = 25; r < 145; r += 12) {
            ctx.beginPath();
            ctx.arc(150, 140, r, 0, Math.PI, false);
            ctx.stroke();
          }
          ctx.fillStyle = "#10b981";
          ctx.font = "bold 12px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("BIOMETRIC SCAN VERIFIED", 150, 260);
          ctx.font = "10px sans-serif";
          ctx.fillStyle = "#94a3b8";
          ctx.fillText("Mantra/Morpho RD Service", 150, 280);
        }
        
        canvas.toBlob((blob) => {
          if (blob) {
            void uploadImage(blob, { kind: "loanField", field: "thumbprintPath" });
          }
          setIsBiometricModalOpen(false);
        }, "image/png");
      } else {
        const match = xmlText.match(/errString="([^"]+)"/) || xmlText.match(/errString='([^']+)'/);
        const errStr = match ? match[1] : "Scanner timeout or fingerprint mismatch.";
        throw new Error(`RD Service: ${errStr}`);
      }
    } catch (caught) {
      console.warn("RD Service fetch failed:", caught);
      setBiometricStatus("Local RD Service not detected or timed out. Place your thumb on mock scanner to simulate device capture.");
    }
  }

  function simulateBiometricScan() {
    setBiometricStatus("Simulating biometric verification... Reading fingerprint template...");
    setTimeout(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, 300, 300);
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 3.5;
        for (let r = 20; r < 140; r += 12) {
          ctx.beginPath();
          ctx.arc(150, 160, r, Math.PI, 0, false);
          ctx.stroke();
        }
        for (let r = 25; r < 145; r += 12) {
          ctx.beginPath();
          ctx.arc(150, 140, r, 0, Math.PI, false);
          ctx.stroke();
        }
        ctx.fillStyle = "#10b981";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("MOCK BIOMETRIC SCAN OK", 150, 260);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("Simulated Fingerprint ID: 77a0b-11c", 150, 280);
      }
      
      canvas.toBlob((blob) => {
        if (blob) {
          void uploadImage(blob, { kind: "loanField", field: "thumbprintPath" });
        }
        setIsBiometricModalOpen(false);
      }, "image/png");
    }, 1000);
  }

  return (
    <section className="grid h-screen grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-slate-50">Girvi Moneylending</h1>
          <p className="text-xs text-slate-400">LTV, KYC, collateral, repayments</p>
        </div>
        <nav className="flex border border-slate-700 text-xs text-slate-50">
          <TabButton active={activeTab === "issue"} onClick={() => setActiveTab("issue")}>Issue New Loan</TabButton>
          <TabButton active={activeTab === "active"} onClick={() => setActiveTab("active")}>Active Loans & Repayments</TabButton>
          <TabButton active={activeTab === "auction"} onClick={() => setActiveTab("auction")}>Auction Due</TabButton>
          <TabButton active={activeTab === "closed"} onClick={() => setActiveTab("closed")}>Defaulted/Settled</TabButton>
        </nav>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1 text-xs ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="min-h-0 overflow-hidden">
        {activeTab === "issue" && (
          <form onSubmit={issueLoan} className="grid h-full grid-cols-[300px_1fr_300px] overflow-hidden">
            <aside className="grid content-start gap-2 border-r border-slate-800 bg-slate-900 p-3 overflow-y-auto">
              <PanelTitle title="Borrower" />
              <Field label="Customer">
                <select value={issueForm.customerId} onChange={(event) => setIssueForm({ ...issueForm, customerId: event.target.value })} className={controlClassName}>
                  <option value="">Select borrower</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name} {customer.phone ? `- ${customer.phone}` : ""}</option>
                  ))}
                </select>
              </Field>
              <Field label="Loan Number">
                <input value={issueForm.loanNumber} onChange={(event) => setIssueForm({ ...issueForm, loanNumber: event.target.value.toUpperCase() })} placeholder="Auto (GRV-0001)" className={controlClassName} />
              </Field>
              <Field label="Principal Amount (Rs)">
                <input
                  value={issueForm.principalRupees}
                  onChange={(event) => setIssueForm({ ...issueForm, principalRupees: event.target.value })}
                  className={principalExceedsLtv ? dangerControlClassName : controlClassName}
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </Field>
              {kycRequired && (
                <div className="grid gap-2 border border-red-500 bg-red-950/30 p-2">
                  <p className="text-xs font-semibold uppercase text-red-200">Cash loan above Rs 2,00,000</p>
                  <Field label="PAN Number">
                    <input value={issueForm.panNumber} onChange={(event) => setIssueForm({ ...issueForm, panNumber: event.target.value.toUpperCase() })} className={dangerControlClassName} />
                  </Field>
                  <Field label="Aadhaar Number">
                    <input value={issueForm.aadhaarNumber} onChange={(event) => setIssueForm({ ...issueForm, aadhaarNumber: event.target.value })} className={dangerControlClassName} inputMode="numeric" />
                  </Field>
                </div>
              )}
              <Field label="Cash / Bank Ledger ID">
                <input value={issueForm.disbursementLedgerId} onChange={(event) => setIssueForm({ ...issueForm, disbursementLedgerId: event.target.value })} className={controlClassName} inputMode="numeric" />
              </Field>

              {/* Customer Photo Upload & Webcam */}
              <div className="grid gap-1 mt-2 border-t border-slate-800 pt-2">
                <label className="text-[10px] uppercase font-semibold text-slate-400">Customer Photo</label>
                <div className="flex gap-2 items-center">
                  {issueForm.customerPhotoPath ? (
                    <img src={`${apiBaseUrl}${issueForm.customerPhotoPath}`} className="w-10 h-10 object-cover border border-slate-700 bg-slate-950" />
                  ) : (
                    <div className="w-10 h-10 border border-slate-700 bg-slate-950 flex items-center justify-center text-[8px] text-slate-500">No Photo</div>
                  )}
                  <button type="button" onClick={() => startWebcam({ kind: "loanField", field: "customerPhotoPath" })} className="px-2 py-1 bg-slate-800 text-[10px] uppercase font-bold hover:bg-slate-700 rounded text-slate-50">
                    📷 Webcam
                  </button>
                  <label className="px-2 py-1 bg-slate-800 text-[10px] uppercase font-bold hover:bg-slate-700 rounded text-slate-50 cursor-pointer text-center">
                    Upload
                    <input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0] ?? new Blob(), { kind: "loanField", field: "customerPhotoPath" })} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Thumbprint Upload, Webcam, and Biometrics */}
              <div className="grid gap-1 mt-2 border-t border-slate-800 pt-2">
                <label className="text-[10px] uppercase font-semibold text-slate-400">Thumbprint / Biometric scan</label>
                <div className="flex gap-2 items-center flex-wrap">
                  {issueForm.thumbprintPath ? (
                    <img src={`${apiBaseUrl}${issueForm.thumbprintPath}`} className="w-10 h-10 object-cover border border-slate-700 bg-slate-950" />
                  ) : (
                    <div className="w-10 h-10 border border-slate-700 bg-slate-950 flex items-center justify-center text-[8px] text-slate-500">No Thumb</div>
                  )}
                  <button type="button" onClick={() => startWebcam({ kind: "loanField", field: "thumbprintPath" })} className="px-2 py-1 bg-slate-800 text-[10px] uppercase font-bold hover:bg-slate-700 rounded text-slate-50">
                    📷 Webcam
                  </button>
                  <button
                    type="button"
                    onClick={scanBiometricFingerprint}
                    className="px-2 py-1 bg-emerald-600 text-[10px] uppercase font-bold hover:bg-emerald-700 rounded text-slate-50"
                  >
                    ☝️ Biometric
                  </button>
                  <label className="px-2 py-1 bg-slate-800 text-[10px] uppercase font-bold hover:bg-slate-700 rounded text-slate-50 cursor-pointer text-center">
                    Upload
                    <input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0] ?? new Blob(), { kind: "loanField", field: "thumbprintPath" })} className="hidden" />
                  </label>
                </div>
              </div>
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_1fr]">
              <PanelHeader title="Collateral & Interest" note="Weights convert to mg at submit" />
              <div className="grid content-start gap-3 overflow-auto p-3">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase font-semibold text-slate-400">Pledged Collateral Items</label>
                    <button type="button" onClick={addCollateralRow} className="rounded bg-slate-800 px-3 py-1 text-[10px] font-bold uppercase text-emerald-300 hover:bg-slate-700">
                      + Add Item
                    </button>
                  </div>

                  {collateralRows.map((row, index) => {
                    const overridden = row.rateOverrideRupees.trim().length > 0;
                    return (
                      <div key={row.key} className="grid gap-2 border border-slate-800 bg-slate-950 p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase text-slate-500">Item {index + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeCollateralRow(row.key)}
                            disabled={collateralRows.length <= 1}
                            className="text-[10px] font-bold uppercase text-red-300 hover:text-red-200 disabled:text-slate-700"
                          >
                            ✕ Remove
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                          <Field label="Item Description">
                            <input value={row.itemDescription} onChange={(event) => updateCollateralRow(row.key, { itemDescription: event.target.value })} className={controlClassName} />
                          </Field>
                          <Field label="Metal Type">
                            <select value={row.metalType} onChange={(event) => updateCollateralRow(row.key, { metalType: event.target.value as CollateralRow["metalType"] })} className={controlClassName}>
                              <option value="GOLD">Gold</option>
                              <option value="SILVER">Silver</option>
                            </select>
                          </Field>
                          <Field label="Purity">
                            <input value={row.purityKarat} onChange={(event) => updateCollateralRow(row.key, { purityKarat: event.target.value })} className={controlClassName} inputMode="decimal" />
                          </Field>
                          <Field label="Gross Wt (g)">
                            <input value={row.grossWeightGrams} onChange={(event) => updateCollateralRow(row.key, { grossWeightGrams: event.target.value })} className={controlClassName} inputMode="decimal" />
                          </Field>
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                          <Field label="Stone / Less Wt (g)">
                            <input value={row.stoneWeightGrams} onChange={(event) => updateCollateralRow(row.key, { stoneWeightGrams: event.target.value })} className={controlClassName} inputMode="decimal" />
                          </Field>
                          <Field label="Net Wt (g)">
                            <input value={(rowNetWeightMg(row) / 1000).toFixed(3)} readOnly tabIndex={-1} className={`${controlClassName} bg-slate-900 text-slate-300`} />
                          </Field>
                          <Field label="Rate Override (₹/g)">
                            <input
                              value={row.rateOverrideRupees}
                              onChange={(event) => updateCollateralRow(row.key, { rateOverrideRupees: event.target.value })}
                              className={controlClassName}
                              inputMode="decimal"
                              placeholder={`Stored ₹${liveGoldRateRupees}`}
                            />
                          </Field>
                          <MetricBox label={overridden ? "Item Value (override)" : "Item Value"} value={formatIndianCurrency(rowValuePaise(row))} />
                        </div>

                        <div className="flex items-center gap-2">
                          {row.imagePath ? (
                            <img src={`${apiBaseUrl}${row.imagePath}`} className="h-12 w-12 border border-slate-700 bg-slate-950 object-cover" />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center border border-slate-700 bg-slate-950 text-[10px] text-slate-500">No Photo</div>
                          )}
                          <button type="button" onClick={() => startWebcam({ kind: "collateral", key: row.key })} className="rounded bg-slate-800 px-3 py-1.5 text-xs font-bold uppercase text-slate-50 hover:bg-slate-700">
                            📷 Capture Photo
                          </button>
                          <label className="cursor-pointer rounded bg-slate-800 px-3 py-1.5 text-center text-xs font-bold uppercase text-slate-50 hover:bg-slate-700">
                            Upload File
                            <input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0] ?? new Blob(), { kind: "collateral", key: row.key })} className="hidden" />
                          </label>
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
                    <span className="uppercase text-slate-400">Total Collateral Value (net basis)</span>
                    <span className="font-mono font-semibold text-slate-100">{formatIndianCurrency(collateralValuationPaise)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <Field label="Interest Rate (%)">
                    <input value={issueForm.interestRatePercentage} onChange={(event) => setIssueForm({ ...issueForm, interestRatePercentage: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <Field label="Type">
                    <select value={issueForm.interestType} onChange={(event) => setIssueForm({ ...issueForm, interestType: event.target.value as IssueForm["interestType"] })} className={controlClassName}>
                      <option value="SIMPLE">Simple</option>
                      <option value="COMPOUND">Compound</option>
                    </select>
                  </Field>
                  <Field label="Rate Period Basis">
                    <select value={issueForm.ratePeriod} onChange={(event) => setIssueForm({ ...issueForm, ratePeriod: event.target.value as IssueForm["ratePeriod"] })} className={controlClassName}>
                      <option value="MONTHLY">Monthly</option>
                      <option value="ANNUALLY">Annually</option>
                    </select>
                  </Field>
                  <Field label="Interest Accrual Period">
                    <select value={issueForm.interestPeriodType} onChange={(event) => setIssueForm({ ...issueForm, interestPeriodType: event.target.value })} className={controlClassName}>
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                      <option value="ANNUALLY">Annually</option>
                    </select>
                  </Field>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Field label="Loan Letter Fee (Rs)">
                    <input value={issueForm.loanLetterFeeRupees} onChange={(event) => setIssueForm({ ...issueForm, loanLetterFeeRupees: event.target.value })} className={controlClassName} inputMode="decimal" type="number" step="0.01" />
                  </Field>
                  <Field label="Notice Fee (Rs)">
                    <input value={issueForm.noticeFeeRupees} onChange={(event) => setIssueForm({ ...issueForm, noticeFeeRupees: event.target.value })} className={controlClassName} inputMode="decimal" type="number" step="0.01" />
                  </Field>
                  <Field label="Next Due Date">
                    <DateInput value={issueForm.nextDueDate} onChange={(v) => setIssueForm({ ...issueForm, nextDueDate: v })} className={controlClassName} />
                  </Field>
                </div>
              </div>
            </section>

            <aside className="grid content-start gap-3 border-l border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="LTV Lock" />
              <MetricBox label="Live Gold Rate" value={formatIndianCurrency(rupeesToPaise(liveGoldRateRupees))} />
              <MetricBox label="Max Permissible Loan" value={formatIndianCurrency(maxPermissibleLoanPaise)} tone={principalExceedsLtv ? "danger" : "ok"} />
              <MetricBox label="Principal Payload" value={`${principalPaise} paise`} />
              {principalExceedsLtv && <p className="border border-red-500 bg-red-950/40 p-2 text-xs text-red-200">Principal exceeds the 75% LTV limit and cannot be submitted.</p>}
              <button type="submit" disabled={issueSubmitDisabled} className="h-10 bg-emerald-500 text-xs font-semibold uppercase text-slate-50 disabled:bg-slate-700 disabled:text-slate-500">
                Issue Loan
              </button>
            </aside>
          </form>
        )}

        {activeTab === "active" && (
          <form onSubmit={saveRepayment} className="grid h-full grid-cols-[360px_1fr] overflow-hidden">
            <aside className="grid min-h-0 grid-rows-[auto_1fr] border-r border-slate-800 bg-slate-900 p-3">
              <div className="grid gap-2 border-b border-slate-800 pb-2">
                <PanelTitle title="Active Loans" />
                <input placeholder="Search loan or customer" value={loanSearch} onChange={(event) => setLoanSearch(event.target.value)} className={controlClassName} />
              </div>
              <div className="min-h-0 overflow-auto py-2">
                {filteredLoans.map((loan) => (
                  <button
                    key={loan.id}
                    type="button"
                    onClick={() => setSelectedLoanId(String(loan.id))}
                    className={`mb-2 grid w-full gap-1 border p-2 text-left text-xs ${selectedLoanId === String(loan.id) ? "border-emerald-400 bg-emerald-950/30" : "border-slate-800 bg-slate-950"}`}
                  >
                    <span className="font-mono font-semibold text-slate-50">{loan.loan_number}</span>
                    <span className="text-slate-400">{loan.customer_name ?? "Masked Borrower"}</span>
                    <span className="font-mono text-slate-200">{formatIndianCurrency(loan.principal_amount_paise)}</span>
                  </button>
                ))}
              </div>
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_auto_1fr] overflow-y-auto">
              <PanelHeader title="Repayment" note="Interest is allocated before principal" />
              <div className="grid grid-cols-5 border-b border-slate-800">
                <MetricBox label="Principal" value={selectedLoan ? formatIndianCurrency(selectedLoan.principal_amount_paise) : "-"} />
                <MetricBox label="Issue Date" value={selectedLoan?.issue_date ?? "-"} />
                <MetricBox label="Accrued Interest" value={formatIndianCurrency(repaymentBreakdown?.accrued_interest_paise ?? 0)} tone="warn" />
                <MetricBox label="Outstanding Fees" value={formatIndianCurrency(repaymentBreakdown?.outstanding_fees_paise ?? 0)} tone="warn" />
                <MetricBox label="Outstanding Principal" value={formatIndianCurrency(repaymentBreakdown?.outstanding_principal_paise ?? 0)} />
              </div>
              <div className="grid content-start gap-3 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Field label="Repayment Amount (Rs)">
                      <input value={repaymentRupees} onChange={(event) => setRepaymentRupees(event.target.value)} className={controlClassName} inputMode="decimal" type="number" step="0.01" />
                    </Field>
                    <Field label="Discount Allowed (Rs)">
                      <input value={discountRupees} onChange={(event) => setDiscountRupees(event.target.value)} className={controlClassName} inputMode="decimal" type="number" step="0.01" />
                    </Field>
                    <Field label="Notice Fee Paid (Rs)">
                      <input value={noticeFeePaidRupees} onChange={(event) => setNoticeFeePaidRupees(event.target.value)} className={controlClassName} inputMode="decimal" type="number" step="0.01" />
                    </Field>
                    <Field label="Letter Fee Paid (Rs)">
                      <input value={loanLetterFeePaidRupees} onChange={(event) => setLoanLetterFeePaidRupees(event.target.value)} className={controlClassName} inputMode="decimal" type="number" step="0.01" />
                    </Field>
                    <Field label="Receipt Ledger ID">
                      <input value={receiptLedgerId} onChange={(event) => setReceiptLedgerId(event.target.value)} className={controlClassName} inputMode="numeric" />
                    </Field>
                  </div>
                  <div className="grid grid-rows-4 gap-2">
                    <MetricBox label="Allocated to Notice Fee" value={formatIndianCurrency(repaymentSplit.noticePaid)} tone="warn" />
                    <MetricBox label="Allocated to Letter Fee" value={formatIndianCurrency(repaymentSplit.letterPaid)} tone="warn" />
                    <MetricBox label="Allocated to Interest" value={formatIndianCurrency(repaymentSplit.interestAllocated)} tone="warn" />
                    <MetricBox label="Allocated to Principal" value={formatIndianCurrency(repaymentSplit.principalAllocated)} tone="ok" />
                  </div>
                </div>
                <div className="border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
                  Allocation Summary: Notice Fee: {formatIndianCurrency(repaymentSplit.noticePaid)} | Letter Fee: {formatIndianCurrency(repaymentSplit.letterPaid)} | Interest: {formatIndianCurrency(repaymentSplit.interestAllocated)} | Principal: {formatIndianCurrency(repaymentSplit.principalAllocated)}
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                  <button type="submit" disabled={!selectedLoanId || repaymentPaise <= 0} className="h-10 px-6 bg-emerald-500 text-xs font-semibold uppercase text-slate-50 disabled:bg-slate-700 disabled:text-slate-500 rounded">
                    Save Repayment
                  </button>
                  {selectedLoanId && (
                    <div className="flex items-center gap-2">
                      <select
                        value={pavatiLanguage}
                        onChange={(e) => setPavatiLanguage(e.target.value as GirviPrintLanguage)}
                        className="h-10 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none rounded"
                      >
                        <option value="en">English Pavati</option>
                        <option value="mr">मराठी (Marathi)</option>
                        <option value="hi">हिन्दी (Hindi)</option>
                        <option value="gu">Gujarati Pavati</option>
                      </select>
                      <a
                        href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/${selectedLoanId}/pavati?lang=${pavatiLanguage}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center px-4 h-10 bg-blue-600 hover:bg-blue-700 text-xs font-semibold uppercase text-slate-50 rounded"
                      >
                        🖨️ Print Pawn Ticket (A4)
                      </a>
                      <a
                        href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/${selectedLoanId}/statement`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center px-4 h-10 bg-slate-700 hover:bg-slate-600 text-xs font-semibold uppercase text-slate-50 rounded"
                      >
                        Account Statement
                      </a>
                      <a
                        href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/${selectedLoanId}/statutory/LOAN_DECLARATION`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center px-4 h-10 bg-slate-700 hover:bg-slate-600 text-xs font-semibold uppercase text-slate-50 rounded"
                      >
                        Statutory Form
                      </a>
                    </div>
                  )}
                </div>

                {selectedLoan && (
                  <div className="mt-4 border-t border-slate-800 pt-4">
                    <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2">Loan Default Administration</h3>
                    <div className="flex items-end gap-3 bg-slate-900/60 p-3 border border-slate-800 rounded">
                      <div className="w-1/3">
                        <Field label="Notice Fee to Apply (Rs)">
                          <input
                            type="number"
                            step="0.01"
                            value={defaultNoticeFeeRupees}
                            onChange={(e) => setDefaultNoticeFeeRupees(e.target.value)}
                            className={controlClassName}
                          />
                        </Field>
                      </div>
                      <button
                        type="button"
                        onClick={markLoanDefaulted}
                        className="h-8 px-4 bg-red-600 hover:bg-red-700 text-xs font-semibold uppercase text-slate-50 rounded"
                      >
                        ⚠️ Mark As Defaulted
                      </button>
                    </div>
                    <h3 className="mt-4 text-xs font-semibold uppercase text-slate-400 mb-2">Moneylending Licence (printed on statements &amp; forms)</h3>
                    <div className="flex items-end gap-3 bg-slate-900/60 p-3 border border-slate-800 rounded">
                      <div className="flex-1">
                        <Field label="Licence No.">
                          <input value={licenceForm.number} onChange={(e) => setLicenceForm({ ...licenceForm, number: e.target.value })} className={controlClassName} />
                        </Field>
                      </div>
                      <div className="flex-1">
                        <Field label="Issuing Authority">
                          <input value={licenceForm.authority} onChange={(e) => setLicenceForm({ ...licenceForm, authority: e.target.value })} className={controlClassName} />
                        </Field>
                      </div>
                      <div className="w-44">
                        <Field label="Valid Till">
                          <DateInput value={licenceForm.expiry} onChange={(v) => setLicenceForm({ ...licenceForm, expiry: v })} className={controlClassName} />
                        </Field>
                      </div>
                      <button
                        type="button"
                        onClick={saveLicence}
                        className="h-8 px-4 bg-slate-700 hover:bg-slate-600 text-xs font-semibold uppercase text-slate-50 rounded"
                      >
                        Save Licence
                      </button>
                    </div>
                  </div>
                )}
                {lastRepaymentId && (
                  <div className="mt-3 flex items-center gap-2 border border-emerald-500 bg-emerald-950/20 p-2 rounded">
                    <span className="text-xs text-emerald-200">Repayment saved successfully!</span>
                    <a
                      href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/repayment/${lastRepaymentId}/receipt`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center px-3 h-8 bg-emerald-500 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-600 rounded"
                    >
                      Print Receipt (A5)
                    </a>
                  </div>
                )}
              </div>
            </section>
          </form>
        )}

        {activeTab === "auction" && (
          <div className="grid h-full grid-rows-[auto_1fr] gap-3 overflow-hidden p-3">
            <div className="flex items-center justify-between gap-3 rounded border border-amber-700 bg-amber-950/20 p-3">
              <div>
                <h2 className="text-xs font-bold uppercase text-amber-200">Pledges Past Redemption — Auction Worklist</h2>
                <p className="text-[11px] text-slate-400">Loans whose statutory redemption period has lapsed. Issue an Item / Auction Notice before liquidating unredeemed collateral.</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={noticeLanguage}
                  onChange={(e) => setNoticeLanguage(e.target.value as "en" | "mr" | "hi" | "gu")}
                  className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none rounded"
                >
                  <option value="en">English</option>
                  <option value="mr">मराठी</option>
                  <option value="hi">हिन्दी</option>
                  <option value="gu">ગુજરાતી</option>
                </select>
                <button type="button" onClick={loadAuctionDue} className="h-8 px-3 rounded border border-slate-600 bg-slate-800 text-[11px] font-semibold uppercase text-slate-200 hover:bg-slate-700">
                  Refresh
                </button>
                {auctionDue.length > 0 && (
                  <a
                    href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/auction-notices?ids=${auctionDue.map((l) => l.loan_id).join(",")}&lang=${noticeLanguage}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center justify-center rounded bg-amber-600 px-3 text-[11px] font-bold uppercase text-slate-50 hover:bg-amber-700"
                  >
                    Print All Notices ({auctionDue.length})
                  </a>
                )}
              </div>
            </div>
            <div className="min-h-0 overflow-auto rounded border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400">
                  <tr>
                    {["Loan No.", "Customer", "Issued", "Redemption Deadline", "Days Overdue", "Total Due", "Notice"].map((heading) => (
                      <th key={heading} className="border-b border-slate-800 px-2 py-2 uppercase">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auctionLoading ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">Scanning overdue pledges…</td></tr>
                  ) : auctionDue.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No pledges are past their redemption period.</td></tr>
                  ) : auctionDue.map((loan) => (
                    <tr key={loan.loan_id} className="border-b border-slate-900">
                      <td className="px-2 py-2 font-mono text-emerald-300">{loan.loan_number}</td>
                      <td className="px-2 py-2">{loan.customer_name}</td>
                      <td className="px-2 py-2 font-mono">{loan.issue_date}</td>
                      <td className="px-2 py-2 font-mono text-amber-300">{loan.redemption_deadline}</td>
                      <td className="px-2 py-2 font-mono text-red-300">{loan.days_overdue}</td>
                      <td className="px-2 py-2 font-mono">₹{loan.total_due_rupees}</td>
                      <td className="px-2 py-2">
                        <a
                          href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/${loan.loan_id}/auction-notice?lang=${noticeLanguage}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-300 hover:text-amber-200"
                        >
                          Print Notice
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "closed" && (
          <div className="grid h-full grid-cols-[360px_1fr] overflow-hidden">
            {/* Left sidebar: list of settled/defaulted loans */}
            <aside className="grid min-h-0 grid-rows-[auto_auto_1fr] border-r border-slate-800 bg-slate-900 p-3">
              <div className="grid gap-2 border-b border-slate-800 pb-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setClosedSubTab("settled");
                      setSelectedClosedLoanId("");
                    }}
                    className={`flex-1 py-1.5 text-xs font-semibold uppercase rounded text-center border ${closedSubTab === "settled" ? "bg-emerald-950/40 border-emerald-500 text-emerald-300" : "bg-slate-950 border-slate-800 text-slate-400"}`}
                  >
                    Settled ({settledLoans.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClosedSubTab("defaulted");
                      setSelectedClosedLoanId("");
                    }}
                    className={`flex-1 py-1.5 text-xs font-semibold uppercase rounded text-center border ${closedSubTab === "defaulted" ? "bg-red-950/40 border-red-500 text-red-300" : "bg-slate-950 border-slate-800 text-slate-400"}`}
                  >
                    Defaulted ({defaultedLoans.length})
                  </button>
                </div>
                <input
                  placeholder={`Search ${closedSubTab} loans`}
                  value={closedSearch}
                  onChange={(event) => setClosedSearch(event.target.value)}
                  className={controlClassName}
                />
              </div>
              <div className="min-h-0 overflow-auto py-2">
                {(closedSubTab === "settled" ? settledLoans : defaultedLoans)
                  .filter((loan) => {
                    const needle = closedSearch.trim().toLowerCase();
                    if (!needle) return true;
                    return `${loan.loan_number} ${loan.customer_name ?? ""}`.toLowerCase().includes(needle);
                  })
                  .map((loan) => (
                    <button
                      key={loan.id}
                      type="button"
                      onClick={() => setSelectedClosedLoanId(String(loan.id))}
                      className={`mb-2 grid w-full gap-1 border p-2 text-left text-xs ${selectedClosedLoanId === String(loan.id) ? (closedSubTab === "settled" ? "border-emerald-400 bg-emerald-950/30" : "border-red-400 bg-red-950/30") : "border-slate-800 bg-slate-950"}`}
                    >
                      <span className="font-mono font-semibold text-slate-50">{loan.loan_number}</span>
                      <span className="text-slate-400">{loan.customer_name ?? "Masked Borrower"}</span>
                      <span className="font-mono text-slate-200">{formatIndianCurrency(loan.principal_amount_paise)}</span>
                    </button>
                  ))}
              </div>
            </aside>

            {/* Right details / actions panel */}
            <section className="grid min-h-0 grid-rows-[auto_1fr] overflow-y-auto bg-slate-950">
              <PanelHeader
                title={closedSubTab === "settled" ? "Settled Loan Detail" : "Defaulted Loan Detail"}
                note={selectedClosedLoanId ? "Administration Actions" : "Select a loan from list to view"}
              />
              {(() => {
                const loan = (closedSubTab === "settled" ? settledLoans : defaultedLoans).find(
                  (l) => String(l.id) === selectedClosedLoanId
                );
                if (!loan) {
                  return (
                    <div className="grid h-full place-items-center text-sm text-slate-500 p-8">
                      Select a loan from the left panel to review settlement receipts, warnings, and collateral actions.
                    </div>
                  );
                }

                return (
                  <div className="grid content-start gap-4 p-4">
                    <div className="grid grid-cols-3 bg-slate-900 border border-slate-800 rounded p-3 text-xs gap-y-2 gap-x-4">
                      <div>
                        <span className="text-slate-500 uppercase block font-semibold text-[10px]">Loan Number</span>
                        <span className="font-mono text-slate-50 text-sm font-semibold">{loan.loan_number}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase block font-semibold text-[10px]">Borrower</span>
                        <span className="text-slate-50 text-sm font-semibold">{loan.customer_name ?? "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase block font-semibold text-[10px]">Principal Amount</span>
                        <span className="font-mono text-slate-50 text-sm font-semibold">{formatIndianCurrency(loan.principal_amount_paise)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase block font-semibold text-[10px]">Issue Date</span>
                        <span className="text-slate-200">{loan.issue_date}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 uppercase block font-semibold text-[10px]">Collateral Description</span>
                        <span className="text-slate-200 text-xs italic">{loan.collateral_summary || "No collateral description"}</span>
                      </div>
                    </div>

                    {closedSubTab === "settled" && (
                      <div className="grid gap-3 bg-slate-900/40 border border-slate-800 rounded p-4">
                        <h4 className="text-xs font-bold uppercase text-emerald-400 border-b border-slate-800 pb-2">Loan Settled & Released</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          This loan has been fully paid. Under moneylending legal requirements, a release receipt confirms the settlement of dues and collateral hand-back.
                        </p>
                        <div className="flex pt-2">
                          <a
                            href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/${loan.id}/release-receipt`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center px-4 h-10 bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold uppercase text-slate-50 rounded"
                          >
                            🖨️ Print Settlement & Release Receipt (A4)
                          </a>
                        </div>
                      </div>
                    )}

                    {closedSubTab === "defaulted" && (
                      <div className="grid gap-4">
                        {/* Legal Notice Warning Generation */}
                        <div className="grid gap-3 bg-slate-900/40 border border-slate-800 rounded p-4">
                          <h4 className="text-xs font-bold uppercase text-amber-400 border-b border-slate-800 pb-2">Generate Legal Warning Notice</h4>
                          <p className="text-xs text-slate-400 leading-relaxed">
                            Generate and print a physical legal warning notice to send to the customer detailing interest dues and warning of collateral seizure.
                          </p>
                          <div className="flex items-center gap-3 pt-2">
                            <select
                              value={noticeLanguage}
                              onChange={(e) => setNoticeLanguage(e.target.value as GirviPrintLanguage)}
                              className="h-10 border border-slate-700 bg-slate-900 px-2 text-xs text-slate-50 outline-none rounded"
                            >
                              <option value="en">English Notice</option>
                              <option value="mr">मराठी (Marathi)</option>
                              <option value="hi">हिन्दी (Hindi)</option>
                              <option value="gu">Gujarati Notice</option>
                            </select>
                            <a
                              href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/${loan.id}/legal-notice?lang=${noticeLanguage}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center px-4 h-10 bg-amber-600 hover:bg-amber-700 text-xs font-semibold uppercase text-slate-50 rounded"
                            >
                              🖨️ Print Legal Notice
                            </a>
                          </div>
                        </div>

                        {/* Collateral Forfeiture / Auction stock transfer */}
                        <div className="grid gap-3 bg-slate-900/40 border border-slate-800 rounded p-4">
                          <h4 className="text-xs font-bold uppercase text-red-500 border-b border-slate-800 pb-2">Forfeit Collateral & Transfer to Inventory</h4>
                          <p className="text-xs text-slate-400 leading-relaxed">
                            Seize the collateral gold/silver. This will close the loan balance, add the items to the shop's active inventory under <code className="bg-slate-950 text-red-300 px-1.5 py-0.5 rounded">Girvi Forfeited / Auction Stock</code>, and post corresponding double-entry accounting adjustments.
                          </p>
                          <div className="flex pt-2">
                            <button
                              type="button"
                              onClick={() => forfeitCollateral(loan.id)}
                              className="h-10 px-5 bg-red-600 hover:bg-red-700 text-xs font-semibold uppercase text-slate-50 rounded shadow-md"
                            >
                              ⚖️ Forfeit Collateral & Create Stock
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </section>
          </div>
        )}
      </main>

      {/* Pawn Ticket Confirmation Modal */}
      {pavatiLoan && (
        <div className="fixed inset-0 grid place-items-center bg-slate-950/80 p-6 z-50">
          <div className="w-full max-w-5xl border border-slate-700 bg-white p-4 text-slate-50 rounded shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-300 pb-2">
              <h2 className="text-sm font-bold uppercase text-slate-50">Pavati / Pawn Receipt - {pavatiLoan.loanNumber}</h2>
              <div className="flex items-center gap-2">
                <select
                  value={pavatiLanguage}
                  onChange={(e) => setPavatiLanguage(e.target.value as GirviPrintLanguage)}
                  className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-50 outline-none rounded"
                >
                  <option value="en">English Pavati</option>
                  <option value="mr">मराठी (Marathi)</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="gu">Gujarati Pavati</option>
                </select>
                <a
                  href={withDocumentToken(`${apiBaseUrl}/api/documents/girvi/${pavatiLoan.id}/pavati?lang=${pavatiLanguage}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 bg-blue-600 text-xs text-slate-50 uppercase font-bold hover:bg-blue-700 rounded"
                >
                  Print Official PDF Pavati (A4)
                </a>
                <button type="button" onClick={() => setPavatiLoan(null)} className="border border-slate-400 px-2 py-1 text-xs uppercase rounded">Close</button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 text-xs text-slate-900">
              <ReceiptColumn title="English" loan={pavatiLoan.loanNumber} />
              <ReceiptColumn title="Marathi" loan={pavatiLoan.loanNumber} />
              <ReceiptColumn title="Hindi" loan={pavatiLoan.loanNumber} />
              <ReceiptColumn title="Gujarati" loan={pavatiLoan.loanNumber} />
            </div>
          </div>
        </div>
      )}

      {/* Webcam Modal Dialog */}
      {isWebcamOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 bg-slate-950">
              <h3 className="text-xs font-bold uppercase text-slate-50">
                Capture {activeCaptureField?.kind === "loanField" && activeCaptureField.field === "customerPhotoPath" ? "Customer Photo" : activeCaptureField?.kind === "loanField" && activeCaptureField.field === "thumbprintPath" ? "Thumbprint" : "Collateral"}
              </h3>
              <button type="button" onClick={stopWebcam} className="text-slate-400 hover:text-slate-50">&times;</button>
            </div>
            <div className="relative aspect-video bg-black flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
            <div className="flex justify-between gap-2 p-4 bg-slate-950">
              <button type="button" onClick={stopWebcam} className="px-4 py-2 border border-slate-700 text-xs uppercase font-semibold text-slate-300 hover:bg-slate-800">
                Cancel
              </button>
              <button type="button" onClick={capturePhoto} className="px-4 py-2 bg-emerald-500 text-xs uppercase font-semibold text-slate-50 hover:bg-emerald-600">
                Capture & Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Biometric Scan Modal Dialog */}
      {isBiometricModalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-xl p-6 text-center">
            <h3 className="text-sm font-bold uppercase text-slate-50 mb-4">Biometric Fingerprint Scanner</h3>
            
            {/* Holographic scanner visual */}
            <div className="relative mx-auto my-6 w-36 h-48 border border-slate-700 bg-slate-950 rounded-2xl flex flex-col items-center justify-center overflow-hidden">
              {/* Scanline animation */}
              <div className="absolute inset-x-0 top-0 h-1 bg-emerald-500 shadow-[0_0_8px_#10b981] animate-bounce" style={{ animationDuration: "2s" }} />
              
              <svg className="w-20 h-20 text-emerald-500/40 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11a13.916 13.916 0 00-1.5-6.624l-.053-.088m11.39 2.207A11.95 11.95 0 0115 10c0 6-2 11.54-5.25 15.5M15 10c0-2.29-.623-4.435-1.713-6.284M9 11a13.916 13.916 0 00-1.5-6.624M9 11c0-2.29.623-4.435 1.713-6.284M9 11h.008M12 11h.008M15 10h.008" />
              </svg>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest mt-3">Place Thumb</span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-6 px-2 min-h-[48px]">
              {biometricStatus}
            </p>

            <div className="flex justify-between gap-3 bg-slate-950 p-3 rounded border border-slate-800">
              <button
                type="button"
                onClick={() => setIsBiometricModalOpen(false)}
                className="px-4 py-2 border border-slate-700 text-xs uppercase font-semibold text-slate-400 hover:bg-slate-800 hover:text-slate-50 rounded"
              >
                Cancel
              </button>
              
              <button
                type="button"
                onClick={simulateBiometricScan}
                className="px-4 py-2 bg-emerald-500 text-slate-50 text-xs uppercase font-bold hover:bg-emerald-400 rounded"
              >
                Simulate Scan (Mock)
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function isRepaymentBreakdown(value: RepaymentBreakdown | { errors?: string[] } | null): value is RepaymentBreakdown {
  return Boolean(value && "loan_id" in value && "outstanding_principal_paise" in value && "accrued_interest_paise" in value);
}

function getErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "errors" in value && Array.isArray(value.errors)) {
    return value.errors.join(" ") || fallback;
  }

  return fallback;
}

function rupeesToPaise(value: string) {
  return decimalToScaledInteger(value, 100, 2);
}

function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

function gramsToMg(value: string) {
  return decimalToScaledInteger(value, 1000, 3);
}

function decimalToScaledInteger(value: string, scale: 100 | 1000, maxDecimalPlaces: 2 | 3) {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return 0;

  const fractional = (match[2] ?? "").slice(0, maxDecimalPlaces).padEnd(maxDecimalPlaces, "0");
  return Number(match[1]) * scale + Number(fractional || "0");
}

function formatIndianCurrency(paise: number) {
  const sign = paise < 0 ? "-" : "";
  const absolute = Math.abs(paise);
  const rupees = Math.trunc(absolute / 100);
  const coins = String(absolute % 100).padStart(2, "0");

  return `${sign}Rs ${rupees.toLocaleString("en-IN")}.${coins}`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
      {label}
      {children}
    </label>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 border-r border-slate-700 px-3 font-semibold uppercase last:border-r-0 ${active ? "bg-emerald-500 text-slate-50" : "bg-slate-950 text-slate-300"}`}
    >
      {children}
    </button>
  );
}

function PanelHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
      <h2 className="text-xs font-semibold uppercase text-slate-50">{title}</h2>
      <span className="text-[11px] text-slate-500">{note}</span>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return <h2 className="text-xs font-semibold uppercase text-slate-50">{title}</h2>;
}

function MetricBox({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const toneClassName =
    tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "danger" ? "text-red-300" : "text-slate-50";

  return (
    <div className="border-r border-slate-800 bg-slate-950 px-3 py-2 last:border-r-0">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className={`font-mono text-sm font-semibold ${toneClassName}`}>{value}</div>
    </div>
  );
}

function ReceiptColumn({ title, loan }: { title: string; loan: string }) {
  return (
    <div className="min-h-48 border border-slate-300 p-3">
      <h3 className="mb-2 text-center text-sm font-bold uppercase">{title}</h3>
      <p>Loan: {loan}</p>
      <p>Collateral weight, purity, principal, interest, due date, and borrower consent are recorded in the local Girvi register.</p>
      <p className="mt-6 border-t border-slate-300 pt-2">Borrower Sign / Shop Sign</p>
    </div>
  );
}

const controlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400";
const dangerControlClassName =
  "h-8 w-full border border-red-500 bg-red-950/40 px-2 text-xs text-slate-50 outline-none focus:border-red-300";
const fileControlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50 file:mr-2 file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-slate-50";
