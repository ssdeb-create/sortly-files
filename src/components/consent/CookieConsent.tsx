import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pushConsentToGoogle, readConsent, useConsent, writeConsent } from "@/lib/consent";

export function CookieConsent() {
  const { consent, ready } = useConsent();
  const [manageOpen, setManageOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [ads, setAds] = useState(false);

  useEffect(() => {
    // Consent Mode default (everything denied) before any Google tag loads.
    pushConsentToGoogle(readConsent());
    const open = () => {
      const current = readConsent();
      setAnalytics(!!current?.analytics);
      setAds(!!current?.ads);
      setManageOpen(true);
    };
    window.addEventListener("sortly:consent-open", open);
    return () => window.removeEventListener("sortly:consent-open", open);
  }, []);

  if (!ready) return null;
  const showBanner = !consent;

  return (
    <>
      {showBanner && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center">
            <Cookie className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
            <p className="flex-1 text-sm text-muted-foreground">
              We use necessary cookies to run the app, and optional cookies for analytics and
              Google-served ads that keep Sortly free. You can change this any time.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAnalytics(false);
                  setAds(false);
                  setManageOpen(true);
                }}
              >
                Manage
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => writeConsent({ analytics: false, ads: false })}
              >
                Reject all
              </Button>
              <Button size="sm" onClick={() => writeConsent({ analytics: true, ads: true })}>
                Accept all
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cookie preferences</DialogTitle>
            <DialogDescription>
              Choose what we may store on this device. Your choice is saved locally and applied to
              Google tags through Consent Mode.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <Row
              title="Strictly necessary"
              desc="Sign-in session and your local preview cache. Always on."
              checked
              disabled
            />
            <Row
              title="Analytics"
              desc="Anonymous usage stats so we can improve sorting quality."
              checked={analytics}
              onChange={setAnalytics}
            />
            <Row
              title="Advertising"
              desc="Google ad serving and personalisation. Off means non-personalised ads only."
              checked={ads}
              onChange={setAds}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                writeConsent({ analytics: false, ads: false });
                setManageOpen(false);
              }}
            >
              Reject all
            </Button>
            <Button
              size="sm"
              onClick={() => {
                writeConsent({ analytics, ads });
                setManageOpen(false);
              }}
            >
              Save preferences
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const id = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm">
          {title}
        </Label>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={!!disabled}
        onCheckedChange={(v) => onChange?.(v)}
      />
    </div>
  );
}
