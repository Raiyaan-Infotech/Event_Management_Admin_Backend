require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin } = require('../helpers');

describe('Content API (Companies, Ads, Blog, Announcements, FAQs)', () => {
  let devCookie, superAdminCookie, adminCookie;
  let companyId;

  beforeAll(async () => {
    devCookie = await loginAsDeveloper(app);
    superAdminCookie = await loginAsSuperAdmin(app);
    adminCookie = await loginAsAdmin(app);

    const { Company } = require('../../models');
    const company = await Company.findOne({ where: { name: 'Default Company' } });
    companyId = company.id;
  });

  // ── COMPANIES (Developer only) ───────────────────────────────────
  describe('Companies /api/v1/companies', () => {
    it('developer should list companies', async () => {
      const res = await request(app)
        .get('/api/v1/companies')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('developer should get company dashboard stats', async () => {
      const res = await request(app)
        .get('/api/v1/companies/dashboard')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('non-developer should be forbidden from listing companies', async () => {
      const res = await request(app)
        .get('/api/v1/companies')
        .set('Cookie', adminCookie);

      expect([403, 401]).toContain(res.status);
    });

    it('developer should create a company', async () => {
      const ts = Date.now();
      const res = await request(app)
        .post('/api/v1/companies')
        .set('Cookie', devCookie)
        .send({
          name: `Test Co ${ts}`,
          slug: `test-co-${ts}`,
          email: `testco_${ts}@test.com`,
          is_active: 1,
          admin_full_name: `Admin ${ts}`,
          admin_email: `admin_${ts}@test.com`,
          admin_password: 'TestPass@123',
        });

      expect([201, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('developer should get a company by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/companies/${companyId}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent company', async () => {
      const res = await request(app)
        .get('/api/v1/companies/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });
  });

  // ── ADS ──────────────────────────────────────────────────────────
  describe('Ads /api/v1/ads', () => {
    it('should list ads', async () => {
      const res = await request(app)
        .get('/api/v1/ads')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should create an ad (or trigger approval)', async () => {
      const res = await request(app)
        .post('/api/v1/ads')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          name: `Test Ad ${Date.now()}`,
          key: `test_ad_${Date.now()}`,
          title: `Test Ad Title`,
          type: 'banner',
          is_active: true,
          company_id: companyId,
        });

      expect([201, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent ad', async () => {
      const res = await request(app)
        .get('/api/v1/ads/999999')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(404);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/ads');
      expect(res.status).toBe(401);
    });
  });

  // ── BLOG CATEGORIES ──────────────────────────────────────────────
  describe('Blog Categories /api/v1/blog-categories', () => {
    it('should list blog categories', async () => {
      const res = await request(app)
        .get('/api/v1/blog-categories')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should create a blog category', async () => {
      const res = await request(app)
        .post('/api/v1/blog-categories')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          name: `Tech ${Date.now()}`,
          slug: `tech-${Date.now()}`,
          is_active: true,
          company_id: companyId,
        });

      expect([201, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });
  });

  // ── BLOG POSTS ───────────────────────────────────────────────────
  describe('Blog Posts /api/v1/blog-posts', () => {
    it('should list blog posts', async () => {
      const res = await request(app)
        .get('/api/v1/blog-posts')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/blog-posts');
      expect(res.status).toBe(401);
    });
  });

  // ── ANNOUNCEMENTS ────────────────────────────────────────────────
  describe('Announcements /api/v1/announcements', () => {
    it('should list announcements', async () => {
      const res = await request(app)
        .get('/api/v1/announcements')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should create an announcement', async () => {
      const res = await request(app)
        .post('/api/v1/announcements')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          name: `Announcement ${Date.now()}`,
          content: 'Test announcement content',
          is_active: true,
          company_id: companyId,
        });

      expect([201, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });
  });

  // ── FAQ CATEGORIES ───────────────────────────────────────────────
  describe('FAQ Categories /api/v1/faq-categories', () => {
    it('should list FAQ categories', async () => {
      const res = await request(app)
        .get('/api/v1/faq-categories')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should create a FAQ category', async () => {
      const res = await request(app)
        .post('/api/v1/faq-categories')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          name: `FAQ Cat ${Date.now()}`,
          is_active: true,
          company_id: companyId,
        });

      expect([201, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });
  });

  // ── FAQS ─────────────────────────────────────────────────────────
  describe('FAQs /api/v1/faqs', () => {
    it('should list FAQs', async () => {
      const res = await request(app)
        .get('/api/v1/faqs')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── TESTIMONIALS ─────────────────────────────────────────────────
  describe('Testimonials /api/v1/testimonials', () => {
    it('should list testimonials', async () => {
      const res = await request(app)
        .get('/api/v1/testimonials')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── PAGES ────────────────────────────────────────────────────────
  describe('Pages /api/v1/pages', () => {
    it('should list pages', async () => {
      const res = await request(app)
        .get('/api/v1/pages')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── HEALTH CHECK ─────────────────────────────────────────────────
  describe('GET /api/health', () => {
    it('should return server health', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── 404 handler ──────────────────────────────────────────────────
  describe('404 handler', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/v1/this-route-does-not-exist');
      expect(res.status).toBe(404);
    });
  });

});
