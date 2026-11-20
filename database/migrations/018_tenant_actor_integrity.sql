-- Staff actors referenced by tenant-owned records must be active members
-- of the same tenant. System-generated records may keep nullable actor IDs.
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_actor_user_id_membership_insert
BEFORE INSERT ON audit_logs
WHEN NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.actor_user_id AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_actor_user_id_membership_update
BEFORE UPDATE OF actor_user_id,tenant_id ON audit_logs
WHEN NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.actor_user_id AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_payments_received_by_membership_insert
BEFORE INSERT ON payments
WHEN NEW.received_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.received_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_payments_received_by_membership_update
BEFORE UPDATE OF received_by,tenant_id ON payments
WHEN NEW.received_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.received_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_created_by_membership_insert
BEFORE INSERT ON payment_reversals
WHEN NEW.created_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.created_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_created_by_membership_update
BEFORE UPDATE OF created_by,tenant_id ON payment_reversals
WHEN NEW.created_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.created_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_customer_payment_confirmations_reviewed_by_membership_insert
BEFORE INSERT ON customer_payment_confirmations
WHEN NEW.reviewed_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.reviewed_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_customer_payment_confirmations_reviewed_by_membership_update
BEFORE UPDATE OF reviewed_by,tenant_id ON customer_payment_confirmations
WHEN NEW.reviewed_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.reviewed_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_app_settings_updated_by_membership_insert
BEFORE INSERT ON app_settings
WHEN NEW.updated_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.updated_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_app_settings_updated_by_membership_update
BEFORE UPDATE OF updated_by,tenant_id ON app_settings
WHEN NEW.updated_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.updated_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_expenses_created_by_membership_insert
BEFORE INSERT ON expenses
WHEN NEW.created_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.created_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_expenses_created_by_membership_update
BEFORE UPDATE OF created_by,tenant_id ON expenses
WHEN NEW.created_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.created_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_created_by_membership_insert
BEFORE INSERT ON inventory_movements
WHEN NEW.created_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.created_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_created_by_membership_update
BEFORE UPDATE OF created_by,tenant_id ON inventory_movements
WHEN NEW.created_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.created_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_genieacs_device_links_linked_by_membership_insert
BEFORE INSERT ON genieacs_device_links
WHEN NEW.linked_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.linked_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_genieacs_device_links_linked_by_membership_update
BEFORE UPDATE OF linked_by,tenant_id ON genieacs_device_links
WHEN NEW.linked_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.linked_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_mikrotik_routers_created_by_membership_insert
BEFORE INSERT ON mikrotik_routers
WHEN NEW.created_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.created_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_mikrotik_routers_created_by_membership_update
BEFORE UPDATE OF created_by,tenant_id ON mikrotik_routers
WHEN NEW.created_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.created_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_mikrotik_routers_updated_by_membership_insert
BEFORE INSERT ON mikrotik_routers
WHEN NEW.updated_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.updated_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_mikrotik_routers_updated_by_membership_update
BEFORE UPDATE OF updated_by,tenant_id ON mikrotik_routers
WHEN NEW.updated_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.updated_by AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_support_tickets_assigned_to_membership_insert
BEFORE INSERT ON support_tickets
WHEN NEW.assigned_to IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.assigned_to AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_support_tickets_assigned_to_membership_update
BEFORE UPDATE OF assigned_to,tenant_id ON support_tickets
WHEN NEW.assigned_to IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.assigned_to AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_support_ticket_messages_sender_user_id_membership_insert
BEFORE INSERT ON support_ticket_messages
WHEN NEW.sender_user_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.sender_user_id AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_support_ticket_messages_sender_user_id_membership_update
BEFORE UPDATE OF sender_user_id,tenant_id ON support_ticket_messages
WHEN NEW.sender_user_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.sender_user_id AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_audit_events_actor_user_id_membership_insert
BEFORE INSERT ON tenant_audit_events
WHEN NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.actor_user_id AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_audit_events_actor_user_id_membership_update
BEFORE UPDATE OF actor_user_id,tenant_id ON tenant_audit_events
WHEN NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=NEW.actor_user_id AND m.tenant_id=NEW.tenant_id
   AND m.status='active' AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'actor must be an active member of the same tenant'); END;

