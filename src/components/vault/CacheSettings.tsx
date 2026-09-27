import { useCallback, useEffect, useState } from "react";
import { BadgeDollarSign, Loader2, Settings2, Trash2 } from "lucide-react";
import { getAdConfig, setAdConfig } from "@/lib/consent";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/extract";
import {
  DEFAULT_MAX_CACHE_BYTES,
  DEFAULT_MAX_SUMMARIES,
  clearPreviewCache,
  getCacheStats,
  setMaxCacheBytes,
  setMaxSummaries,
} from "@/lib/preview-cache";

type Stats = Awaited<ReturnType<typeof getCacheStats>>;

const MB = 1_000_000;

export function CacheSettings() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mb, setMb] = useState(String(DEFAULT_MAX_CACHE_BYTES / MB));
  const [count, setCount] = useState(String(DEFAULT_MAX_SUMMARIES));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pubId, setPubId] = useState("");
  const [slotSidebar, setSlotSidebar] = useState("");
  const [slotIngrid, setSlotIngrid] = useState("");
  const [adsSaved, setAdsSaved] = useState(false);

  const load = useCallback(async () => {
    const next = await getCacheStats();
    setStats(next);
    setMb(String(Math.round(next.maxBytes / MB)));
    setCount(String(next.maxSummaries));
    const ads = getAdConfig();
    setPubId(ads.client);
    setSlotSidebar(ads.slotSidebar);
    setSlotIngrid(ads.slotIngrid);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      const bytes = Math.max(1, Number(mb) || DEFAULT_MAX_CACHE_BYTES / MB) * MB;
      const summaries = Math.max(1, Math.round(Number(count) || DEFAULT_MAX_SUMMARIES));
      await setMaxCacheBytes(bytes);
      await setMaxSummaries(summaries);
      await load();
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  const used = stats ? Math.min(100, (stats.bytes / Math.max(1, stats.maxBytes)) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="Settings">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Previews and AI summaries are kept on this device so files reopen instantly. The
            least-recently-used entries are dropped first when a limit is reached.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">
                {stats ? formatBytes(stats.bytes) : "—"}{" "}
                <span className="text-muted-foreground">used</span>
              </span>
              <span className="text-xs text-muted-foreground">
                of {stats ? formatBytes(stats.maxBytes) : "—"}
              </span>
            </div>
            <Progress value={used} className="mt-2 h-1.5" />
            <p className="mt-2 text-xs text-muted-foreground">
              {stats?.files ?? 0} cached preview{stats?.files === 1 ? "" : "s"} ·{" "}
              {stats?.summaries ?? 0} summar{stats?.summaries === 1 ? "y" : "ies"} of{" "}
              {stats?.maxSummaries ?? DEFAULT_MAX_SUMMARIES}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cache-mb" className="text-xs">
                Max preview cache (MB)
              </Label>
              <Input
                id="cache-mb"
                type="number"
                min={1}
                value={mb}
                onChange={(e) => setMb(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cache-summaries" className="text-xs">
                Max stored summaries
              </Label>
              <Input
                id="cache-summaries"
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await clearPreviewCache();
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Clear cache
            </Button>
            <div className="flex items-center gap-2">
              {saved && !busy && <span className="text-xs text-muted-foreground">Saved</span>}
              <Button size="sm" onClick={save} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save limits
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <BadgeDollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">AdSense (monetization)</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Once Google approves this site, paste your IDs here — the placeholder slots switch to
              live ads immediately. Ads only load after a cookie-consent choice.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="ads-pub" className="text-xs">
                Publisher ID
              </Label>
              <Input
                id="ads-pub"
                placeholder="ca-pub-1234567890123456"
                value={pubId}
                onChange={(e) => setPubId(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ads-slot-sidebar" className="text-xs">
                  Sidebar slot ID
                </Label>
                <Input
                  id="ads-slot-sidebar"
                  placeholder="1234567890"
                  value={slotSidebar}
                  onChange={(e) => setSlotSidebar(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ads-slot-ingrid" className="text-xs">
                  In-grid slot ID
                </Label>
                <Input
                  id="ads-slot-ingrid"
                  placeholder="0987654321"
                  value={slotIngrid}
                  onChange={(e) => setSlotIngrid(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              {adsSaved && <span className="text-xs text-muted-foreground">Saved</span>}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setAdConfig({
                    client: pubId,
                    slotSidebar,
                    slotIngrid,
                  });
                  setAdsSaved(true);
                  window.setTimeout(() => setAdsSaved(false), 2000);
                }}
              >
                Save AdSense
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
