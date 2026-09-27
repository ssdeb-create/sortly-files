import { useEffect, useRef } from "react";
import { openCookiePreferences, useAdConfig, useConsent } from "@/lib/consent";

type Props = {
  /** Which placement this is; resolves to the configured AdSense slot ID. */
  slotKey?: "sidebar" | "ingrid";
  /** Explicit AdSense slot ID override. */
  slot?: string;
  format?: string;
  label?: string;
  className?: string;
  /** Approximate reserved height so layout doesn't shift. */
  minHeight?: number;
};

let loadedClient = "";

function loadAdSense(client: string) {
  if (loadedClient === client || !client || typeof document === "undefined") return;
  loadedClient = client;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  document.head.appendChild(s);
}

export function AdSlot({
  slotKey,
  slot: slotProp,
  format = "auto",
  label = "Sponsored",
  className = "",
  minHeight = 110,
}: Props) {
  const { consent, ready } = useConsent();
  const adConfig = useAdConfig();
  const pushed = useRef<string>("");

  const client = adConfig.client;
  const slot =
    slotProp ?? (slotKey === "sidebar" ? adConfig.slotSidebar : adConfig.slotIngrid) ?? "";

  const configured = Boolean(client && slot);
  const canServe = ready && !!consent && configured;
  // Re-push when consent, client or slot changes (e.g. saved in Settings).
  const pushKey = canServe ? `${client}:${slot}:${consent?.ads ? "p" : "np"}` : "";

  useEffect(() => {
    if (!pushKey || pushed.current === pushKey) return;
    loadAdSense(client);
    try {
      const w = window as Window & { adsbygoogle?: unknown[] };
      w.adsbygoogle = w.adsbygoogle ?? [];
      // Non-personalised ads when the user declined advertising cookies.
      w.adsbygoogle.push(consent?.ads ? {} : { requestNonPersonalizedAds: 1 });
      pushed.current = pushKey;
    } catch {
      /* ad blocker or duplicate push */
    }
  }, [pushKey, client, consent?.ads]);

  return (
    <aside
      aria-label="Advertisement"
      className={`overflow-hidden rounded-xl border border-dashed border-border bg-muted/30 ${className}`}
      style={{ minHeight }}
    >
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={openCookiePreferences}
          className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
        >
          Ad settings
        </button>
      </div>

      {canServe ? (
        <ins
          key={pushKey}
          className="adsbygoogle block"
          style={{ display: "block", minHeight: minHeight - 24 }}
          data-ad-client={client}
          data-ad-slot={slot}
          data-ad-format={format}
          data-full-width-responsive="true"
        />
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-1 px-3 py-4 text-center"
          style={{ minHeight: minHeight - 24 }}
        >
          <p className="text-xs font-medium text-foreground">Ad placement preview</p>
          <p className="text-[11px] text-muted-foreground">
            {configured
              ? "Waiting for your cookie choice."
              : "Add your AdSense publisher ID and slot IDs in Settings to serve live ads here."}
          </p>
        </div>
      )}
    </aside>
  );
}
