# Tenant isolation matrix

Last reviewed: 2026-11-20  
Current default tenant: `1` (FIFA Network)

## Release gate

**Tenant 2 and tenant switching remain disabled.** The application is still a single-tenant deployment with an in-progress isolation foundation. A tenant ID column and route filter are necessary but not sufficient: database uniqueness, foreign-key ownership, every route, background worker, export, and integration must all enforce the same tenant boundary.

## Current application gates

| Area | Current protection | Remaining work / release gate |
|---|---|---|
| Staff authentication | Tenant membership is authoritative; login is limited to exactly one active membership in tenant 1 | Implement tenant selection only after every module is isolated; add platform-operator separation |
| Billing, customers, plans, subscriptions, invoices, payments | Main route and billing operations accept authenticated tenant ID; ownership and actor triggers exist | Rebuild legacy global unique keys; verify all ancillary queries and exports |
| Dashboard, reports, audit | Tenant-filtered | Add export-specific cross-tenant tests and review every new report query |
| ODP, expenses, inventory | Route-scoped and tenant ownership triggers | Tenant-scoped unique keys and composite parent references |
| MikroTik | Router records scoped to tenant | Router credentials/integration lifecycle and background polling must be per tenant; no write actions enabled |
| GenieACS | Device links scoped; integration configuration stored per tenant; device details are read-only | Tenant-scoped device uniqueness; isolate every future polling/provisioning worker; keep NBI private |
| Support tickets | Ticket/message routes scoped and actor membership guarded | Continue full route/export review and composite tenant-aware foreign keys |
| Customer portal | Login and portal records restricted to tenant 1 | Tenant-domain resolution, per-tenant portal auth/session isolation, tenant-scoped public URLs |
| WhatsApp | Logs scoped; scheduler rejects tenant IDs other than 1 | Separate Baileys connection, job lock, settings, credentials, and dedupe namespace per tenant |
| App settings | Tenant ownership column and guard exist | `setting_key` is globally primary-keyed; convert to tenant-scoped composite key |
| Integrations | GenieACS configuration is tenant-aware | WhatsApp, SMTP, RADIUS, and payment gateway configuration/secret rotation must be tenant-aware |
| Tenant domains | Registry exists | Domain ownership verification, routing, TLS lifecycle, and collision protection |
| Platform operations | Not implemented | Separate platform operator role, audited onboarding/suspension, tenant lifecycle controls |

## Legacy global uniqueness blockers

The following constraints are still global in the legacy SQLite schema. They prevent otherwise valid duplicate values across different tenants and must be redesigned before tenant 2 is enabled.

| Table | Legacy key | Required target |
|---|---|---|
| `customers` | `customer_code` | `UNIQUE(tenant_id, customer_code)` |
| `internet_plans` | `plan_code` | `UNIQUE(tenant_id, plan_code)` |
| `invoices` | `invoice_number`; `UNIQUE(subscription_id, billing_period)` | Tenant-scoped invoice number and `UNIQUE(tenant_id, subscription_id, billing_period)` |
| `payments` | `payment_reference` | `UNIQUE(tenant_id, payment_reference)` |
| `payment_reversals` | `reversal_reference` | `UNIQUE(tenant_id, reversal_reference)` |
| `support_tickets` | `ticket_number` | `UNIQUE(tenant_id, ticket_number)` |
| `voucher_packages` | `package_code` | `UNIQUE(tenant_id, package_code)` |
| `network_odps` | `odp_code` | `UNIQUE(tenant_id, odp_code)` |
| `expense_categories` | `name` | `UNIQUE(tenant_id, name)` |
| `expenses` | `expense_number` | `UNIQUE(tenant_id, expense_number)` |
| `inventory_items` | `sku` | `UNIQUE(tenant_id, sku)` |
| `genieacs_device_links` | `genieacs_device_id` | `UNIQUE(tenant_id, genieacs_device_id)` |
| `mikrotik_routers` | `(host, api_port)` | `UNIQUE(tenant_id, host, api_port)` |
| `whatsapp_message_logs` | `dedupe_key` | Tenant-scoped dedupe key; preserve nullable-key behavior |
| `app_settings` | `setting_key` primary key | `PRIMARY KEY(tenant_id, setting_key)` |

User email remains globally unique intentionally: user accounts are identities that may belong to more than one tenant after safe tenant selection is implemented.

## SQLite migration design requirements

The table rebuild must be treated as a coordinated schema migration, not a sequence of ad-hoc `ALTER TABLE` statements.

1. Inventory every table's `sqlite_master` SQL, indexes, triggers, and inbound/outbound foreign keys before changing it.
2. Preserve primary keys and all existing IDs; preserve data, CHECK constraints, defaults, collations, indexes, and trigger semantics.
3. Add composite candidate keys such as `UNIQUE(tenant_id, id)` to tenant-owned parent tables where needed.
4. Rebuild child foreign keys to reference composite parent keys, for example `(tenant_id, customer_id) REFERENCES customers(tenant_id, id)`. A trigger-only relationship check is an interim guard, not the final relational model.
5. Keep user actor references distinct from tenant-owned business references; actor integrity remains enforced through active tenant membership.
6. Run the migration against a populated copy of a legacy database and verify row counts, IDs, foreign keys, indexes, triggers, and representative insert/update/delete behavior.
7. Run `PRAGMA foreign_key_check` after the migration and fail the migration if any row is returned.
8. Prove rollback behavior and backup/restore before applying to an existing installation.
9. Do not disable foreign-key enforcement inside the existing transaction wrapper and assume the pragma took effect. SQLite ignores attempts to toggle `foreign_keys` while a transaction is active.

## Required tests before tenant activation

- Same customer/plan/invoice/payment/reference/code may exist in two tenants when allowed by each tenant's own business rules.
- Duplicate key within one tenant is rejected, including case-insensitive keys.
- Cross-tenant subscription, invoice, payment, reversal, ticket, inventory, ODP, router, and GenieACS relationships are rejected by database constraints.
- Tenant-owned rows cannot change tenant ownership.
- Every list, detail, create, update, delete, search, dashboard, report, export, portal endpoint, API, and background job is tested with a tenant-2 fixture while authenticated as tenant 1.
- Scheduler locks, idempotency keys, integration credentials, and domain routing cannot collide or leak across tenants.
- A user with multiple memberships can select only a tenant in which they have an active membership; the selection is session-bound and revalidated on requests.

## Deployment boundary

This matrix describes the code currently merged to `main); it does not mean tenant 2 is safe to activate. No production deployment or VPS migration is implied. SQLite remains the supported self-hosted/small-installation database. Before public SaaS scale, evaluate PostgreSQL and a production-grade migration/backup/restore strategy.
