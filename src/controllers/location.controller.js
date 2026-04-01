const locationService = require('../services/location.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

// ==================== COUNTRIES (Public) ====================

const getCountries = asyncHandler(async (req, res) => {
  const result = await locationService.getCountries(req.query);
  logger.logRequest(req, 'Get all countries');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

// ==================== STATES (Public) ====================

const getStates = asyncHandler(async (req, res) => {
  const countryId = req.params.countryId || req.query.country_id;
  const result = await locationService.getStates(countryId, req.query);
  logger.logRequest(req, 'Get states');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

// ==================== DISTRICTS (Public) — was Cities ====================

/**
 * GET /api/v1/locations/districts          — all districts (supports ?state_id=, ?country_id=)
 * GET /api/v1/locations/districts/:stateId — filtered by state (path param)
 */
const getDistricts = asyncHandler(async (req, res) => {
  const stateId = req.params.stateId || req.query.state_id;
  const result = await locationService.getDistricts(stateId, req.query);
  logger.logRequest(req, 'Get districts');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

// ==================== CITIES (Public) — was Localities ====================

/**
 * GET /api/v1/locations/cities               — all cities (supports ?city_id=, ?state_id=, ?country_id=)
 * GET /api/v1/locations/cities/:districtId   — filtered by district (path param)
 */
const getCities = asyncHandler(async (req, res) => {
  const districtId = req.params.districtId || req.query.city_id;
  const result = await locationService.getCities(districtId, req.query);
  logger.logRequest(req, 'Get cities');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

// ==================== COUNTRIES (Admin) ====================

const createCountry = asyncHandler(async (req, res) => {
  const country = await locationService.createCountry(req.body, req.user.id);
  logger.logRequest(req, 'Create country');
  return ApiResponse.created(res, { country }, 'Country created successfully');
});

const updateCountry = asyncHandler(async (req, res) => {
  const country = await locationService.updateCountry(req.params.id, req.body, req.user.id);
  logger.logRequest(req, 'Update country');
  return ApiResponse.success(res, { country }, 'Country updated successfully');
});

const deleteCountry = asyncHandler(async (req, res) => {
  await locationService.deleteCountry(req.params.id, req.user.id);
  logger.logRequest(req, 'Delete country');
  return ApiResponse.success(res, null, 'Country deleted successfully');
});

// ==================== STATES (Admin) ====================

const createState = asyncHandler(async (req, res) => {
  const state = await locationService.createState(req.body, req.user.id);
  logger.logRequest(req, 'Create state');
  return ApiResponse.created(res, { state }, 'State created successfully');
});

const updateState = asyncHandler(async (req, res) => {
  const state = await locationService.updateState(req.params.id, req.body, req.user.id);
  logger.logRequest(req, 'Update state');
  return ApiResponse.success(res, { state }, 'State updated successfully');
});

const deleteState = asyncHandler(async (req, res) => {
  await locationService.deleteState(req.params.id, req.user.id);
  logger.logRequest(req, 'Delete state');
  return ApiResponse.success(res, null, 'State deleted successfully');
});

// ==================== DISTRICTS (Admin) ====================

const createDistrict = asyncHandler(async (req, res) => {
  const district = await locationService.createDistrict(req.body, req.user.id);
  logger.logRequest(req, 'Create district');
  return ApiResponse.created(res, { district }, 'District created successfully');
});

const updateDistrict = asyncHandler(async (req, res) => {
  const district = await locationService.updateDistrict(req.params.id, req.body, req.user.id);
  logger.logRequest(req, 'Update district');
  return ApiResponse.success(res, { district }, 'District updated successfully');
});

const deleteDistrict = asyncHandler(async (req, res) => {
  await locationService.deleteDistrict(req.params.id, req.user.id);
  logger.logRequest(req, 'Delete district');
  return ApiResponse.success(res, null, 'District deleted successfully');
});

// ==================== CITIES (Admin) ====================

const createCity = asyncHandler(async (req, res) => {
  const city = await locationService.createCity(req.body, req.user.id);
  logger.logRequest(req, 'Create city');
  return ApiResponse.created(res, { city }, 'City created successfully');
});

const updateCity = asyncHandler(async (req, res) => {
  const city = await locationService.updateCity(req.params.id, req.body, req.user.id);
  logger.logRequest(req, 'Update city');
  return ApiResponse.success(res, { city }, 'City updated successfully');
});

const deleteCity = asyncHandler(async (req, res) => {
  await locationService.deleteCity(req.params.id, req.user.id);
  logger.logRequest(req, 'Delete city');
  return ApiResponse.success(res, null, 'City deleted successfully');
});

// ==================== BULK IMPORT (Admin) ====================

const bulkImportCountries = asyncHandler(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return ApiResponse.error(res, 'rows array is required', 400);
  const result = await locationService.bulkImportCountries(rows, req.user.id);
  return ApiResponse.success(res, result, `Imported ${result.imported} countries`);
});

const bulkImportStates = asyncHandler(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return ApiResponse.error(res, 'rows array is required', 400);
  const result = await locationService.bulkImportStates(rows, req.user.id);
  return ApiResponse.success(res, result, `Imported ${result.imported} states (${result.skipped} skipped)`);
});

const bulkImportDistricts = asyncHandler(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return ApiResponse.error(res, 'rows array is required', 400);
  const result = await locationService.bulkImportDistricts(rows, req.user.id);
  return ApiResponse.success(res, result, `Imported ${result.imported} districts (${result.skipped} skipped)`);
});

const bulkImportCities = asyncHandler(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return ApiResponse.error(res, 'rows array is required', 400);
  const result = await locationService.bulkImportCities(rows, req.user.id);
  return ApiResponse.success(res, result, `Imported ${result.imported} cities (${result.skipped} skipped)`);
});

module.exports = {
  // Public
  getCountries, getStates, getDistricts, getCities,
  // Country Admin
  createCountry, updateCountry, deleteCountry,
  // State Admin
  createState, updateState, deleteState,
  // District Admin
  createDistrict, updateDistrict, deleteDistrict,
  // City Admin
  createCity, updateCity, deleteCity,
  // Bulk Import
  bulkImportCountries, bulkImportStates, bulkImportDistricts, bulkImportCities,
};
