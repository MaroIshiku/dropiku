import { useCallback, useEffect, useState } from "react";
import { api, setCsrfToken } from "./lib/api";
import { useTheme } from "./lib/theme";
import { ToastProvider } from "./components/Toast";
import { AppShell } from "./components/AppShell";
import { SetupView } from "./views/SetupView";
import { LoginView } from "./views/LoginView";
import { FilesView } from "./views/FilesView";
import { RequestsView } from "./views/RequestsView";
import { ActivityView } from "./views/ActivityView";
import { PublicDownloadView } from "./views/PublicDownloadView";
import { PublicUploadView } from "./views/PublicUploadView";

type State = "loading" | "setup" | "login" | "authenticated";

export function App() {
  const themeState = useTheme();
  const [path, setPath] = useState(location.pathname);
  const [state, setState] = useState<State>("loading");
  const [recoveryAuthorized, setRecoveryAuthorized] = useState(false);
  const [totpDigits, setTotpDigits] = useState<6 | 10>(10);
  const navigate = useCallback((next: string) => { history.pushState({}, "", next); setPath(next); scrollTo({ top: 0 }); }, []);
  useEffect(() => { const listener = () => setPath(location.pathname); addEventListener("popstate", listener); return () => removeEventListener("popstate", listener); }, []);
  const isPublic = /^\/(s|r)\/[A-Za-z0-9_-]+$/u.test(path);
  const bootstrap = useCallback(async () => {
    if (isPublic) return;
    try {
      const setup = await api<{ setupRequired: boolean; recoveryAuthorized: boolean; totpDigits: 6 | 10 }>("/api/setup/status");
      setTotpDigits(setup.totpDigits);
      if (setup.setupRequired) { setRecoveryAuthorized(setup.recoveryAuthorized); setState("setup"); if (path !== "/setup") navigate("/setup"); return; }
      try { const session = await api<{ csrfToken: string }>("/api/auth/session"); setCsrfToken(session.csrfToken); setState("authenticated"); if (["/", "/login", "/setup"].includes(path)) navigate("/files"); }
      catch { setState("login"); if (path !== "/login") navigate("/login"); }
    } catch { setState("login"); }
  }, [isPublic, navigate, path]);
  useEffect(() => { void bootstrap(); }, [bootstrap]);

  if (isPublic) {
    const [, type, publicId] = path.split("/");
    return <ToastProvider>{type === "s" ? <PublicDownloadView publicId={publicId!} /> : <PublicUploadView publicId={publicId!} />}</ToastProvider>;
  }
  if (state === "loading") return <div className="boot-screen"><img src="/assets/logos/dropiku.png" alt="Dropiku" /><span>Opening your private space…</span></div>;
  if (state === "setup") return <SetupView recoveryAuthorized={recoveryAuthorized} onFinished={(digits) => { setTotpDigits(digits); setRecoveryAuthorized(false); setState("authenticated"); navigate("/files"); }} />;
  if (state === "login") return <LoginView digits={totpDigits} onAuthenticated={(resetRequired) => { if (resetRequired) { setRecoveryAuthorized(true); setState("setup"); navigate("/setup"); } else { setState("authenticated"); navigate("/files"); } }} />;
  const view = path.startsWith("/requests") ? <RequestsView /> : path.startsWith("/activity") ? <ActivityView /> : <FilesView />;
  return <ToastProvider><AppShell path={path} navigate={navigate} themeState={themeState} onLoggedOut={() => { setCsrfToken(""); setState("login"); navigate("/login"); }}>{view}</AppShell></ToastProvider>;
}
