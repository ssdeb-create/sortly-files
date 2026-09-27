import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderTree, Loader2, Mail, MessageSquareText } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Sortly AI file manager" },
      {
        name: "description",
        content:
          "Sign in to Sortly to store, browse and auto-sort your files into folders by their content.",
      },
      { property: "og:title", content: "Sign in — Sortly" },
      {
        property: "og:description",
        content: "Your AI-sorted file vault, in the cloud and on your device.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneStep, setPhoneStep] = useState<"phone" | "code">("phone");
  const [forgot, setForgot] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [loading, user, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (method === "phone") {
        if (phoneStep === "phone") {
          const { error } = await supabase.auth.signInWithOtp({
            phone,
            options: { channel: "sms" },
          });
          if (error) throw error;
          setPhoneStep("code");
          toast.success("Verification code sent by SMS.");
        } else {
          const { error } = await supabase.auth.verifyOtp({ phone, token: otp, type: "sms" });
          if (error) throw error;
        }
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            ...(displayName.trim() ? { data: { full_name: displayName.trim() } } : {}),
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your email to confirm it before signing in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function sendRecovery(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("If that email has an account, a reset link is on its way.");
      setForgot(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the reset email");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) throw result.error;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google sign-in failed. Try email instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="panel w-full max-w-md p-8">
        <Link to="/" className="mb-8 flex items-center gap-2 text-primary">
          <FolderTree className="h-6 w-6" />
          <span className="font-display text-lg font-semibold text-foreground">Sortly</span>
        </Link>
        <h1 className="text-2xl font-semibold">{forgot ? "Reset your password" : mode === "signin" ? "Welcome back" : "Create your vault"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Files get read, understood and filed automatically.
        </p>

        {forgot ? (
          <form onSubmit={sendRecovery} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-email">Account email</Label>
              <Input id="recovery-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Email me a reset link
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setForgot(false)}>Back to sign in</Button>
          </form>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <Button type="button" variant={method === "email" ? "secondary" : "ghost"} onClick={() => { setMethod("email"); setPhoneStep("phone"); }}>
                <Mail className="mr-2 h-4 w-4" /> Email
              </Button>
              <Button type="button" variant={method === "phone" ? "secondary" : "ghost"} onClick={() => { setMethod("phone"); setPhoneStep("phone"); }}>
                <MessageSquareText className="mr-2 h-4 w-4" /> Phone OTP
              </Button>
            </div>
            <form onSubmit={submit} className="mt-4 space-y-4">
              {method === "email" ? (
                <>
                  {mode === "signup" && <div className="space-y-2"><Label htmlFor="display-name">Display name</Label><Input id="display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" /></div>}
                  <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
                  <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></div>
                  {mode === "signin" && <button type="button" className="text-sm text-primary hover:underline" onClick={() => setForgot(true)}>Forgot password?</button>}
                </>
              ) : (
                <>
                  <div className="space-y-2"><Label htmlFor="phone">Mobile number</Label><Input id="phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" disabled={phoneStep === "code"} /></div>
                  {phoneStep === "code" && <div className="space-y-2"><Label htmlFor="otp">SMS verification code</Label><Input id="otp" inputMode="numeric" autoComplete="one-time-code" required value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" /></div>}
                </>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {method === "phone" ? (phoneStep === "phone" ? "Send code" : "Verify and sign in") : mode === "signin" ? "Sign in" : "Sign up"}
              </Button>
              {method === "phone" && phoneStep === "code" && <Button type="button" variant="ghost" className="w-full" onClick={() => setPhoneStep("phone")}>Use a different number</Button>}
            </form>
          </>
        )}

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        {!forgot && <Button variant="secondary" className="w-full" onClick={google} disabled={busy}>
          Continue with Google
        </Button>}

        {!forgot && <button
          type="button"
          className="mt-6 w-full text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin"
            ? "No account yet? Create one"
            : "Already have an account? Sign in"}
        </button>}
      </div>
    </main>
  );
}