import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closeDatabase } from "./db.js";
import { startCleanupWorker } from "./lifecycle.js";

const config = loadConfig();
const app = await buildApp(config);
const stopCleanup = startCleanupWorker(app.database, config, app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down Dropiku.");
  stopCleanup();
  await app.close();
  closeDatabase(app.database);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
