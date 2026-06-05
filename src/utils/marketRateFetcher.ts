const TROY_OUNCE_TO_GRAMS = 31.1034768;
const APISED_GOLD_URL = "https://gold.g.apised.com/v1/latest?metals=XAU,XAG&base_currency=INR&weight_unit=gram";
const DEFAULT_GOLD_API_KEY = "sk_d27C3565d926F708b112501492f3241e4A331C1Cbc9d22c1";
const REQUEST_TIMEOUT_MS = 10000;

export type LiveMetalRates = {
  gold24kRatePaise: number;
  gold22kRatePaise: number;
  gold18kRatePaise: number;
  silverRatePaise: number;
  syncedAt: string;
  source: string;
};

type GoldApiResponse = {
  price?: number;
  price_gram_24k?: number;
  price_gram_22k?: number;
  price_gram_18k?: number;
  price_gram_1g?: number;
  price_24k?: number;
  price_22k?: number;
  price_18k?: number;
};

type ApisedLatestResponse = {
  status?: string;
  data?: {
    base_currency?: string;
    weight_unit?: string;
    metal_prices?: Record<string, GoldApiResponse>;
  };
  error?: string;
  message?: string;
};

export async function fetchLiveMetalRates(): Promise<LiveMetalRates> {
  const apiKey = process.env.GOLD_API_KEY ?? DEFAULT_GOLD_API_KEY;

  if (!apiKey) {
    throw new Error("Live sync failed, please enter rates manually. GOLD_API_KEY is not configured.");
  }

  try {
    const { goldQuote, silverQuote, source } = await fetchApisedQuotes(apiKey);

    const gold24kRupeesPerGram = extractGoldRupeesPerGram(goldQuote);
    const gold22kRupeesPerGram = typeof goldQuote.price_22k === "number"
      ? goldQuote.price_22k
      : typeof goldQuote.price_gram_22k === "number"
      ? goldQuote.price_gram_22k
      : (gold24kRupeesPerGram * 22) / 24;
    const gold18kRupeesPerGram = typeof goldQuote.price_18k === "number"
      ? goldQuote.price_18k
      : typeof goldQuote.price_gram_18k === "number"
      ? goldQuote.price_gram_18k
      : (gold24kRupeesPerGram * 18) / 24;
    const silverRupeesPerGram = extractSilverRupeesPerGram(silverQuote);

    return {
      gold24kRatePaise: rupeesToFlooredPaise(gold24kRupeesPerGram),
      gold22kRatePaise: rupeesToFlooredPaise(gold22kRupeesPerGram),
      gold18kRatePaise: rupeesToFlooredPaise(gold18kRupeesPerGram),
      silverRatePaise: rupeesToFlooredPaise(silverRupeesPerGram),
      syncedAt: new Date().toISOString(),
      source
    };
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : "Unknown provider error.";
    throw new Error(`Live sync failed, please enter rates manually. ${reason}`);
  }
}

async function fetchApisedQuotes(apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = process.env.GOLD_API_URL ?? APISED_GOLD_URL;

  const response = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const result = (await response.json().catch(() => null)) as ApisedLatestResponse | null;
  const metalPrices = result?.data?.metal_prices;
  const goldQuote = metalPrices?.XAU;
  const silverQuote = metalPrices?.XAG;

  if (!response.ok || !result || !goldQuote || !hasAnyRateField(goldQuote)) {
    const message = result?.error || result?.message || "Could not fetch XAU/INR rate.";

    throw new Error(message);
  }

  return {
    goldQuote,
    silverQuote: silverQuote && hasAnyRateField(silverQuote) ? silverQuote : { price: 0 },
    source: `APISED Gold (${result.data?.base_currency ?? "INR"}/${result.data?.weight_unit ?? "gram"})`
  };
}

function extractGoldRupeesPerGram(quote: GoldApiResponse) {
  if (typeof quote.price_24k === "number") {
    return quote.price_24k;
  }

  if (typeof quote.price_gram_24k === "number") {
    return quote.price_gram_24k;
  }

  if (typeof quote.price_gram_1g === "number") {
    return quote.price_gram_1g;
  }

  if (typeof quote.price === "number") {
    return quote.price / TROY_OUNCE_TO_GRAMS;
  }

  throw new Error("Gold provider response did not include a usable INR gram or ounce rate.");
}

function extractSilverRupeesPerGram(quote: GoldApiResponse) {
  if (typeof quote.price_gram_1g === "number") {
    return quote.price_gram_1g;
  }

  if (typeof quote.price === "number") {
    return quote.price / TROY_OUNCE_TO_GRAMS;
  }

  throw new Error("Silver provider response did not include a usable INR gram or ounce rate.");
}

function hasAnyRateField(value: GoldApiResponse | { error?: string }) {
  return (
    typeof (value as GoldApiResponse).price === "number" ||
    typeof (value as GoldApiResponse).price_24k === "number" ||
    typeof (value as GoldApiResponse).price_22k === "number" ||
    typeof (value as GoldApiResponse).price_18k === "number" ||
    typeof (value as GoldApiResponse).price_gram_24k === "number" ||
    typeof (value as GoldApiResponse).price_gram_22k === "number" ||
    typeof (value as GoldApiResponse).price_gram_18k === "number" ||
    typeof (value as GoldApiResponse).price_gram_1g === "number"
  );
}

function rupeesToFlooredPaise(rupees: number) {
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw new Error("Live rate provider returned an invalid metal rate.");
  }

  return Math.floor(rupees * 100);
}
