import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Mode, Theme } from "../lib/theme";
import { Icon, type IconName } from "./Icon";
import { SettingsSheet } from "./SettingsSheet";

const navigation: Array<{ path: string; label: string; icon: IconName }> = [
  { path: "/files", label: "Files", icon: "files" },
  { path: "/requests", label: "Upload links", icon: "inbox" },
  { path: "/activity", label: "Activity", icon: "history" },
];

interface ThemeState { theme: Theme; mode: Mode; reduceMotion: boolean; setTheme: (value: Theme) => void; setMode: (value: Mode) => void; setReduceMotion: (value: boolean) => void }

export function AppShell({ path, navigate, themeState, children, onLoggedOut }: { path: string; navigate: (path: string) => void; themeState: ThemeState; children: ReactNode; onLoggedOut: () => void }) {
  const [settings, setSettings] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const listener = () => setScrolled(scrollY > 8); addEventListener("scroll", listener, { passive: true }); return () => removeEventListener("scroll", listener); }, []);
  const logout = async () => { try { await api<void>("/api/auth/logout", { method: "POST" }); } finally { setSettings(false); onLoggedOut(); } };
  return <div className="psu-app-shell owner-shell"><header className={`psu-app-header ${scrolled ? "is-scrolled" : ""}`}><div className="psu-app-header__inner"><div className="psu-app-symbol"><img src="/assets/logos/dropiku.png" alt="" /></div><div className="psu-app-title-stack"><h1 className="psu-app-title">Dropiku</h1><p className="psu-app-subtitle">Private File Exchange</p></div><div className="psu-spacer" /><button className="psu-avatar-button" type="button" onClick={() => setSettings(true)} aria-label="Open settings">D</button></div></header><div className="shell-grid"><nav className="desktop-rail" aria-label="Primary navigation"><div className="rail-title">Workspace</div>{navigation.map((item) => <button key={item.path} className={path.startsWith(item.path) ? "is-active" : ""} onClick={() => navigate(item.path)}><Icon name={item.icon} /><span>{item.label}</span></button>)}<button className="rail-settings" onClick={() => setSettings(true)}><Icon name="settings" /><span>Settings</span></button></nav><main className="psu-main owner-main">{children}</main></div><nav className="bottom-nav" aria-label="Primary navigation">{navigation.map((item) => <button key={item.path} className={path.startsWith(item.path) ? "is-active" : ""} aria-current={path.startsWith(item.path) ? "page" : undefined} onClick={() => navigate(item.path)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav><SettingsSheet open={settings} onClose={() => setSettings(false)} themeState={themeState} onLogout={() => void logout()} /></div>;
}
