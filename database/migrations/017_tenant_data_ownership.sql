-- Tenant ownership for existing business data. Existing records are assigned to
-- the default tenant (id=1, created by migration 016). Tenant switching remains
-- disabled until every route/job/report is tenant-scoped and tested.
-- SQLite ADD COLUMN cannot add a REFERENCES column with a non-NULL default while
-- foreign_keys are enabled, so tenant existence is enforced by triggers below.
ALTER TABLE customers ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers(tenant_id,id);
ALTER TABLE internet_plans ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_internet_plans_tenant_id ON internet_plans(tenant_id,id);
ALTER TABLE subscriptions ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions(tenant_id,id);
ALTER TABLE invoices ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id,id);
ALTER TABLE payments ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id,id);
ALTER TABLE payment_reversals ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_payment_reversals_tenant_id ON payment_reversals(tenant_id,id);
ALTER TABLE audit_logs ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id,id);
ALTER TABLE whatsapp_message_logs ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_logs_tenant_id ON whatsapp_message_logs(tenant_id,id);
ALTER TABLE app_settings ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_app_settings_tenant_id ON app_settings(tenant_id,setting_key);
ALTER TABLE voucher_packages ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_voucher_packages_tenant_id ON voucher_packages(tenant_id,id);
ALTER TABLE customer_portal_accounts ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_customer_portal_accounts_tenant_id ON customer_portal_accounts(tenant_id,id);
ALTER TABLE customer_payment_confirmations ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_customer_payment_confirmations_tenant_id ON customer_payment_confirmations(tenant_id,id);
ALTER TABLE support_tickets ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_id ON support_tickets(tenant_id,id);
ALTER TABLE support_ticket_messages ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_tenant_id ON support_ticket_messages(tenant_id,id);
ALTER TABLE mikrotik_routers ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_tenant_id ON mikrotik_routers(tenant_id,id);
ALTER TABLE genieacs_device_links ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_genieacs_device_links_tenant_id ON genieacs_device_links(tenant_id,id);
ALTER TABLE network_odps ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_network_odps_tenant_id ON network_odps(tenant_id,id);
ALTER TABLE expense_categories ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant_id ON expense_categories(tenant_id,id);
ALTER TABLE expenses ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id ON expenses(tenant_id,id);
ALTER TABLE inventory_items ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_id ON inventory_items(tenant_id,id);
ALTER TABLE inventory_movements ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id > 0);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_id ON inventory_movements(tenant_id,id);

-- Every tenant-owned row must point at a real tenant.
CREATE TRIGGER IF NOT EXISTS trg_customers_tenant_exists_insert
BEFORE INSERT ON customers
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_customers_tenant_exists_update
BEFORE UPDATE OF tenant_id ON customers
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_internet_plans_tenant_exists_insert
BEFORE INSERT ON internet_plans
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_internet_plans_tenant_exists_update
BEFORE UPDATE OF tenant_id ON internet_plans
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_subscriptions_tenant_exists_insert
BEFORE INSERT ON subscriptions
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_subscriptions_tenant_exists_update
BEFORE UPDATE OF tenant_id ON subscriptions
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_invoices_tenant_exists_insert
BEFORE INSERT ON invoices
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_invoices_tenant_exists_update
BEFORE UPDATE OF tenant_id ON invoices
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_payments_tenant_exists_insert
BEFORE INSERT ON payments
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_payments_tenant_exists_update
BEFORE UPDATE OF tenant_id ON payments
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_tenant_exists_insert
BEFORE INSERT ON payment_reversals
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_tenant_exists_update
BEFORE UPDATE OF tenant_id ON payment_reversals
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_tenant_exists_insert
BEFORE INSERT ON audit_logs
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_tenant_exists_update
BEFORE UPDATE OF tenant_id ON audit_logs
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_whatsapp_message_logs_tenant_exists_insert
BEFORE INSERT ON whatsapp_message_logs
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_whatsapp_message_logs_tenant_exists_update
BEFORE UPDATE OF tenant_id ON whatsapp_message_logs
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_app_settings_tenant_exists_insert
BEFORE INSERT ON app_settings
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_app_settings_tenant_exists_update
BEFORE UPDATE OF tenant_id ON app_settings
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_voucher_packages_tenant_exists_insert
BEFORE INSERT ON voucher_packages
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_voucher_packages_tenant_exists_update
BEFORE UPDATE OF tenant_id ON voucher_packages
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_customer_portal_accounts_tenant_exists_insert
BEFORE INSERT ON customer_portal_accounts
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_customer_portal_accounts_tenant_exists_update
BEFORE UPDATE OF tenant_id ON customer_portal_accounts
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_customer_payment_confirmations_tenant_exists_insert
BEFORE INSERT ON customer_payment_confirmations
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_customer_payment_confirmations_tenant_exists_update
BEFORE UPDATE OF tenant_id ON customer_payment_confirmations
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_support_tickets_tenant_exists_insert
BEFORE INSERT ON support_tickets
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_support_tickets_tenant_exists_update
BEFORE UPDATE OF tenant_id ON support_tickets
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_support_ticket_messages_tenant_exists_insert
BEFORE INSERT ON support_ticket_messages
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_support_ticket_messages_tenant_exists_update
BEFORE UPDATE OF tenant_id ON support_ticket_messages
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_mikrotik_routers_tenant_exists_insert
BEFORE INSERT ON mikrotik_routers
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_mikrotik_routers_tenant_exists_update
BEFORE UPDATE OF tenant_id ON mikrotik_routers
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_genieacs_device_links_tenant_exists_insert
BEFORE INSERT ON genieacs_device_links
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_genieacs_device_links_tenant_exists_update
BEFORE UPDATE OF tenant_id ON genieacs_device_links
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_network_odps_tenant_exists_insert
BEFORE INSERT ON network_odps
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_network_odps_tenant_exists_update
BEFORE UPDATE OF tenant_id ON network_odps
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_categories_tenant_exists_insert
BEFORE INSERT ON expense_categories
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_categories_tenant_exists_update
BEFORE UPDATE OF tenant_id ON expense_categories
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_expenses_tenant_exists_insert
BEFORE INSERT ON expenses
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_expenses_tenant_exists_update
BEFORE UPDATE OF tenant_id ON expenses
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_items_tenant_exists_insert
BEFORE INSERT ON inventory_items
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_items_tenant_exists_update
BEFORE UPDATE OF tenant_id ON inventory_items
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_tenant_exists_insert
BEFORE INSERT ON inventory_movements
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_tenant_exists_update
BEFORE UPDATE OF tenant_id ON inventory_movements
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'unknown tenant'); END;

-- Parent/child tenant boundaries. These guards are database-level so direct SQL
-- writes cannot create cross-tenant business relationships.
CREATE TRIGGER IF NOT EXISTS trg_customers_odp_tenant_insert
BEFORE INSERT ON customers
WHEN NEW.odp_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM network_odps WHERE id=NEW.odp_id)
BEGIN SELECT RAISE(ABORT,'customer and ODP must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_customers_odp_tenant_update
BEFORE UPDATE OF odp_id,tenant_id ON customers
WHEN NEW.odp_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM network_odps WHERE id=NEW.odp_id)
BEGIN SELECT RAISE(ABORT,'customer and ODP must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_subscriptions_tenant_insert
BEFORE INSERT ON subscriptions
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
 OR NEW.tenant_id <> (SELECT tenant_id FROM internet_plans WHERE id=NEW.plan_id)
BEGIN SELECT RAISE(ABORT,'subscription relations must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_subscriptions_tenant_update
BEFORE UPDATE OF customer_id,plan_id,tenant_id ON subscriptions
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
 OR NEW.tenant_id <> (SELECT tenant_id FROM internet_plans WHERE id=NEW.plan_id)
BEGIN SELECT RAISE(ABORT,'subscription relations must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_tenant_insert
BEFORE INSERT ON invoices
WHEN NEW.tenant_id <> (SELECT tenant_id FROM subscriptions WHERE id=NEW.subscription_id)
 OR NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'invoice relations must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_invoices_tenant_update
BEFORE UPDATE OF subscription_id,customer_id,tenant_id ON invoices
WHEN NEW.tenant_id <> (SELECT tenant_id FROM subscriptions WHERE id=NEW.subscription_id)
 OR NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'invoice relations must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_payments_tenant_insert
BEFORE INSERT ON payments
WHEN NEW.tenant_id <> (SELECT tenant_id FROM invoices WHERE id=NEW.invoice_id)
BEGIN SELECT RAISE(ABORT,'payment and invoice must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_payments_tenant_update
BEFORE UPDATE OF invoice_id,tenant_id ON payments
WHEN NEW.tenant_id <> (SELECT tenant_id FROM invoices WHERE id=NEW.invoice_id)
BEGIN SELECT RAISE(ABORT,'payment and invoice must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_tenant_insert
BEFORE INSERT ON payment_reversals
WHEN NEW.tenant_id <> (SELECT tenant_id FROM payments WHERE id=NEW.payment_id)
BEGIN SELECT RAISE(ABORT,'payment reversal and payment must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_tenant_update
BEFORE UPDATE OF payment_id,tenant_id ON payment_reversals
WHEN NEW.tenant_id <> (SELECT tenant_id FROM payments WHERE id=NEW.payment_id)
BEGIN SELECT RAISE(ABORT,'payment reversal and payment must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_portal_accounts_tenant_insert
BEFORE INSERT ON customer_portal_accounts
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'portal account and customer must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_portal_accounts_tenant_update
BEFORE UPDATE OF customer_id,tenant_id ON customer_portal_accounts
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'portal account and customer must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_payment_confirmations_tenant_insert
BEFORE INSERT ON customer_payment_confirmations
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
 OR NEW.tenant_id <> (SELECT tenant_id FROM invoices WHERE id=NEW.invoice_id)
 OR (NEW.payment_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM payments WHERE id=NEW.payment_id))
BEGIN SELECT RAISE(ABORT,'payment confirmation relations must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_confirmations_tenant_update
BEFORE UPDATE OF customer_id,invoice_id,payment_id,tenant_id ON customer_payment_confirmations
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
 OR NEW.tenant_id <> (SELECT tenant_id FROM invoices WHERE id=NEW.invoice_id)
 OR (NEW.payment_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM payments WHERE id=NEW.payment_id))
BEGIN SELECT RAISE(ABORT,'payment confirmation relations must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_whatsapp_logs_tenant_insert
BEFORE INSERT ON whatsapp_message_logs
WHEN (NEW.customer_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id))
 OR (NEW.invoice_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM invoices WHERE id=NEW.invoice_id))
BEGIN SELECT RAISE(ABORT,'WhatsApp log relations must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_whatsapp_logs_tenant_update
BEFORE UPDATE OF customer_id,invoice_id,tenant_id ON whatsapp_message_logs
WHEN (NEW.customer_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id))
 OR (NEW.invoice_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM invoices WHERE id=NEW.invoice_id))
BEGIN SELECT RAISE(ABORT,'WhatsApp log relations must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_expenses_tenant_insert
BEFORE INSERT ON expenses
WHEN NEW.category_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM expense_categories WHERE id=NEW.category_id)
BEGIN SELECT RAISE(ABORT,'expense category must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_expenses_tenant_update
BEFORE UPDATE OF category_id,tenant_id ON expenses
WHEN NEW.category_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM expense_categories WHERE id=NEW.category_id)
BEGIN SELECT RAISE(ABORT,'expense category must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_tenant_insert
BEFORE INSERT ON inventory_movements
WHEN NEW.tenant_id <> (SELECT tenant_id FROM inventory_items WHERE id=NEW.item_id)
BEGIN SELECT RAISE(ABORT,'inventory movement and item must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_tenant_update
BEFORE UPDATE OF item_id,tenant_id ON inventory_movements
WHEN NEW.tenant_id <> (SELECT tenant_id FROM inventory_items WHERE id=NEW.item_id)
BEGIN SELECT RAISE(ABORT,'inventory movement and item must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_support_tickets_tenant_insert
BEFORE INSERT ON support_tickets
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'support ticket and customer must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_support_tickets_tenant_update
BEFORE UPDATE OF customer_id,tenant_id ON support_tickets
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'support ticket and customer must belong to the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_support_messages_tenant_insert
BEFORE INSERT ON support_ticket_messages
WHEN NEW.tenant_id <> (SELECT tenant_id FROM support_tickets WHERE id=NEW.ticket_id)
 OR (NEW.sender_customer_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.sender_customer_id))
 OR (NEW.sender_user_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM tenant_memberships m
   WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.sender_user_id AND m.status='active'
 ))
BEGIN SELECT RAISE(ABORT,'support message participants must belong to the ticket tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_support_messages_tenant_update
BEFORE UPDATE OF ticket_id,sender_customer_id,sender_user_id,tenant_id ON support_ticket_messages
WHEN NEW.tenant_id <> (SELECT tenant_id FROM support_tickets WHERE id=NEW.ticket_id)
 OR (NEW.sender_customer_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.sender_customer_id))
 OR (NEW.sender_user_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM tenant_memberships m
   WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.sender_user_id AND m.status='active'
 ))
BEGIN SELECT RAISE(ABORT,'support message participants must belong to the ticket tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_genieacs_links_tenant_insert
BEFORE INSERT ON genieacs_device_links
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
 OR (NEW.subscription_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM subscriptions WHERE id=NEW.subscription_id))
BEGIN SELECT RAISE(ABORT,'GenieACS link relations must belong to the same tenant'); END;
CREATE TRIGGER IF NOT EXISTS trg_genieacs_links_tenant_update
BEFORE UPDATE OF customer_id,subscription_id,tenant_id ON genieacs_device_links
WHEN NEW.tenant_id <> (SELECT tenant_id FROM customers WHERE id=NEW.customer_id)
 OR (NEW.subscription_id IS NOT NULL AND NEW.tenant_id <> (SELECT tenant_id FROM subscriptions WHERE id=NEW.subscription_id))
BEGIN SELECT RAISE(ABORT,'GenieACS link relations must belong to the same tenant'); END;
