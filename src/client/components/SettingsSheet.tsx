import { useEffect, useState } from "react";
import { api, postJson } from "../lib/api";
import { modes, themes, type Mode, type Theme } from "../lib/theme";
import { formatBytes } from "../lib/format";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

interface ThemeState { theme: Theme; mode: Mode; reduceMotion: boolean; setTheme: (value: Theme) => void; setMode: (value: Mode) => void; setReduceMotion: (value: boolean) => void }

export function SettingsSheet({ open, onClose, themeState, onLogout }: { open: boolean; onClose: () => void; themeState: ThemeState; onLogout: () => void }) {
  const [section, setSection] = useState<"appearance" | "about" | "admin" | "security">("appearance");
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const toast = useToast();
  useEffect(() => { if (open && section === "admin") void api<Record<string, unknown>>("/api/admin/diagnostics").then(setDiagnostics).catch(() => setDiagnostics(null)); }, [open, section]);
  if (!open) return null;
  const closeOnBackdrop = (event: React.MouseEvent) => { if (event.target === event.currentTarget) onClose(); };
  const revokeLinks = async () => { if (!confirm("Revoke every active public download and upload link?")) return; await postJson<void>("/api/security/revoke-public-links", {}); toast("All public links were revoked."); };
  const copyDebug = () => void navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)).then(() => toast("Debug details copied."));
  return <div className="psu-backdrop settings-backdrop" onMouseDown={closeOnBackdrop}><aside className="psu-sheet settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header className="dialog-header"><div><h2 id="settings-title">Settings</h2><p>Dropiku preferences and administration</p></div><button className="psu-icon-button" onClick={onClose} aria-label="Close settings"><Icon name="close" /></button></header><div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections">
    {([ ["appearance", "Appearance"], ["security", "Security"], ["admin", "Admin info"], ["about", "About"] ] as const).map(([id, label]) => <button key={id} className={section === id ? "is-active" : ""} onClick={() => setSection(id)}>{label}<Icon name="arrow" /></button>)}
  </nav><div className="settings-content">
    {section === "appearance" && <div className="stack"><div><h3>Color theme</h3><p className="muted">Shared Pixel Soft Utility themes</p></div><div className="theme-grid">{themes.map((theme) => <button key={theme} className={`theme-choice theme-${theme} ${themeState.theme === theme ? "is-selected" : ""}`} onClick={() => themeState.setTheme(theme)}><span className="theme-swatch" />{theme.charAt(0).toUpperCase() + theme.slice(1)}</button>)}</div><div><h3>Mode</h3><div className="psu-segmented-control mode-control">{modes.map((mode) => <button key={mode} aria-selected={themeState.mode === mode} onClick={() => themeState.setMode(mode)}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</button>)}</div></div><label className="toggle-row"><span><strong>Reduce motion</strong><small>Limit interface animation</small></span><input type="checkbox" checked={themeState.reduceMotion} onChange={(event) => themeState.setReduceMotion(event.target.checked)} /></label></div>}
    {section === "security" && <div className="stack"><div><h3>Owner security</h3><p className="muted">Sensitive actions affect every signed-in device.</p></div><button className="psu-list-row" onClick={() => void revokeLinks()}><Icon name="share" /><span><strong>Revoke all public links</strong><small>Disable download shares and upload requests</small></span><Icon name="arrow" /></button><button className="psu-list-row danger-row" onClick={onLogout}><Icon name="logout" /><span><strong>Sign out</strong><small>End this owner session</small></span><Icon name="arrow" /></button></div>}
    {section === "admin" && <div className="stack"><div><h3>Admin info</h3><p className="muted">Technical details stay here, away from the main interface.</p></div>{diagnostics ? <><div className="metric-grid"><Metric label="Version" value={String(diagnostics.version)} /><Metric label="Build" value={String(diagnostics.buildDate)} /><Metric label="Git SHA" value={String(diagnostics.gitSha)} /><Metric label="Server time" value={String(diagnostics.serverTime)} /></div><div className="psu-technical-card"><pre>{JSON.stringify(diagnostics, null, 2)}</pre></div><button className="psu-button psu-button--outlined" onClick={copyDebug}><Icon name="copy" />Copy debug details</button></> : <p className="muted">Diagnostics could not be loaded.</p>}</div>}
    {section === "about" && <div className="stack about-block"><div className="psu-logo-frame"><img src="/assets/logos/dropiku.png" alt="Dropiku" /></div><div><h3>Dropiku</h3><p className="muted">Private File Exchange</p></div><p>Temporary, self-hosted file exchange protected by TOTP and cryptographic capability links.</p><p className="muted">Part of the ishiku family · Pixel Soft Utility</p></div>}
  </div></div></aside></div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><small>{label}</small><strong title={value}>{label === "Storage" ? formatBytes(Number(value)) : value}</strong></div>; }
