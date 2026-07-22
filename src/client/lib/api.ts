export interface ApiErrorBody {
  error: string;
  message: string;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
  }
}

let csrfToken = "";

export function setCsrfToken(value: string): void {
  csrfToken = value;
}

export function getCsrfToken(): string {
  return csrfToken;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body && typeof options.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    const fallback = { error: "request_failed", message: `Request failed with status ${response.status}.` };
    const body = await response.json().catch(() => fallback) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function patchJson<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteApi(path: string): Promise<void> {
  return api<void>(path, { method: "DELETE" });
}

export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (progress: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", path);
    request.withCredentials = true;
    if (csrfToken) request.setRequestHeader("X-CSRF-Token", csrfToken);
    request.upload.addEventListener("progress", (event) => onProgress(event.lengthComputable ? event.loaded / event.total : 0));
    request.addEventListener("load", () => {
      let body: unknown;
      try { body = JSON.parse(request.responseText); } catch { body = undefined; }
      if (request.status >= 200 && request.status < 300) resolve(body as T);
      else reject(new ApiError(request.status, (body as ApiErrorBody | undefined) ?? { error: "upload_failed", message: "The upload could not be completed." }));
    });
    request.addEventListener("error", () => reject(new ApiError(0, { error: "network_error", message: "The server could not be reached." })));
    request.addEventListener("abort", () => reject(new ApiError(0, { error: "upload_cancelled", message: "The upload was cancelled." })));
    request.send(form);
  });
}
