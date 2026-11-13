ALTER TABLE customers ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_opt_in IN (0,1));
ALTER TABLE customers ADD COLUMN whatsapp_opt_in_at TEXT;

CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  phone TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('test','reminder')),
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_created ON whatsapp_message_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_customer ON whatsapp_message_logs(customer_id, created_at DESC);
