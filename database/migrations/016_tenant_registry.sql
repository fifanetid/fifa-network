-- SaaS tenant registry and tenant-scoped integration credentials.
-- Existing installations are adopted into one default tenant. This migration
-- deliberately does NOT enable multi-tenant request routing: business-table
-- tenant keys and query scoping must land together in a later migration.
CREATE TABLE IF NOT EXISTS tenants (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 120),
 slug TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(slug)) BETWEEN 2 AND 80),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('trial','active','suspended','closed')),
 plan_code TEXT NOT NULL DEFAULT 'starter' CHECK(length(trim(plan_code)) BETWEEN 2 AND 40),
 timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tenant_memberships (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 role TEXT NOT NULL CHECK(role IN ('admin','finance','teknisi')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('invited','active','suspended')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id,status);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id,status,role);
CREATE TABLE IF NOT EXISTS tenant_domains (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 hostname TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(hostname)) BETWEEN 3 AND 253),
 is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
 verified_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_domains_one_primary
 ON tenant_domains(tenant_id) WHERE is_primary=1;
CREATE TABLE IF NOT EXISTS tenant_integrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 integration_type TEXT NOT NULL CHECK(integration_type IN ('genieacs','mikrotik','whatsapp','payment_gateway','smtp','radius')),
 display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 2 AND 100),
 endpoint_url TEXT,
 username TEXT,
 secret_encrypted TEXT,
 config_json TEXT NOT NULL DEFAULT '{}',
 is_enabled INTEGER NOT NULL DEFAULT 0 CHECK(is_enabled IN (0,1)),
 last_tested_at TEXT,
 last_test_status TEXT CHECK(last_test_status IS NULL OR last_test_status IN ('success','failed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,integration_type,display_name),
 CHECK(secret_encrypted IS NULL OR length(secret_encrypted)<=30000),
 CHECK(length(config_json)<=20000)
);
CREATE INDEX IF NOT EXISTS idx_tenant_integrations_tenant
 ON tenant_integrations(tenant_id,integration_type,is_enabled);
CREATE TABLE IF NOT EXISTS tenant_audit_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 actor_user_id INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
 event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 80),
 details_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(length(details_json)<=10000)
);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_events_tenant
 ON tenant_audit_events(tenant_id,created_at DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS trg_tenant_audit_no_update
 BEFORE UPDATE ON tenant_audit_events BEGIN SELECT RAISE(ABORT,'tenant audit events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_tenant_audit_no_delete
 BEFORE DELETE ON tenant_audit_events BEGIN SELECT RAISE(ABORT,'tenant audit events are immutable'); END;

INSERT OR IGNORE INTO tenants(name,slug,status,plan_code)
 VALUES('FIFA Network','fifa-network','active','starter');
INSERT OR IGNORE INTO tenant_memberships(tenant_id,user_id,role,status)
 SELECT t.id,u.id,u.role,'active'
 FROM users u CROSS JOIN tenants t
 WHERE t.slug='fifa-network';
