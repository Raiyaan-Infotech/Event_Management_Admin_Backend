const express = require('express');
const router = express.Router();
const locationController = require('../controllers/location.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

// ── Public routes ──────────────────────────────────────────────────────────
router.get('/countries', locationController.getCountries);
router.get('/states', locationController.getStates);
router.get('/states/:countryId', locationController.getStates);

// Districts (was /cities)
router.get('/districts', locationController.getDistricts);
router.get('/districts/:stateId', locationController.getDistricts);

// Cities (was /localities) — no districtId = all cities
router.get('/cities', locationController.getCities);
router.get('/cities/:districtId', locationController.getCities);

// ── Protected routes ───────────────────────────────────────────────────────
router.use(isAuthenticated);
router.use(extractCompanyContext);

// Countries
router.post('/countries', hasPermission('locations.create'), checkApprovalRequired('locations', 'create', 'country'), locationController.createCountry);
router.put('/countries/:id', hasPermission('locations.edit'), checkApprovalRequired('locations', 'edit', 'country'), locationController.updateCountry);
router.delete('/countries/:id', hasPermission('locations.delete'), checkApprovalRequired('locations', 'delete', 'country'), locationController.deleteCountry);

// States
router.post('/states', hasPermission('locations.create'), checkApprovalRequired('locations', 'create', 'state'), locationController.createState);
router.put('/states/:id', hasPermission('locations.edit'), checkApprovalRequired('locations', 'edit', 'state'), locationController.updateState);
router.delete('/states/:id', hasPermission('locations.delete'), checkApprovalRequired('locations', 'delete', 'state'), locationController.deleteState);

// Districts
router.post('/districts', hasPermission('locations.create'), checkApprovalRequired('locations', 'create', 'district'), locationController.createDistrict);
router.put('/districts/:id', hasPermission('locations.edit'), checkApprovalRequired('locations', 'edit', 'district'), locationController.updateDistrict);
router.delete('/districts/:id', hasPermission('locations.delete'), checkApprovalRequired('locations', 'delete', 'district'), locationController.deleteDistrict);

// Cities
router.post('/cities', hasPermission('locations.create'), checkApprovalRequired('locations', 'create', 'city'), locationController.createCity);
router.put('/cities/:id', hasPermission('locations.edit'), checkApprovalRequired('locations', 'edit', 'city'), locationController.updateCity);
router.delete('/cities/:id', hasPermission('locations.delete'), checkApprovalRequired('locations', 'delete', 'city'), locationController.deleteCity);

// Bulk import (no approval — bulk seeding only)
router.post('/countries/bulk', hasPermission('locations.create'), locationController.bulkImportCountries);
router.post('/states/bulk', hasPermission('locations.create'), locationController.bulkImportStates);
router.post('/districts/bulk', hasPermission('locations.create'), locationController.bulkImportDistricts);
router.post('/cities/bulk', hasPermission('locations.create'), locationController.bulkImportCities);

module.exports = router;
