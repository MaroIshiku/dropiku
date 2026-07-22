import { eq } from "drizzle-orm";
import { loadConfig } from "./config.js";
import { closeDatabase, createDatabase } from "./db.js";
import { appState, capabilitySessions, downloadShares, ownerConfig, recoveryCodes, sessions, uploadRequests } from "./schema.js";

const [, , group, command, ...flags] = process.argv;
if (group !== "admin" || command !== "reset-totp") {
  process.stderr.write("Usage: dropiku admin reset-totp --confirm [--revoke-links]\n");
  process.exitCode = 2;
} else if (!flags.includes("--confirm")) {
  process.stderr.write("This removes the current TOTP configuration and all sessions. Add --confirm to continue.\n");
  process.exitCode = 2;
} else {
  const config = loadConfig();
  const database = createDatabase(config);
  try {
    database.sqlite.transaction(() => {
      database.orm.delete(sessions).run();
      database.orm.delete(capabilitySessions).run();
      database.orm.delete(recoveryCodes).run();
      database.orm.delete(ownerConfig).where(eq(ownerConfig.singletonId, 1)).run();
      if (flags.includes("--revoke-links")) {
        const now = Date.now();
        database.orm.update(downloadShares).set({ revokedAt: now }).run();
        database.orm.update(uploadRequests).set({ revokedAt: now }).run();
      }
      database.orm.insert(appState).values({ key: "offline_totp_reset_at", value: new Date().toISOString(), updatedAt: Date.now() }).onConflictDoUpdate({ target: appState.key, set: { value: new Date().toISOString(), updatedAt: Date.now() } }).run();
    })();
    process.stdout.write("TOTP configuration and sessions were reset. Open /setup to configure a new authenticator.\n");
  } finally {
    closeDatabase(database);
  }
}
