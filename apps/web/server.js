require("dotenv").config();
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
