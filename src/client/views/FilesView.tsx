import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, deleteApi, patchJson, postJson, uploadWithProgress } from "../lib/api";
import type { FileItem } from "../lib/models";
import { formatBytes, formatDate, formatRemaining, shortHash } from "../lib/format";
import { Icon } from "../components/Icon";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toast";

const expiryOptions = [
  [900, "15 minutes"], [3600, "1 hour"], [21600, "6 hours"], [86400, "24 hours"], [259200, "3 days"], [604800, "7 days"],
] as const;

export function FilesView() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [storage, setStorage] = useState({ used: 0, limit: 1 });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [filter, setFilter] = useState("all");
  const [expiry, setExpiry] = useState(86400);
  const [pinAfterUpload, setPinAfterUpload] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; progress: number; state: string }>>([]);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  const [editFile, setEditFile] = useState<FileItem | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ sort, filter });
    if (search.trim()) params.set("search", search.trim());
    const result = await api<{ files: FileItem[]; storageBytes: number; storageLimitBytes: number }>(`/api/files?${params}`);
    setFiles(result.files); setStorage({ used: result.storageBytes, limit: result.storageLimitBytes });
  }, [search, sort, filter]);
  useEffect(() => { const timer = setTimeout(() => void load().catch((error: Error) => toast(error.message, "error")), 180); return () => clearTimeout(timer); }, [load, toast]);
  useEffect(() => {
    const listener = (event: ClipboardEvent) => {
      const pasted = [...(event.clipboardData?.files ?? [])];
      if (pasted.length) { event.preventDefault(); void upload(pasted); }
    };
    addEventListener("paste", listener); return () => removeEventListener("paste", listener);
  });

  const upload = async (selected: File[]) => {
    if (!selected.length) return;
    setUploads(selected.map((file) => ({ name: file.name, progress: 0, state: "Uploading" })));
    let completed = 0;
    for (const [index, file] of selected.entries()) {
      const form = new FormData(); form.append("file", file, file.name);
      try {
        await uploadWithProgress(`/api/files/upload?expiresIn=${expiry}&pinned=${String(pinAfterUpload)}`, form, (progress) => setUploads((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, progress } : entry)));
        completed += 1; setUploads((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, progress: 1, state: "Complete" } : entry));
      } catch (reason) { setUploads((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, state: reason instanceof Error ? reason.message : "Failed" } : entry)); }
    }
    if (completed) { toast(`${completed} ${completed === 1 ? "file" : "files"} uploaded.`); await load(); }
    window.setTimeout(() => setUploads([]), 4500);
  };
  const drop = (event: React.DragEvent) => { event.preventDefault(); setDragging(false); void upload([...event.dataTransfer.files]); };

  return <><section className="page-heading"><div><p className="section-kicker">Your private space</p><h2>Files</h2><p>Upload now, retrieve anywhere, and let temporary files clean themselves up.</p></div><div className="storage-pill" title={`${formatBytes(storage.used)} of ${formatBytes(storage.limit)}`}><span style={{ inlineSize: `${Math.min(100, storage.used / storage.limit * 100)}%` }} /><strong>{formatBytes(storage.used)}</strong><small>used</small></div></section>
    <section className={`psu-hero-card upload-hero ${dragging ? "is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <div className="upload-hero-copy"><div className="hero-icon"><Icon name="upload" /></div><div><h3>Quick upload</h3><p>Drop files here, paste from the clipboard, or choose them from this device.</p></div></div><div className="upload-settings"><label className="compact-field"><span>Keep for</span><select value={expiry} onChange={(event) => setExpiry(Number(event.target.value))}>{expiryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="check-row compact-check"><input type="checkbox" checked={pinAfterUpload} onChange={(event) => setPinAfterUpload(event.target.checked)} /><span>Pin after upload</span></label><input ref={input} className="psu-visually-hidden" type="file" multiple onChange={(event) => void upload([...(event.target.files ?? [])])} /><button className="psu-button psu-button--filled" onClick={() => input.current?.click()}><Icon name="upload" />Choose files</button></div>
      {uploads.length > 0 && <div className="upload-progress-list">{uploads.map((entry) => <div key={entry.name} className="upload-progress"><div><strong>{entry.name}</strong><span>{entry.state}</span></div><progress value={entry.progress} max={1} /></div>)}</div>}
    </section>
    <section className="content-section"><div className="section-toolbar"><div><h3>Stored files</h3><p>{files.length} {files.length === 1 ? "file" : "files"}</p></div><label className="search-control"><Icon name="search" /><input aria-label="Search files" placeholder="Search files" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="Filter files" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All files</option><option value="pinned">Pinned</option><option value="expiring">Expiring soon</option><option value="shared">Shared</option><option value="uploaded_by_request">Received</option></select><select aria-label="Sort files" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Name</option><option value="size_desc">Largest</option><option value="expires_soon">Expires soon</option></select></div>
      {files.length === 0 ? <div className="empty-state psu-card"><div className="empty-icon"><Icon name="upload" /></div><h3>No files yet</h3><p>Upload a file to retrieve it later from another device.</p><button className="psu-button psu-button--tonal" onClick={() => input.current?.click()}>Choose a file</button></div> : <><div className="file-cards">{files.map((file) => <FileCard key={file.id} file={file} onShare={() => setShareFile(file)} onEdit={() => setEditFile(file)} />)}</div><div className="file-table psu-card"><table><thead><tr><th>Name</th><th>Size</th><th>Availability</th><th>Shares</th><th>Uploaded</th><th><span className="psu-visually-hidden">Actions</span></th></tr></thead><tbody>{files.map((file) => <tr key={file.id}><td><div className="file-name"><span className="file-type-icon"><Icon name="files" /></span><span><strong>{file.displayName}</strong><small>{file.detectedMime} · {shortHash(file.sha256)}</small></span></div></td><td>{formatBytes(file.sizeBytes)}</td><td><span className={`status-chip ${file.pinned ? "is-pinned" : ""}`}>{file.pinned && <Icon name="pin" />}{formatRemaining(file.expiresAt)}</span></td><td>{file.activeShareCount}</td><td>{formatDate(file.createdAt)}</td><td><div className="table-actions"><a className="psu-icon-button" href={`/api/files/${file.id}/download`} aria-label={`Download ${file.displayName}`}><Icon name="download" /></a><button className="psu-icon-button" onClick={() => setShareFile(file)} aria-label={`Share ${file.displayName}`}><Icon name="share" /></button><button className="psu-icon-button" onClick={() => setEditFile(file)} aria-label={`More actions for ${file.displayName}`}><Icon name="more" /></button></div></td></tr>)}</tbody></table></div></>}
    </section><ShareDialog file={shareFile} onClose={() => setShareFile(null)} /><FileDialog file={editFile} onClose={() => setEditFile(null)} onChanged={() => void load()} />
  </>;
}

function FileCard({ file, onShare, onEdit }: { file: FileItem; onShare: () => void; onEdit: () => void }) {
  return <article className="file-card psu-card"><div className="file-card-main"><span className="file-type-icon"><Icon name="files" /></span><div><h4 title={file.displayName}>{file.displayName}</h4><p>{formatBytes(file.sizeBytes)} · {file.detectedMime}</p></div><button className="psu-icon-button" onClick={onEdit} aria-label={`More actions for ${file.displayName}`}><Icon name="more" /></button></div><div className="file-card-meta"><span className={`status-chip ${file.pinned ? "is-pinned" : ""}`}>{file.pinned && <Icon name="pin" />}{formatRemaining(file.expiresAt)}</span>{file.activeShareCount > 0 && <span className="status-chip"><Icon name="share" />{file.activeShareCount}</span>}</div><div className="file-card-actions"><a className="psu-button psu-button--tonal" href={`/api/files/${file.id}/download`}><Icon name="download" />Download</a><button className="psu-button psu-button--text" onClick={onShare}><Icon name="share" />Share</button></div></article>;
}

function ShareDialog({ file, onClose }: { file: FileItem | null; onClose: () => void }) {
  const [expires, setExpires] = useState(86400); const [max, setMax] = useState(""); const [label, setLabel] = useState(""); const [link, setLink] = useState(""); const [qr, setQr] = useState(""); const [busy, setBusy] = useState(false); const toast = useToast();
  useEffect(() => { if (!file) { setLink(""); setQr(""); } }, [file]);
  const create = async () => { if (!file) return; setBusy(true); try { const result = await postJson<{ link: string }>("/api/download-shares", { fileIds: [file.id], expiresInSeconds: expires, maxDownloads: max ? Number(max) : null, behavior: "show_landing_page", label: label || null }); setLink(result.link); setQr(await QRCode.toDataURL(result.link, { margin: 1, width: 260 })); } catch (reason) { toast(reason instanceof Error ? reason.message : "Share could not be created.", "error"); } finally { setBusy(false); } };
  const copy = () => void navigator.clipboard.writeText(link).then(() => toast("Link copied."));
  return <Dialog open={Boolean(file)} title={link ? "Share ready" : "Create download link"} onClose={onClose}>{file && (link ? <div className="stack share-result"><div className="qr-frame small"><img src={qr} alt="QR code for the download link" /></div><label className="psu-field"><span className="psu-label">Capability link</span><input className="psu-input" readOnly value={link} /></label><button className="psu-button psu-button--filled psu-button--full" onClick={copy}><Icon name="copy" />Copy link</button><p className="dialog-hint"><Icon name="info" />Test the link in a private window before sending it.</p></div> : <div className="stack"><div className="selected-file"><Icon name="files" /><span><strong>{file.displayName}</strong><small>{formatBytes(file.sizeBytes)}</small></span></div><label className="psu-field"><span className="psu-label">Available for</span><select className="psu-input" value={expires} onChange={(event) => setExpires(Number(event.target.value))}>{expiryOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label className="psu-field"><span className="psu-label">Maximum downloads · optional</span><input className="psu-input" type="number" min="1" max="10000" value={max} onChange={(event) => setMax(event.target.value)} placeholder="Unlimited" /></label><label className="psu-field"><span className="psu-label">Label · optional</span><input className="psu-input" maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Files for Alex" /></label><button className="psu-button psu-button--filled psu-button--full" onClick={() => void create()} disabled={busy}><Icon name="share" />Create link</button></div>)}</Dialog>;
}

function FileDialog({ file, onClose, onChanged }: { file: FileItem | null; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(""); const [expiry, setExpiry] = useState(86400); const toast = useToast();
  useEffect(() => { if (file) setName(file.displayName); }, [file]);
  const update = async (body: unknown) => { if (!file) return; try { await patchJson(`/api/files/${file.id}`, body); toast("File updated."); onChanged(); onClose(); } catch (reason) { toast(reason instanceof Error ? reason.message : "File could not be updated.", "error"); } };
  const remove = async () => { if (!file || !confirm(`Delete “${file.displayName}” and revoke its links?`)) return; try { await deleteApi(`/api/files/${file.id}`); toast("File deleted."); onChanged(); onClose(); } catch (reason) { toast(reason instanceof Error ? reason.message : "File could not be deleted.", "error"); } };
  const copyChecksum = () => { if (file) void navigator.clipboard.writeText(file.sha256).then(() => toast("SHA-256 copied.")); };
  return <Dialog open={Boolean(file)} title="File details" onClose={onClose}>{file && <div className="stack"><label className="psu-field"><span className="psu-label">Display name</span><input className="psu-input" value={name} maxLength={255} onChange={(event) => setName(event.target.value)} /></label><button className="psu-button psu-button--tonal" onClick={() => void update({ displayName: name })}>Save name</button><div className="psu-technical-card checksum"><span>SHA-256</span><code>{file.sha256}</code><button className="psu-icon-button" onClick={copyChecksum} aria-label="Copy SHA-256"><Icon name="copy" /></button></div>{file.pinned ? <div className="inline-form"><select className="psu-input" value={expiry} onChange={(event) => setExpiry(Number(event.target.value))}>{expiryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="psu-button psu-button--outlined" onClick={() => void update({ pinned: false, expiresInSeconds: expiry })}>Unpin</button></div> : <button className="psu-button psu-button--outlined" onClick={() => void update({ pinned: true })}><Icon name="pin" />Pin permanently</button>}<button className="psu-button psu-button--danger" onClick={() => void remove()}><Icon name="trash" />Delete file</button></div>}</Dialog>;
}
