"use strict";
const { db } = require("../../database/db");

function getUserTenants(userId) {
 const id=Number(userId);
 if(!Number.isSafeInteger(id)||id<1) return [];
 return db.prepare("SELECT t.id,t.name,t.slug,t.status,t.plan_code,t.timezone,m.role AS membership_role,m.status AS membership_status FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.status='active' AND t.status IN ('trial','active') ORDER BY t.name COLLATE NOCASE").all(id);
}
function getMembership(userId,tenantId) {
 const user=Number(userId),tenant=Number(tenantId);
 if(!Number.isSafeInteger(user)||user<1||!Number.isSafeInteger(tenant)||tenant<1) return null;
 return db.prepare("SELECT t.id AS tenant_id,t.name,t.slug,t.status,t.plan_code,t.timezone,m.role,m.status AS membership_status FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.tenant_id=? AND m.status='active' AND t.status IN ('trial','active')").get(user,tenant)||null;
}
function requireTenantMembership(req,res,next) {
 const requested=Number(req.session && req.session.tenantId);
 if(!Number.isSafeInteger(requested)||requested<1) return res.status(409).send("Tenant belum dipilih. Pemilihan tenant akan tersedia setelah seluruh modul mendukung isolasi tenant.");
 const membership=getMembership(req.session.user && req.session.user.id,requested);
 if(!membership) return res.status(403).send("Akses tenant ditolak.");
 req.tenant={id:membership.tenant_id,name:membership.name,slug:membership.slug,planCode:membership.plan_code,timezone:membership.timezone};
 req.tenantRole=membership.role;
 next();
}
module.exports={getUserTenants,getMembership,requireTenantMembership};
