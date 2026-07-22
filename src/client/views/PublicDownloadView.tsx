import { useEffect, useState } from "react";
import { api, postJson, setCsrfToken } from "../lib/api";
import { formatBytes, formatRemaining } from "../lib/format";
import { Icon } from "../components/Icon";

interface ShareInfo { label: string | null; expiresAt: number; behavior: string; csrfToken?: string; files: Array<{ ref: string; displayName: string; sizeBytes: number }> }

export function PublicDownloadView({ publicId }: { publicId: string }) {
  const [info, setInfo] = useState<ShareInfo | null>(null); const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  useEffect(() => {
    const resolve = async () => {
      try {
        const secret = location.hash.slice(1);
        if (secret) { const result = await postJson<{ csrfToken: string }>("/api/public/download-shares/resolve", { publicId, secret }); setCsrfToken(result.csrfToken); history.replaceState({}, "", location.pathname); }
        const result = await api<ShareInfo>("/api/public/download-shares/session/info"); if (result.csrfToken) setCsrfToken(result.csrfToken); setInfo(result); setStatus("ready");
      } catch { history.replaceState({}, "", location.pathname); setStatus("unavailable"); }
    };
    void resolve();
  }, [publicId]);
  return <PublicFrame>{status === "loading" ? <section className="public-card psu-card skeleton-card"><div className="skeleton square" /><div className="skeleton line" /><div className="skeleton line short" /></section> : status === "unavailable" || !info ? <Unavailable /> : <section className="public-card psu-card"><div className="public-hero-icon"><Icon name="download" /></div><div className="public-heading"><p className="section-kicker">Private download</p><h1>{info.label || (info.files.length === 1 ? info.files[0]?.displayName : `${info.files.length} shared files`)}</h1><p>Available for {formatRemaining(info.expiresAt).toLowerCase()}.</p></div><div className="public-file-list">{info.files.map((file) => <div className="public-file" key={file.ref}><span className="file-type-icon"><Icon name="files" /></span><span><strong>{file.displayName}</strong><small>{formatBytes(file.sizeBytes)}</small></span><a className="psu-button psu-button--filled" href={`/api/public/download-shares/session/download/${file.ref}`}><Icon name="download" /><span className="download-label">Download</span></a></div>)}</div><p className="privacy-note"><Icon name="lock" />Files are delivered as downloads and are never previewed in the browser.</p></section>}</PublicFrame>;
}

function PublicFrame({ children }: { children: React.ReactNode }) { return <div className="public-shell"><header><div className="psu-app-symbol"><img src="/assets/logos/dropiku.png" alt="" /></div><div><strong>Dropiku</strong><span>Private File Exchange</span></div></header><main>{children}</main><footer>Shared privately with Dropiku</footer></div>; }
function Unavailable() { return <section className="public-card psu-card unavailable-card"><div className="public-hero-icon is-muted"><Icon name="alert" /></div><h1>Link not available</h1><p>This link is invalid, expired, revoked, or has reached its download limit.</p></section>; }
export { PublicFrame, Unavailable };
