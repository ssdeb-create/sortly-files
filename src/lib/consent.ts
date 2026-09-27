import { useEffect, useState } from "react";

export type ConsentCategories = {
  necessary: true;
  analytics: boolean;
  ads: boolean;
};

export type ConsentState = ConsentCategories & {
  decidedAt: string;
  version: number;
};

export const CONSENT_VERSION = 1;
const KEY = "sortly.consent.v1";
const EVENT = "sortly:consent";

// ---------- AdSense configuration (env defaults, user-overridable in Settings) ----------

export type AdConfig = {
  client: string;
  slotSidebar: string;
  slotIngrid: string;
};

const AD_KEY = "sortly.adsense.v1";
const AD_EVENT = "sortly:ads-config";

function envDefaults(): AdConfig {
  return {
    client: (import.meta.env["VITE_ADSENSE_CLIENT"] as string | undefined) ?? "",
    slotSidebar: (import.meta.env["VITE_ADSENSE_SLOT_SIDEBAR"] as string | undefined) ?? "",
    slotIngrid: (import.meta.env["VITE_ADSENSE_SLOT_INGRID"] as string | undefined) ?? "",
  };
}

export function getAdConfig(): AdConfig {
  const base = envDefaults();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(AD_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<AdConfig>;
    return {
      client: saved.client?.trim() || base.client,
      slotSidebar: saved.slotSidebar?.trim() || base.slotSidebar,
      slotIngrid: saved.slotIngrid?.trim() || base.slotIngrid,
    };
  } catch {
    return base;
  }
}

export function setAdConfig(next: Partial<AdConfig>) {
  if (typeof window === "undefined") return;
  const clean = {
    client: next.client?.trim() ?? "",
    slotSidebar: next.slotSidebar?.trim() ?? "",
    slotIngrid: next.slotIngrid?.trim() ?? "",
  };
  if (clean.client || clean.slotSidebar || clean.slotIngrid) {
    window.localStorage.setItem(AD_KEY, JSON.stringify(clean));
  } else {
    window.localStorage.removeItem(AD_KEY);
  }
  window.dispatchEvent(new CustomEvent(AD_EVENT));
}

export function useAdConfig(): AdConfig {
  const [config, setConfig] = useState<AdConfig>(envDefaults);
  useEffect(() => {
    setConfig(getAdConfig());
    const onChange = () => setConfig(getAdConfig());
    window.addEventListener(AD_EVENT, onChange);
    return () => window.removeEventListener(AD_EVENT, onChange);
  }, []);
  return config;
}

export function readConsent(): ConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    if (parsed.version !== CONSENT_VERSION) return null;
    return { ...parsed, necessary: true };
  } catch {
    return null;
  }
}

export function writeConsent(next: { analytics: boolean; ads: boolean }): ConsentState {
  const state: ConsentState = {
    necessary: true,
    analytics: next.analytics,
    ads: next.ads,
    decidedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
  };
  window.localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: state }));
  pushConsentToGoogle(state);
  return state;
}

export function clearConsent() {
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: null }));
}

export function openCookiePreferences() {
  window.dispatchEvent(new CustomEvent("sortly:consent-open"));
}

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

/** Google Consent Mode v2 signal — read by AdSense/Ads tags once they load. */
export function pushConsentToGoogle(state: ConsentState | null) {
  if (typeof window === "undefined") return;
  const w = window as GtagWindow;
  w.dataLayer = w.dataLayer ?? [];
  const gtag =
    w.gtag ??
    function (...args: unknown[]) {
      w.dataLayer!.push(args);
    };
  w.gtag = gtag;
  const granted = (on: boolean) => (on ? "granted" : "denied");
  gtag("consent", state ? "update" : "default", {
    ad_storage: granted(!!state?.ads),
    ad_user_data: granted(!!state?.ads),
    ad_personalization: granted(!!state?.ads),
    analytics_storage: granted(!!state?.analytics),
    functionality_storage: "granted",
    security_storage: "granted",
  });
}

export function useConsent() {
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    setReady(true);
    const onChange = (e: Event) => setConsent((e as CustomEvent<ConsentState | null>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  return { consent, ready };
}
