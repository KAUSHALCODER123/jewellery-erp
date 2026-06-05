import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type POSCreditBalance = {
  source: "GSS";
  gss_account_id: number;
  card_number: string;
  customer_id: number;
  customer_name: string;
  principal_paise: number;
  bonus_paise: number;
  total_credit_paise: number;
};

type POSCreditContextValue = {
  posCreditBalance: POSCreditBalance | null;
  setPosCreditBalance: (credit: POSCreditBalance | null) => void;
  clearPosCreditBalance: () => void;
};

const POS_CREDIT_STORAGE_KEY = "pos:gssCredit";
const POSCreditContext = createContext<POSCreditContextValue | undefined>(undefined);

export function POSCreditProvider({ children }: { children: ReactNode }) {
  const [posCreditBalance, setPosCreditBalanceState] = useState<POSCreditBalance | null>(() => readStoredCredit());

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === POS_CREDIT_STORAGE_KEY) {
        setPosCreditBalanceState(readStoredCredit());
      }
    }

    function handleCreditEvent(event: Event) {
      const detail = (event as CustomEvent<POSCreditBalance>).detail;
      if (isPOSCreditBalance(detail)) {
        setPosCreditBalanceState(detail);
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("pos:gss-credit", handleCreditEvent);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pos:gss-credit", handleCreditEvent);
    };
  }, []);

  const value = useMemo<POSCreditContextValue>(
    () => ({
      posCreditBalance,
      setPosCreditBalance: (credit) => {
        setPosCreditBalanceState(credit);

        if (credit) {
          localStorage.setItem(POS_CREDIT_STORAGE_KEY, JSON.stringify(credit));
        } else {
          localStorage.removeItem(POS_CREDIT_STORAGE_KEY);
        }
      },
      clearPosCreditBalance: () => {
        setPosCreditBalanceState(null);
        localStorage.removeItem(POS_CREDIT_STORAGE_KEY);
      }
    }),
    [posCreditBalance]
  );

  return <POSCreditContext.Provider value={value}>{children}</POSCreditContext.Provider>;
}

export function usePOSCredit() {
  const context = useContext(POSCreditContext);

  if (!context) {
    throw new Error("usePOSCredit must be used inside POSCreditProvider.");
  }

  return context;
}

function readStoredCredit() {
  try {
    const rawValue = localStorage.getItem(POS_CREDIT_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : null;

    return isPOSCreditBalance(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPOSCreditBalance(value: unknown): value is POSCreditBalance {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as Partial<POSCreditBalance>).source === "GSS" &&
    Number.isInteger((value as Partial<POSCreditBalance>).gss_account_id) &&
    typeof (value as Partial<POSCreditBalance>).card_number === "string" &&
    Number.isInteger((value as Partial<POSCreditBalance>).customer_id) &&
    typeof (value as Partial<POSCreditBalance>).customer_name === "string" &&
    Number.isInteger((value as Partial<POSCreditBalance>).principal_paise) &&
    Number.isInteger((value as Partial<POSCreditBalance>).bonus_paise) &&
    Number.isInteger((value as Partial<POSCreditBalance>).total_credit_paise)
  );
}
