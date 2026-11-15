const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dotenv = require("dotenv");
const { ensureAppEncryptionKey, isValidEncryptionKey } = require("../../modules/security/bootstrap-env");

function temporaryEnv() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ff-env-bootstrap-"));
  return {
    directory,
    envPath: path.join(directory, ".env"),
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

test("first startup generates a 32-byte encryption key and writes it privately to .env", async () => {
  const temp = temporaryEnv();
  try {
    const env = {};
    const result = await ensureAppEncryptionKey({ envPath: temp.envPath, env });
    const saved = dotenv.parse(fs.readFileSync(temp.envPath));
    assert.equal(result.generated, true);
    assert.equal(result.source, "file");
    assert.ok(isValidEncryptionKey(env.APP_ENCRYPTION_KEY));
    assert.equal(saved.APP_ENCRYPTION_KEY, env.APP_ENCRYPTION_KEY);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(temp.envPath).mode & 0o777, 0o600);
    }
    assert.equal(fs.existsSync(temp.envPath + ".lock"), false);
  } finally {
    temp.cleanup();
  }
});

test("placeholder is replaced while other .env values are preserved", async () => {
  const temp = temporaryEnv();
  try {
    fs.writeFileSync(temp.envPath, [
      "PORT=3000",
      "APP_ENCRYPTION_KEY=replace-with-64-hex-characters",
      "SESSION_SECRET=keep-this-value",
      ""
    ].join("\n"));
    const env = { APP_ENCRYPTION_KEY: "replace-with-64-hex-characters" };
    const result = await ensureAppEncryptionKey({ envPath: temp.envPath, env });
    const saved = dotenv.parse(fs.readFileSync(temp.envPath, "utf8"));
    assert.equal(result.generated, true);
    assert.ok(isValidEncryptionKey(saved.APP_ENCRYPTION_KEY));
    assert.equal(env.APP_ENCRYPTION_KEY, saved.APP_ENCRYPTION_KEY);
    assert.equal(saved.PORT, "3000");
    assert.equal(saved.SESSION_SECRET, "keep-this-value");
    assert.equal((fs.readFileSync(temp.envPath, "utf8").match(/^APP_ENCRYPTION_KEY=/gm) || []).length, 1);
  } finally {
    temp.cleanup();
  }
});

test("existing valid key is preserved between restarts", async () => {
  const temp = temporaryEnv();
  try {
    const firstEnv = {};
    const first = await ensureAppEncryptionKey({ envPath: temp.envPath, env: firstEnv });
    const firstKey = firstEnv.APP_ENCRYPTION_KEY;
    const secondEnv = {};
    const second = await ensureAppEncryptionKey({ envPath: temp.envPath, env: secondEnv });
    assert.equal(first.generated, true);
    assert.equal(second.generated, false);
    assert.equal(second.source, "file");
    assert.equal(secondEnv.APP_ENCRYPTION_KEY, firstKey);
    assert.equal(dotenv.parse(fs.readFileSync(temp.envPath)).APP_ENCRYPTION_KEY, firstKey);
  } finally {
    temp.cleanup();
  }
});

test("concurrent first starts adopt the same persisted key", async () => {
  const temp = temporaryEnv();
  try {
    const firstEnv = {};
    const secondEnv = {};
    const [first, second] = await Promise.all([
      ensureAppEncryptionKey({ envPath: temp.envPath, env: firstEnv, pollMs: 2 }),
      ensureAppEncryptionKey({ envPath: temp.envPath, env: secondEnv, pollMs: 2 })
    ]);
    assert.ok(isValidEncryptionKey(firstEnv.APP_ENCRYPTION_KEY));
    assert.equal(secondEnv.APP_ENCRYPTION_KEY, firstEnv.APP_ENCRYPTION_KEY);
    assert.equal(dotenv.parse(fs.readFileSync(temp.envPath)).APP_ENCRYPTION_KEY, firstEnv.APP_ENCRYPTION_KEY);
    assert.equal([first, second].filter(result => result.generated).length, 1);
  } finally {
    temp.cleanup();
  }
});

test("externally supplied valid key is used without writing it into .env", async () => {
  const temp = temporaryEnv();
  try {
    const key = "a".repeat(64);
    const result = await ensureAppEncryptionKey({ envPath: temp.envPath, env: { APP_ENCRYPTION_KEY: key } });
    assert.equal(result.generated, false);
    assert.equal(result.source, "environment");
    assert.equal(fs.existsSync(temp.envPath), false);
  } finally {
    temp.cleanup();
  }
});

test("malformed custom key fails safely instead of replacing a possible data key", async () => {
  const temp = temporaryEnv();
  try {
    assert.rejects(
      ensureAppEncryptionKey({ envPath: temp.envPath, env: { APP_ENCRYPTION_KEY: "not-a-key" } }),
      /formatnya tidak valid/i
    );
    fs.writeFileSync(temp.envPath, "APP_ENCRYPTION_KEY=possibly-an-existing-key\n");
    await assert.rejects(
      ensureAppEncryptionKey({ envPath: temp.envPath, env: {} }),
      /di .env tidak valid/i
    );
    assert.equal(fs.readFileSync(temp.envPath, "utf8"), "APP_ENCRYPTION_KEY=possibly-an-existing-key\n");
  } finally {
    temp.cleanup();
  }
});
