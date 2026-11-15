CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL UNIQUE
    CHECK (length(trim(ticket_number)) BETWEEN 10 AND 40),
  customer_id INTEGER NOT NULL
    REFERENCES customers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  category TEXT NOT NULL
    CHECK (category IN ('internet','billing','account','other')),
  subject TEXT NOT NULL
    CHECK (length(trim(subject)) BETWEEN 5 AND 120),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
  assigned_to INTEGER
    REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  first_response_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_activity
ON support_tickets(status,last_activity_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_customer_activity
ON support_tickets(customer_id,last_activity_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned
ON support_tickets(assigned_to,status,last_activity_at DESC);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL
    REFERENCES support_tickets(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  sender_type TEXT NOT NULL
    CHECK (sender_type IN ('customer','staff','system')),
  sender_customer_id INTEGER
    REFERENCES customers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  sender_user_id INTEGER
    REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  message TEXT NOT NULL
    CHECK (length(trim(message)) BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (sender_type='customer' AND sender_customer_id IS NOT NULL AND sender_user_id IS NULL)
    OR (sender_type='staff' AND sender_customer_id IS NULL AND sender_user_id IS NOT NULL)
    OR (sender_type='system' AND sender_customer_id IS NULL AND sender_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
ON support_ticket_messages(ticket_id,id);

CREATE TRIGGER IF NOT EXISTS trg_support_ticket_customer_immutable
BEFORE UPDATE OF customer_id ON support_tickets
WHEN OLD.customer_id <> NEW.customer_id
BEGIN
  SELECT RAISE(ABORT, 'support ticket customer is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_support_message_customer_owner
BEFORE INSERT ON support_ticket_messages
WHEN NEW.sender_type='customer'
  AND NEW.sender_customer_id <> (
    SELECT customer_id FROM support_tickets WHERE id=NEW.ticket_id
  )
BEGIN
  SELECT RAISE(ABORT, 'ticket message customer must own the ticket');
END;

CREATE TRIGGER IF NOT EXISTS trg_support_messages_no_update
BEFORE UPDATE ON support_ticket_messages
BEGIN
  SELECT RAISE(ABORT, 'support ticket messages are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_support_messages_no_delete
BEFORE DELETE ON support_ticket_messages
BEGIN
  SELECT RAISE(ABORT, 'support ticket messages are immutable');
END;
