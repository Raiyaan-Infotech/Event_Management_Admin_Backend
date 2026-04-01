// Shared test helpers for login, cookie extraction, and request building
const request = require('supertest');

/**
 * Login and return the cookie string to attach to subsequent requests.
 * Uses the real POST /api/v1/auth/login endpoint.
 */
async function loginAs(app, email, password = '123456') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });

  if (res.status !== 200) {
    throw new Error(`loginAs(${email}) failed: ${res.status} — ${JSON.stringify(res.body)}`);
  }

  // Extract Set-Cookie header and return as a single string for .set('Cookie', ...)
  const cookies = res.headers['set-cookie'];
  if (!cookies || cookies.length === 0) {
    throw new Error(`loginAs(${email}): no cookies returned`);
  }

  return cookies.join('; ');
}

/**
 * Authenticate as developer (full system access, no company restriction)
 */
async function loginAsDeveloper(app) {
  return loginAs(app, 'developer@admin.com');
}

/**
 * Authenticate as super admin (company-scoped, level 100)
 */
async function loginAsSuperAdmin(app) {
  return loginAs(app, 'superadmin@admin.com');
}

/**
 * Authenticate as admin (company-scoped, level 50)
 */
async function loginAsAdmin(app) {
  return loginAs(app, 'admin@admin.com');
}

/**
 * Test company ID — fetched from DB dynamically
 */
async function getTestCompanyId() {
  const { Company } = require('../../models');
  const company = await Company.findOne({ where: { name: 'Default Company' } });
  return company.id;
}

module.exports = {
  loginAs,
  loginAsDeveloper,
  loginAsSuperAdmin,
  loginAsAdmin,
  getTestCompanyId,
};
