const { db } = require("../../database/db");

const insertLog = db.prepare(`
  INSERT INTO audit_logs (actor_user_id, actor_name, actor_role, action, entity_type, entity_id, summary)
  VALUES (@actor_user_id, @actor_name, @actor_role, @action, @entity_type, @entity_id, @summary)
`);

function recordAudit({ user, action, entityType, entityId = null, summary }) {
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) < 1) {
    throw new Error("Audit log membutuhkan pengguna yang terautentikasi.");
  }
  const values = {
    actor_user_id: Number(user.id),
    actor_name: String(user.name || "Pengguna").slice(0, 120),
    actor_role: ["admin", "finance", "teknisi"].includes(user.role) ? user.role : "system",
    action: String(action || "").slice(0, 80),
    entity_type: String(entityType || "").slice(0, 80),
    entity_id: entityId === null ? null : String(entityId).slice(0, 80),
    summary: String(summary || "").trim().slice(0, 500)
  };
  if (!values.action || !values.entity_type || !values.summary) throw new Error("Data audit log tidak lengkap.");
  return insertLog.run(values).lastInsertRowid;
}

module.exports = { recordAudit };
