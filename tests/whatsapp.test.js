const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-whatsapp-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "whatsapp.sqlite");
const { reminderStage } = require("../modules/whatsapp/reminders");

test("jadwal pengingat WhatsApp mengikuti H-3, hari H, H+3 dan setiap 7 hari", () => {
  assert.equal(reminderStage(3), "h3");
  assert.equal(reminderStage(0), "due");
  assert.equal(reminderStage(-3), "overdue3");
  assert.equal(reminderStage(-10), "overdue10");
  assert.equal(reminderStage(-17), "overdue17");
  assert.equal(reminderStage(2), null);
  assert.equal(reminderStage(-4), null);
});

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
