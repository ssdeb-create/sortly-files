import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Sortly" },
      { name: "description", content: "Set a new password for your Sortly account." },
      { property: "og:title", content: "Reset password — Sortly" },
      { property: "og:description", content: "Set a new password for your Sortly account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [valid, setValid] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    setValid(hash.get("type") === "recovery");
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. You can sign in now.");
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update your password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="panel w-full max-w-md p-8">
        <KeyRound className="h-7 w-7 text-primary" />
        <h1 className="mt-5 text-2xl font-semibold">Choose a new password</h1>
        {valid === false ? (
          <p className="mt-3 text-sm text-muted-foreground">This reset link is missing or expired. Request a new one from the sign-in page.</p>
        ) : valid === null ? (
          <div className="mt-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" minLength={6} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
            <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update password</Button>
          </form>
        )}
      </div>
    </main>
  );
}