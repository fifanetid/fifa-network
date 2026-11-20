# Multi-tenant SaaS architecture

## Current milestone: tenant registry foundation

Migration `016_tenant_registry.sql` introduces:
- Tenant registry with lifecycle state, plan code and timezone
- Tenant membership with per-tenant admin/finance/teknisi roles
- Verified custom-domain registry
- Per-tenant integration records for GenieACS, MikroTik, WhatsApp, payment gateway, SMTP and RADIUS
- Immutable tenant-level security/audit events
- Existing users are associated with a default `FIFA Network` tenant

`modules/tenancy` provides membership lookup and a fail-closed tenant guard. The guard is intentionally not mounted globally yet.

## Tenant ownership milestone (migration 017)

Migration `017_tenant_data_ownership.sql` adds a `tenant_id` to all current ISP business tables and backfills existing rows to the default tenant through SQLite's `DEFAULT 1`. Database triggers reject unknown tenant IDs and cross-tenant parent/child relationships for subscriptions, invoices, payments, reversals, customer portal records, support tickets/messages, ODP assignments, expenses, inventory movements, WhatsApp logs, and GenieACS links.

The ownership keys are an intermediate safety milestone, **not complete isolation**. Existing routes and background jobs still use legacy unscoped queries. Some legacy globally-unique constraints/settings also remain global. New records default to the default tenant until every write path explicitly supplies a trusted tenant context. Do not create or activate a second tenant.

## Important safety boundary

This release does **not** claim production multi-tenancy. Existing business tables and route queries are still single-tenant/global. Do not create additional customer tenants or expose tenant switching until every business table has a tenant key, every read/write is scoped by the authenticated tenant, and cross-tenant isolation tests pass.

The next implementation phase must:
1. Scope every read/write route and query by authenticated tenant before enabling tenant creation or tenant switching (customers, plans, subscriptions, invoices, payments/reversals, portal accounts, tickets/messages, vouchers, ODP, expenses, inventory/movements, GenieACS links, MikroTik routers, WhatsApp logs/settings).
2. Replace transitional default-tenant inserts with explicit tenant context; keep existing data assigned to FIFA Network.
3. Rebuild SQLite tables where needed to add composite foreign keys and tenant-scoped unique constraints (the current triggers are an interim database guard).
4. Scope every route, report, scheduler, background job, and integration client by tenant.
5. Resolve tenant from authenticated membership, never from an untrusted request body/header alone.
6. Encrypt per-tenant integration secrets with the existing AES-256-GCM application key and never return ciphertext/plaintext to templates.
7. Add cross-tenant denial tests for list, detail, update, delete, invoice, payment, export, and background jobs.
8. Add platform-operator access separately from tenant-admin roles, with explicit audit events.

## Deployment model

A shared application/database is the initial SaaS target. SQLite remains suitable for single-tenant/self-hosted and small deployments, but a public multi-tenant SaaS with concurrent billing and background jobs should move to PostgreSQL before production scale. Each tenant integration must use private network access/VPN or authenticated TLS gateways; GenieACS NBI must never be exposed directly to the public internet.
