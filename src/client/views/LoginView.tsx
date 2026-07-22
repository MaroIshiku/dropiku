import { useState } from "react";
import { postJson, setCsrfToken } from "../lib/api";
import { Icon } from "../components/Icon";

export function LoginView({ onAuthenticated, digits }: { onAuthenticated: (resetRequired: boolean) => void; digits: 6 | 10 }) {
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (recovery) {
        const result = await postJson<{ resetRequired: boolean }>("/api/auth/recovery/login", { recoveryCode: value });
        onAuthenticated(result.resetRequired);
      } else {
        const result = await postJson<{ csrfToken: string }>("/api/auth/totp/login", { code: value });
        setCsrfToken(result.csrfToken); onAuthenticated(false);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); }
    finally { setBusy(false); }
  };
  return <main className="auth-page"><section className="auth-window psu-card">
    <div className="auth-brand"><div className="psu-logo-frame"><img src="/assets/logos/dropiku.png" alt="Dropiku" /></div><div><h1>Welcome back</h1><p>Private File Exchange</p></div></div>
    <form className="stack" onSubmit={(event) => void submit(event)}><div><h2>{recovery ? "Use a recovery code" : "Enter your TOTP code"}</h2><p className="muted">{recovery ? "This signs out other sessions and requires a new authenticator setup." : `Use the current ${digits}-digit code from your authenticator.`}</p></div><label className="psu-field"><span className="psu-label">{recovery ? "Recovery code" : `${digits}-digit code`}</span><input className={`psu-input ${recovery ? "" : "code-input"}`} inputMode={recovery ? "text" : "numeric"} autoComplete="one-time-code" value={value} onChange={(event) => setValue(recovery ? event.target.value.trim() : event.target.value.replace(/\D/gu, "").slice(0, digits))} maxLength={recovery ? 128 : digits} autoFocus required /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="psu-button psu-button--filled psu-button--full" disabled={busy || (!recovery && value.length !== digits)}><Icon name="lock" />Sign in</button><button className="psu-button psu-button--text" type="button" onClick={() => { setRecovery(!recovery); setValue(""); setError(""); }}>{recovery ? "Use an authenticator code" : "Use a recovery code"}</button></form>
  </section></main>;
}
