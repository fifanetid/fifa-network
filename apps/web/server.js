require("dotenv").config();
const app = require("./app");

const port = Number(process.env.PORT || 3000);
const cron = require("node-cron");
const whatsapp = require("../../modules/whatsapp/client");
const { processReminders } = require("../../modules/whatsapp/reminders");

if (whatsapp.hasSavedSession()) {
  whatsapp.connect().catch((error) => console.error("WhatsApp reconnect failed:", error.message));
}

cron.schedule("0 9 * * *", async () => {
  try {
    const result = await processReminders({ limit: 20, delayMs: 5000 });
    console.log("WhatsApp reminders:", result);
  } catch (error) {
    console.error("WhatsApp reminder job failed:", error);
  }
}, { timezone: "Asia/Jakarta" });
app.listen(port, "127.0.0.1", () => {
  console.log(`FF BILLING web started at http://127.0.0.1:${port}`);
});
