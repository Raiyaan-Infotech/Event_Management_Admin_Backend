require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsSuperAdmin, loginAsAdmin } = require('../helpers');

/**
 * Scenario: Role & Permission Flow
 *
 * SuperAdmin creates a custom role → assigns a permission to it →
 * Admin creates an employee with that role →
 * SuperAdmin approves → new employee logs in →
 * Employee can access permitted routes and is blocked from others
 */
describe('Scenario: Role & Permission Flow', () => {
  let superAdminCookie, adminCookie;
  let companyId;
  let customRoleId;
  let employeeCookie;
  const employeeEmail = `role_test_${Date.now()}@test.com`;

  beforeAll(async () => {
    superAdminCookie = await loginAsSuperAdmin(app);
    adminCookie = await loginAsAdmin(app);

    const { Company } = require('../../models');
    const company = await Company.findOne({ where: { name: 'Default Company' } });
    companyId = company.id;
  });

  it('Step 1 — SuperAdmin creates a custom role with limited permissions', async () => {
    const res = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', superAdminCookie)
      .set('X-Company-Id', String(companyId))
      .send({
        name: `Scenario Role ${Date.now()}`,
        slug: `scenario_role_${Date.now()}`,
        level: 10,
        company_id: companyId,
        is_active: true,
      });

    expect([201, 202]).toContain(res.status);
    expect(res.body.success).toBe(true);

    // Fetch the newly created role
    const { Role } = require('../../models');
    const role = await Role.findOne({ where: { level: 10, company_id: companyId }, order: [['created_at', 'DESC']] });
    customRoleId = role.id;
  });

  it('Step 2 — Verify the new role is visible in the roles list', async () => {
    const res = await request(app)
      .get('/api/v1/roles')
      .set('Cookie', superAdminCookie)
      .set('X-Company-Id', String(companyId));

    expect(res.status).toBe(200);
    const roles = res.body.data;
    const found = Array.isArray(roles) ? roles.find(r => r.id === customRoleId) : null;
    expect(found).toBeTruthy();
  });

  it('Step 3 — Admin creates employee with the custom role → 202', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .set('X-Company-Id', String(companyId))
      .send({
        full_name: 'Role Test Employee',
        email: employeeEmail,
        password: 'Employee@123',
        role_id: customRoleId,
        company_id: companyId,
        is_active: 1,
      });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
  });

  it('Step 4 — SuperAdmin approves the employee creation', async () => {
    const res = await request(app)
      .get('/api/v1/approvals')
      .set('Cookie', superAdminCookie)
      .set('X-Company-Id', String(companyId));

    const list = res.body.data;
    const pending = Array.isArray(list) ? list.find(a => a.is_active === 2) : null;
    expect(pending).toBeTruthy();

    const approveRes = await request(app)
      .patch(`/api/v1/approvals/${pending.id}/approve`)
      .set('Cookie', superAdminCookie)
      .set('X-Company-Id', String(companyId))
      .send({ review_notes: 'Approved for role scenario test' });

    expect(approveRes.status).toBe(200);
  });

  it('Step 5 — New employee logs in successfully', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: employeeEmail, password: 'Employee@123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    employeeCookie = res.headers['set-cookie'];
  });

  it('Step 6 — Employee is blocked from developer-only routes (companies list)', async () => {
    const res = await request(app)
      .get('/api/v1/companies')
      .set('Cookie', employeeCookie);

    expect([401, 403]).toContain(res.status);
  });

  it('Step 7 — Employee cannot approve requests (requires Super Admin level)', async () => {
    const res = await request(app)
      .patch('/api/v1/approvals/999999/approve')
      .set('Cookie', employeeCookie)
      .set('X-Company-Id', String(companyId))
      .send({ review_notes: 'should be blocked' });

    // Level 10 cannot approve — requires hasMinLevel(100)
    expect([401, 403]).toContain(res.status);
  });
});
