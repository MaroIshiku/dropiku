export interface FileItem {
  id: string;
  displayName: string;
  sizeBytes: number;
  sha256: string;
  clientMime: string | null;
  detectedMime: string;
  createdAt: number;
  uploadCompletedAt: number;
  expiresAt: number | null;
  pinnedAt: number | null;
  pinned: boolean;
  scanState: string;
  scanDetailSafe: string | null;
  ownerDownloadCount: number;
  publicDownloadCount: number;
  activeShareCount: number;
  uploadSourceType: string;
  submissionId: string | null;
}

export interface UploadRequestItem {
  id: string;
  title: string;
  message: string | null;
  createdAt: number;
  expiresAt: number;
  maxFilesPerSubmission: number;
  maxSubmissions: number | null;
  submissionCount: number;
  maxFileSizeBytes: number;
  maxTotalBytesPerSubmission: number;
  acceptedTotalBytes: number;
  active: boolean;
}

export interface ActivityEvent {
  id: string;
  eventType: string;
  severity: string;
  createdAt: number;
  actorType: string;
  actorReference: string | null;
  metadataJsonRedacted: string;
}
