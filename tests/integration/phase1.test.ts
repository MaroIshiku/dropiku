import { afterEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { generateTotpCode } from "../../src/server/security/totp.js";
import { ingestFile } from "../../src/server/storage.js";
import { cookieHeader, mergeCookies, multipart, testApp } from "../helpers.js";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => cleanup?.());

describe("phase-one workflow", () => {
  it("sets up the owner, streams files, and enforces capability scopes", async () => {
    const fixture = await testApp(); cleanup = fixture.close;
    const status = await fixture.app.inject({ method: "GET", url: "/api/setup/status" });
    expect(status.json()).toEqual({ setupRequired: true, recoveryAuthorized: false });

    const unlock = await fixture.app.inject({ method: "POST", url: "/api/setup/unlock", payload: { setupSecret: fixture.config.setupSecret } });
    expect(unlock.statusCode).toBe(200);
    const setupCookie = cookieHeader(unlock);
    const secret = unlock.json<{ secret: string }>().secret;
    const now = Date.now();
    const first = await fixture.app.inject({ method: "POST", url: "/api/setup/verify-totp", headers: { cookie: setupCookie }, payload: { code: generateTotpCode(secret, now) } });
    expect(first.json().needsNextWindow).toBe(true);
    const second = await fixture.app.inject({ method: "POST", url: "/api/setup/verify-totp", headers: { cookie: setupCookie }, payload: { code: generateTotpCode(secret, now + 30_000) } });
    expect(second.statusCode).toBe(200);
    expect(second.json().recoveryCodes).toHaveLength(10);
    const finish = await fixture.app.inject({ method: "POST", url: "/api/setup/finish", headers: { cookie: setupCookie }, payload: { recoveryCodesSaved: true } });
    expect(finish.statusCode).toBe(200);
    const ownerCookie = mergeCookies(cookieHeader(finish));
    const csrf = finish.json<{ csrfToken: string }>().csrfToken;
    const replay = await fixture.app.inject({ method: "POST", url: "/api/auth/totp/login", payload: { code: generateTotpCode(secret, now + 30_000) } });
    expect(replay.statusCode).toBe(401);

    const source = Buffer.from("Dropiku integration test file\n");
    const ownerBody = multipart("notes.txt", source, "text/plain");
    const upload = await fixture.app.inject({ method: "POST", url: "/api/files/upload?expiresIn=86400&pinned=false", headers: { cookie: ownerCookie, "x-csrf-token": csrf, "content-type": `multipart/form-data; boundary=${ownerBody.boundary}` }, payload: ownerBody.payload });
    expect(upload.statusCode).toBe(201);
    const file = upload.json<{ files: Array<{ id: string; sha256: string }> }>().files[0]!;
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const download = await fixture.app.inject({ method: "GET", url: `/api/files/${file.id}/download`, headers: { cookie: ownerCookie } });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(source);

    const share = await fixture.app.inject({ method: "POST", url: "/api/download-shares", headers: { cookie: ownerCookie, "x-csrf-token": csrf }, payload: { fileIds: [file.id], expiresInSeconds: 3600, maxDownloads: 1 } });
    expect(share.statusCode).toBe(201);
    const shareUrl = new URL(share.json<{ link: string }>().link);
    const resolved = await fixture.app.inject({ method: "POST", url: "/api/public/download-shares/resolve", payload: { publicId: shareUrl.pathname.split("/").at(-1), secret: shareUrl.hash.slice(1) } });
    expect(resolved.statusCode).toBe(200);
    const capabilityCookie = cookieHeader(resolved);
    const info = await fixture.app.inject({ method: "GET", url: "/api/public/download-shares/session/info", headers: { cookie: capabilityCookie } });
    expect(info.json().files).toHaveLength(1);
    const publicDownload = await fixture.app.inject({ method: "GET", url: `/api/public/download-shares/session/download/${file.id}`, headers: { cookie: capabilityCookie } });
    expect(publicDownload.statusCode).toBe(200);
    const exhausted = await fixture.app.inject({ method: "GET", url: `/api/public/download-shares/session/download/${file.id}`, headers: { cookie: capabilityCookie } });
    expect(exhausted.statusCode).toBe(404);

    const request = await fixture.app.inject({ method: "POST", url: "/api/upload-requests", headers: { cookie: ownerCookie, "x-csrf-token": csrf }, payload: { title: "Send documents", expiresInSeconds: 3600, maxFilesPerSubmission: 2, maxSubmissions: 1, maxFileSizeBytes: 1024 * 1024, maxTotalBytesPerSubmission: 2 * 1024 * 1024, allowedExtensions: ["txt"] } });
    expect(request.statusCode).toBe(201);
    const requestUrl = new URL(request.json<{ link: string }>().link);
    const requestResolve = await fixture.app.inject({ method: "POST", url: "/api/public/upload-requests/resolve", payload: { publicId: requestUrl.pathname.split("/").at(-1), secret: requestUrl.hash.slice(1) } });
    const requestCookies = cookieHeader(requestResolve);
    const requestCsrf = requestResolve.json<{ csrfToken: string }>().csrfToken;
    const init = await fixture.app.inject({ method: "POST", url: "/api/public/upload-requests/session/submissions/init", headers: { cookie: requestCookies, "x-csrf-token": requestCsrf }, payload: { submitterName: "Guest" } });
    expect(init.statusCode).toBe(201);
    const concurrentLimit = await fixture.app.inject({ method: "POST", url: "/api/public/upload-requests/session/submissions/init", headers: { cookie: requestCookies, "x-csrf-token": requestCsrf }, payload: { submitterName: "Another guest" } });
    expect(concurrentLimit.statusCode).toBe(409);
    const submissionRef = init.json<{ submissionRef: string }>().submissionRef;
    const publicBody = multipart("guest.txt", Buffer.from("hello from guest"), "text/plain");
    const publicUpload = await fixture.app.inject({ method: "POST", url: `/api/public/upload-requests/session/submissions/${submissionRef}/files`, headers: { cookie: requestCookies, "x-csrf-token": requestCsrf, "content-type": `multipart/form-data; boundary=${publicBody.boundary}` }, payload: publicBody.payload });
    expect(publicUpload.statusCode).toBe(201);
    const complete = await fixture.app.inject({ method: "POST", url: `/api/public/upload-requests/session/submissions/${submissionRef}/complete`, headers: { cookie: requestCookies, "x-csrf-token": requestCsrf }, payload: {} });
    expect(complete.statusCode).toBe(200);
    const ownerFiles = await fixture.app.inject({ method: "GET", url: "/api/files?filter=uploaded_by_request", headers: { cookie: ownerCookie } });
    expect(ownerFiles.json().files).toHaveLength(1);
  });

  it("rejects traversal names and oversized streamed uploads before committing", async () => {
    const fixture = await testApp(); cleanup = fixture.close;
    await expect(ingestFile(fixture.config, Readable.from(Buffer.from("bad")), { filename: "../escape.txt", maximumBytes: 20 })).rejects.toThrow("file name");
    await expect(ingestFile(fixture.config, Readable.from(Buffer.alloc(21)), { filename: "large.bin", maximumBytes: 20 })).rejects.toThrow("size limit");
  });
});
