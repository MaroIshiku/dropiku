import { useEffect, useRef, useState } from "react";
import { postJson, setCsrfToken } from "../lib/api";
import { Icon } from "../components/Icon";

type Material = { secret: string; uri: string; qrDataUrl: string };

export function SetupView({ onFinished, recoveryAuthorized = false }: { onFinished: () => void; recoveryAuthorized?: boolean }) {
  const [step, setStep] = useState<"unlock" | "totp" | "next" | "recovery">("unlock");
  const [setupSecret, setSetupSecret] = useState("");
  const [material, setMaterial] = useState<Material | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recoveryStarted = useRef(false);

  useEffect(() => {
    if (!recoveryAuthorized || recoveryStarted.current) return;
    recoveryStarted.current = true;
    setBusy(true);
    void postJson<Material>("/api/setup/unlock", { setupSecret: "" }).then((result) => { setMaterial(result); setStep("totp"); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Recovery setup could not be started.")).finally(() => setBusy(false));
  }, [recoveryAuthorized]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await postJson<Material>("/api/setup/unlock", { setupSecret }); setMaterial(result); setSetupSecret(""); setStep("totp"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Setup could not be unlocked."); }
    finally { setBusy(false); }
  };
  const verify = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await postJson<{ verified: boolean; needsNextWindow: boolean; recoveryCodes?: string[] }>("/api/setup/verify-totp", { code });
      setCode("");
      if (result.needsNextWindow) setStep("next");
      if (result.verified && result.recoveryCodes) { setRecoveryCodes(result.recoveryCodes); setStep("recovery"); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The code could not be accepted."); }
    finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true); setError("");
    try { const result = await postJson<{ csrfToken: string }>("/api/setup/finish", { recoveryCodesSaved: saved }); setCsrfToken(result.csrfToken); onFinished(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Setup could not be completed."); }
    finally { setBusy(false); }
  };
  const copyCodes = () => void navigator.clipboard.writeText(recoveryCodes.join("\n"));
  const downloadCodes = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`Dropiku recovery codes\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" }));
    link.download = "dropiku-recovery-codes.txt"; link.click(); URL.revokeObjectURL(link.href);
  };

  return <main className="auth-page"><section className="auth-window psu-card">
    <div className="auth-brand"><div className="psu-logo-frame"><img src="/assets/logos/dropiku.png" alt="Dropiku" /></div><div><h1>Set up Dropiku</h1><p>Private File Exchange</p></div></div>
    <div className="setup-progress" aria-label="Setup progress"><span className="is-done" /><span className={step !== "unlock" ? "is-done" : ""} /><span className={step === "recovery" ? "is-done" : ""} /></div>
    {step === "unlock" && (recoveryAuthorized ? <div className="stack"><div><p className="section-kicker">Recovery</p><h2>Preparing a new authenticator</h2><p className="muted">Your recovery code was accepted. Previous sessions and credentials have been revoked.</p></div></div> : <form className="stack" onSubmit={(event) => void unlock(event)}><div><p className="section-kicker">Step 1 of 3</p><h2>Unlock setup</h2><p className="muted">Enter the setup secret configured on the server. It is only valid before the first setup.</p></div><label className="psu-field"><span className="psu-label">Setup secret</span><input className="psu-input" type="password" autoComplete="off" value={setupSecret} onChange={(event) => setSetupSecret(event.target.value)} required /></label><button className="psu-button psu-button--filled psu-button--full" disabled={busy}>Continue</button></form>)}
    {(step === "totp" || step === "next") && material && <form className="stack" onSubmit={(event) => void verify(event)}><div><p className="section-kicker">Step 2 of 3</p><h2>{step === "next" ? "Verify the next code" : "Connect your authenticator"}</h2><p className="muted">Dropiku uses 10-digit codes every 30 seconds. Bitwarden Authenticator supports this format.</p></div>{step === "totp" && <><div className="qr-frame"><img src={material.qrDataUrl} alt="TOTP setup QR code" /></div><details><summary>Enter the secret manually</summary><code className="secret-value">{material.secret}</code><p className="tiny-break">{material.uri}</p></details></>} {step === "next" && <div className="psu-tonal-card calm-notice"><Icon name="history" /><span>Wait until your authenticator shows a different code. Two separate time windows confirm compatibility.</span></div>}<label className="psu-field"><span className="psu-label">10-digit code</span><input className="psu-input code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{10}" maxLength={10} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 10))} placeholder="00000 00000" required /></label><button className="psu-button psu-button--filled psu-button--full" disabled={busy || code.length !== 10}>Verify code</button></form>}
    {step === "recovery" && <div className="stack"><div><p className="section-kicker">Step 3 of 3</p><h2>Save recovery codes</h2><p className="muted">Each code works once. Store them outside this server; they will not be shown again.</p></div><div className="recovery-grid">{recoveryCodes.map((entry) => <code key={entry}>{entry}</code>)}</div><div className="button-row"><button className="psu-button psu-button--tonal" onClick={copyCodes}><Icon name="copy" />Copy</button><button className="psu-button psu-button--outlined" onClick={downloadCodes}><Icon name="download" />Download TXT</button></div><label className="check-row"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /><span>I have saved the recovery codes in a safe place.</span></label><button className="psu-button psu-button--filled psu-button--full" disabled={!saved || busy} onClick={() => void finish()}>Finish setup</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section></main>;
}
