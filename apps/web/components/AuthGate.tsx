"use client";
import { useEffect, useState } from "react";
import { supabase, hasSupabaseEnv, appBaseUrl } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseEnv()) { setReady(true); return; }
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseEnv()) {
    return <div className="container"><div className="banner">Supabase env not set. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.</div></div>;
  }
  if (!ready) return <div className="container"><div className="empty">Loading…</div></div>;

  if (!session) {
    async function sendLink() {
      setErr(null);
      try {
        const { error } = await supabase().auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: appBaseUrl() + "/" },
        });
        if (error) throw error;
        setSent(true);
      } catch (e) { setErr((e as Error).message); }
    }
    return (
      <div className="login">
        <div className="login-card card">
          <div className="brand" style={{ fontSize: 22, marginBottom: 6 }}>Drop<span>Watch</span></div>
          <p className="sub" style={{ marginBottom: 18 }}>Sign in to see your price watches.</p>
          {sent ? (
            <div className="banner">Magic link sent to <b>{email}</b>. Open it on this device to sign in.</div>
          ) : (
            <>
              <input
                type="email" placeholder="your email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendLink()}
                style={{ width: "100%", marginBottom: 12 }}
              />
              <button className="btn primary" style={{ width: "100%" }} onClick={sendLink} disabled={!email.trim()}>
                Email me a magic link
              </button>
              {err && <div className="banner" style={{ marginTop: 12 }}>{err}</div>}
            </>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function SignOutButton() {
  return (
    <button
      className="btn ghost"
      style={{ marginLeft: "auto", fontSize: 12, padding: "5px 10px" }}
      onClick={async () => { await supabase().auth.signOut(); location.reload(); }}
    >
      Sign out
    </button>
  );
}
