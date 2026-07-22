import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ActivityEvent } from "../lib/models";
import { formatDate } from "../lib/format";
import { Icon, type IconName } from "../components/Icon";
import { useToast } from "../components/Toast";

const eventLabels: Record<string, string> = {
  owner_login_success: "Owner signed in", owner_login_failed: "A sign-in attempt failed", file_uploaded: "File uploaded",
  file_downloaded_owner: "File downloaded", file_downloaded_public: "Shared file downloaded", share_created: "Download link created",
  share_revoked: "Download link revoked", upload_request_created: "Upload link created", upload_request_revoked: "Upload link revoked",
  submission_received: "New submission received", file_expired_deleted: "Expired file deleted", setup_completed: "Setup completed",
  file_pinned: "File pinned", file_deleted: "File deleted", recovery_codes_regenerated: "Recovery codes regenerated",
};

function iconFor(type: string): IconName { if (type.includes("upload") || type.includes("submission")) return "upload"; if (type.includes("download")) return "download"; if (type.includes("share") || type.includes("link")) return "link"; if (type.includes("login") || type.includes("setup")) return "lock"; if (type.includes("delete") || type.includes("revoked")) return "trash"; return "history"; }

export function ActivityView() {
  const [events, setEvents] = useState<ActivityEvent[]>([]); const toast = useToast();
  useEffect(() => { void api<{ events: ActivityEvent[] }>("/api/activity?limit=150").then((result) => setEvents(result.events)).catch((error: Error) => toast(error.message, "error")); }, [toast]);
  return <><section className="page-heading"><div><p className="section-kicker">Private audit trail</p><h2>Activity</h2><p>Security and file events without raw IP addresses, secrets, or full browser fingerprints.</p></div></section><section className="activity-list psu-card">{events.length ? events.map((event, index) => <article className="activity-row" key={event.id}><div className={`activity-icon ${event.severity === "warn" ? "is-warning" : ""}`}><Icon name={iconFor(event.eventType)} /></div><div><strong>{eventLabels[event.eventType] ?? event.eventType.replaceAll("_", " ")}</strong><p>{event.actorType === "system" ? "Automated maintenance" : event.actorType === "owner" ? "Owner action" : event.actorType === "public_share" ? "Public download link" : "Public upload link"}</p></div><time dateTime={new Date(event.createdAt).toISOString()}>{formatDate(event.createdAt)}</time>{index < events.length - 1 && <span className="activity-line" />}</article>) : <div className="empty-state"><div className="empty-icon"><Icon name="history" /></div><h3>No activity yet</h3><p>Relevant events will appear here.</p></div>}</section></>;
}
