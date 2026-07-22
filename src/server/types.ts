import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";

export interface OwnerSessionContext {
  id: string;
  csrfHash: string;
}

export interface CapabilitySessionContext {
  id: string;
  csrfHash: string;
  scopeType: "download_share" | "upload_request";
  scopeId: string;
}

declare module "fastify" {
  interface FastifyInstance {
    appConfig: AppConfig;
    database: AppDatabase;
  }
  interface FastifyRequest {
    ownerSession?: OwnerSessionContext;
    capabilitySession?: CapabilitySessionContext;
  }
}
