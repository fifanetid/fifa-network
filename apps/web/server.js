"use strict";

const path = require("node:path");
const envPath = path.resolve(process.env.DOTENV_CONFIG_PATH || path.join(process.cwd(), ".env"));
require("dotenv").config({ path: envPath });

const { ensureAppEncryptionKey } = require("../../modules/security/bootstrap-env");

async function start() {
  const keyResult = await ensureAppEncryptionKey({ envPath });
  if (keyResult.generated) {
    console.log("APP_ENCRYPTION_KEY dibuat otomatis dan disimpan ke .env dengan izin file privat.");
  }

  // Load the application only after the encryption key is available.
  const app = require("./app");
  const port = Number(process.env.PORT || 3000);
  const whatsapp = require("../../modules/whatsapp/client");
  const { startAutomaticReminderScheduler } = require("../../modules/whatsapp/scheduler");

  if (whatsapp.hasSavedSession()) {
    whatsapp.connect().catch((error) => console.error("WhatsApp reconnect failed:", error.message));
  }

  // The scheduler checks its persisted enabled flag every day at 09:00 Asia/Jakarta.
  // It remains disabled by default until an admin explicitly enables it.
  startAutomaticReminderScheduler();

  app.listen(port, "127.0.0.1", () => {
    console.log(`FF BILLING web started at http://127.0.0.1:${port}`);
  });
}

start().catch((error) => {
  console.error("FF BILLING startup failed:", error.message);
  process.exitCode = 1;
});
