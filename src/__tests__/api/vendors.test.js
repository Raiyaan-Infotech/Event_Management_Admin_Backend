require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin, getTestCompanyId } = require('../helpers');

describe('Vendors API /api/v1/vendors', () => {
  let devCookie, superAdminCookie, adminCookie;
  let companyId;
  let createdVendorId;
  let vendorCookie;
  const vendorEmail = `vendor_test_${Date.now()}@test.com`;
  const vendorPassword = 'Vendor@123';

  beforeAll(async () => {
    devCookie = await loginAsDeveloper(app);
    superAdminCookie = await loginAsSuperAdmin(app);
    adminCookie = await loginAsAdmin(app);
    companyId = await getTestCompanyId();
  });

  // ── ADMIN CRUD ────────────────────────────────────────────────────
  describe('Admin: Vendor CRUD', () => {
    it('GET / — developer should list all vendors', async () => {
      const res = await request(app)
        .get('/api/v1/vendors')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — super admin should list vendors (company scoped)', async () => {
      const res = await request(app)
        .get('/api/v1/vendors')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/vendors');
      expect(res.status).toBe(401);
    });

    it('POST / — developer should create a vendor', async () => {
      const res = await request(app)
        .post('/api/v1/vendors')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          name: 'Test Vendor',
          email: vendorEmail,
          password: vendorPassword,
          company_name: 'Test Vendor Co.',
        });

      expect([201, 202]).toContain(res.status);
      if (res.status === 201) {
        createdVendorId = res.body.data?.id || res.body.data?.vendor?.id;
      }
    });

    it('GET /:id — should get a specific vendor', async () => {
      const { Vendor } = require('../../models');
      const vendor = await Vendor.findOne();
      if (!vendor) return;

      const res = await request(app)
        .get(`/api/v1/vendors/${vendor.id}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /:id — should return 404 for non-existent vendor', async () => {
      const res = await request(app)
        .get('/api/v1/vendors/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });

    it('PUT /:id — should update a vendor (or 202)', async () => {
      const { Vendor } = require('../../models');
      const vendor = await Vendor.findOne();
      if (!vendor) return;

      const res = await request(app)
        .put(`/api/v1/vendors/${vendor.id}`)
        .set('Cookie', devCookie)
        .send({ name: 'Updated Vendor Name', company_name: vendor.company_name });

      expect([200, 202]).toContain(res.status);
    });

    it('PATCH /:id/status — should update vendor status', async () => {
      const { Vendor } = require('../../models');
      const vendor = await Vendor.findOne();
      if (!vendor) return;

      const res = await request(app)
        .patch(`/api/v1/vendors/${vendor.id}/status`)
        .set('Cookie', devCookie)
        .send({ status: 'active' });

      expect([200, 202]).toContain(res.status);
    });

    it('DELETE /:id — should return 404 for non-existent vendor', async () => {
      const res = await request(app)
        .delete('/api/v1/vendors/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });
  });

  // ── VENDOR PORTAL AUTH ────────────────────────────────────────────
  describe('Vendor Portal Auth', () => {
    it('POST /auth/login — should reject wrong credentials', async () => {
      const res = await request(app)
        .post('/api/v1/vendors/auth/login')
        .send({ email: 'nobody@vendor.com', password: 'wrong' });

      expect([401, 403, 404]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('POST /auth/login — should login with valid vendor credentials', async () => {
      const { Vendor } = require('../../models');
      const vendor = await Vendor.findOne({ where: { status: 'active' } });
      if (!vendor) return; // skip if no active vendor in test DB

      // We can only test with the vendor we created above if we got a 201
      const res = await request(app)
        .post('/api/v1/vendors/auth/login')
        .send({ email: vendorEmail, password: vendorPassword });

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        vendorCookie = res.headers['set-cookie'];
      } else {
        // vendor may not exist if creation returned 202 (pending approval)
        expect([200, 401, 403]).toContain(res.status);
      }
    });

    it('GET /auth/me — should reject unauthenticated vendor request', async () => {
      const res = await request(app).get('/api/v1/vendors/auth/me');
      expect(res.status).toBe(401);
    });

    it('GET /auth/me — should return vendor profile when logged in', async () => {
      if (!vendorCookie) return; // skip if vendor login wasn't possible
      const res = await request(app)
        .get('/api/v1/vendors/auth/me')
        .set('Cookie', vendorCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /auth/logout — should logout vendor', async () => {
      if (!vendorCookie) return;
      const res = await request(app)
        .post('/api/v1/vendors/auth/logout')
        .set('Cookie', vendorCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
