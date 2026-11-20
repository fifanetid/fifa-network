"use strict";

const { db } = require("../../../database/db");

function requireCustomerPortal(req, res, next) {
  const portalSession = req.session.portalCustomer;
  if (!portalSession || !Number.isSafeInteger(Number(portalSession.id))) {
    return res.redirect("/customer/login");
  }

  const account = db.prepare(`
    SELECT a.id AS account_id, a.is_active AS account_active,
      c.id, c.customer_code, c.full_name, c.status, c.tenant_id
    FROM customer_portal_accounts a
    JOIN customers c ON c.id=a.customer_id
    WHERE a.customer_id=? AND a.tenant_id=c.tenant_id AND c.tenant_id=1
  `).get(Number(portalSession.id));

  if (!account || account.account_active !== 1 || account.status !== "active") {
    return req.session.destroy(() => {
      res.clearCookie("ffbilling.sid");
      res.redirect("/customer/login?error=1");
    });
  }

  req.customer = {
    id: account.id,
    tenantId: account.tenant_id,
    customerCode: account.customer_code,
    fullName: account.full_name
  };
  next();
}

module.exports = { requireCustomerPortal };
