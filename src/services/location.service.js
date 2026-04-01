const { sequelize, Country, State, District, City } = require('../models');
const { Op } = require('sequelize');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

// ==================== COUNTRY ====================

const getCountries = async (query = {}) => {
  return baseService.getAll(Country, 'Country', query, {
    searchFields: ['name', 'code', 'nationality'],
    sortableFields: ['created_at', 'name', 'code', 'sort_order'],
    moduleSlug: 'locations',
  });
};

const getCountryById = async (id) => {
  return baseService.getById(Country, 'Country', id, {
    include: [{ model: State, as: 'states' }],
  });
};

const createCountry = async (data, userId = null) => {
  try {
    if (data.is_default) {
      await Country.update({ is_default: 0 }, { where: {} });
    }
    if (data.name) {
      const nameExists = await Country.findOne({ where: { name: data.name } });
      if (nameExists) throw ApiError.badRequest(`A country with the name "${data.name}" already exists.`);
    }
    // Check if sort_order exists
    if (data.sort_order) {
      const exists = await Country.findOne({ where: { sort_order: data.sort_order } });
      if (exists) throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken for countries.`);
    }
    const existing = await Country.findOne({ where: { code: data.code }, paranoid: false });
    if (existing) {
      if (existing.deletedAt) await existing.restore();
      return baseService.update(Country, 'Country', existing.id, data, userId);
    }
    return baseService.create(Country, 'Country', data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

const updateCountry = async (id, data, userId = null) => {
  if (data.is_default) {
    await Country.update({ is_default: 0 }, { where: { id: { [Op.ne]: id } } });
  }
  if (data.name) {
    const nameExists = await Country.findOne({ where: { id: { [Op.ne]: id }, name: data.name } });
    if (nameExists) throw ApiError.badRequest(`A country with the name "${data.name}" already exists.`);
  }
  if (data.sort_order) {
    const exists = await Country.findOne({
      where: {
        id: { [Op.ne]: id },
        sort_order: data.sort_order
      }
    });
    if (exists) throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken for countries.`);
  }
  return baseService.update(Country, 'Country', id, data, userId);
};

const deleteCountry = async (id, userId = null) => {
  return baseService.remove(Country, 'Country', id, userId, undefined, { uniqueFields: ['code', 'name'] });
};

// ==================== STATE ====================

const getStates = async (countryId, query = {}) => {
  const where = {};
  if (countryId) where.country_id = countryId;

  const include = [{ model: Country, as: 'country', attributes: ['id', 'name', 'code'] }];

  // has_districts=1 — only return states that have at least one district
  if (query.has_districts) {
    include.push({ model: District, as: 'districts', attributes: [], required: true });
  }

  return baseService.getAll(State, 'State', query, {
    searchFields: ['name', 'code', 'slug'],
    sortableFields: ['created_at', 'name', 'sort_order'],
    where,
    include,
    moduleSlug: 'locations',
  });
};

const getStateById = async (id) => {
  return baseService.getById(State, 'State', id, {
    include: [
      { model: Country, as: 'country' },
      { model: District, as: 'districts' },
    ],
  });
};

const createState = async (data, userId = null) => {
  try {
    const country = await Country.findByPk(data.country_id);
    if (!country) throw ApiError.badRequest('Invalid country');

    if (data.is_default) {
      await State.update({ is_default: 0 }, { where: {} });
    }
    if (data.name) {
      const nameExists = await State.findOne({
        where: { country_id: data.country_id, name: data.name }
      });
      if (nameExists) throw ApiError.badRequest(`A state with the name "${data.name}" already exists in this country.`);
    }
    // Check if sort_order exists in this country
    if (data.sort_order) {
      const exists = await State.findOne({
        where: { country_id: data.country_id, sort_order: data.sort_order }
      });
      if (exists) throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken in this country.`);
    }
    if (data.slug) {
      const existing = await State.findOne({ where: { slug: data.slug }, paranoid: false });
      if (existing) {
        if (existing.deletedAt) await existing.restore();
        return baseService.update(State, 'State', existing.id, data, userId);
      }
    }
    if (data.code) {
      const existingCode = await State.findOne({ where: { code: data.code, country_id: data.country_id }, paranoid: false });
      if (existingCode) {
        if (existingCode.deletedAt) await existingCode.restore();
        return baseService.update(State, 'State', existingCode.id, data, userId);
      }
    }
    return baseService.create(State, 'State', data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

const updateState = async (id, data, userId = null) => {
  if (data.is_default) {
    await State.update({ is_default: 0 }, { where: { id: { [Op.ne]: id } } });
  }
  const state = await State.findByPk(id);
  const countryId = data.country_id || state.country_id;

  if (data.name) {
    const nameExists = await State.findOne({
      where: { id: { [Op.ne]: id }, country_id: countryId, name: data.name }
    });
    if (nameExists) throw ApiError.badRequest(`A state with the name "${data.name}" already exists in this country.`);
  }
  if (data.sort_order) {
    const exists = await State.findOne({
      where: { id: { [Op.ne]: id }, country_id: countryId, sort_order: data.sort_order }
    });
    if (exists) throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken in this country.`);
  }
  return baseService.update(State, 'State', id, data, userId);
};

const deleteState = async (id, userId = null) => {
  return baseService.remove(State, 'State', id, userId, undefined, { uniqueFields: ['slug', 'code', 'name'] });
};

// ==================== DISTRICT (was City) ====================

/**
 * Get districts by state (stateId optional — omit for all districts)
 */
const getDistricts = async (stateId, query = {}) => {
  const where = {};
  if (stateId) where.state_id = stateId;

  // country_id filter — join to states
  const stateInclude = { model: State, as: 'state', attributes: ['id', 'name', 'country_id'] };
  if (query.country_id && !stateId) {
    stateInclude.where = { country_id: parseInt(query.country_id) };
    stateInclude.required = true;
  }

  const includes = [stateInclude];

  // has_cities=1 — only return districts that have at least one city
  if (query.has_cities) {
    includes.push({ model: City, as: 'cities', attributes: [], required: true });
  }

  return baseService.getAll(District, 'District', query, {
    searchFields: ['name', 'slug'],
    sortableFields: ['created_at', 'name', 'sort_order'],
    where,
    include: includes,
    moduleSlug: 'locations',
  });
};

const getDistrictById = async (id) => {
  return baseService.getById(District, 'District', id, {
    include: [
      { model: State, as: 'state' },
      { model: City, as: 'cities' },
    ],
  });
};

const createDistrict = async (data, userId = null) => {
  try {
    const state = await State.findByPk(data.state_id);
    if (!state) throw ApiError.badRequest('Invalid state');

    if (data.is_default) {
      await District.update({ is_default: 0 }, { where: {} });
    }
    if (data.name) {
      const nameExists = await District.findOne({
        where: { state_id: data.state_id, name: data.name }
      });
      if (nameExists) throw ApiError.badRequest(`A district with the name "${data.name}" already exists in this state.`);
    }
    // Check if sort_order exists in this state
    if (data.sort_order) {
      const exists = await District.findOne({
        where: { state_id: data.state_id, sort_order: data.sort_order }
      });
      if (exists) throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken in this state.`);
    }
    if (data.slug) {
      const existing = await District.findOne({ where: { slug: data.slug }, paranoid: false });
      if (existing) {
        if (existing.deletedAt) await existing.restore();
        return baseService.update(District, 'District', existing.id, data, userId);
      }
    }
    return baseService.create(District, 'District', data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

const updateDistrict = async (id, data, userId = null) => {
  if (data.is_default) {
    await District.update({ is_default: 0 }, { where: { id: { [Op.ne]: id } } });
  }
  const district = await District.findByPk(id);
  const stateId = data.state_id || district.state_id;

  if (data.name) {
    const nameExists = await District.findOne({
      where: { id: { [Op.ne]: id }, state_id: stateId, name: data.name }
    });
    if (nameExists) throw ApiError.badRequest(`A district with the name "${data.name}" already exists in this state.`);
  }
  if (data.sort_order) {
    const exists = await District.findOne({
      where: { id: { [Op.ne]: id }, state_id: stateId, sort_order: data.sort_order }
    });
    if (exists) throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken in this state.`);
  }
  return baseService.update(District, 'District', id, data, userId);
};

const deleteDistrict = async (id, userId = null) => {
  return baseService.remove(District, 'District', id, userId, undefined, { uniqueFields: ['slug', 'name'] });
};

// ==================== CITY (was Locality) ====================

/**
 * Get cities by district (districtId optional — omit to get all cities)
 */
const getCities = async (districtId, query = {}) => {
  const where = {};
  if (districtId) where.city_id = districtId;

  // state_id / country_id filter — resolve to district IDs via subquery
  if (!districtId) {
    if (query.state_id) {
      const districtIds = await District.findAll({
        where: { state_id: parseInt(query.state_id) },
        attributes: ['id'],
        raw: true,
      });
      where.city_id = { [Op.in]: districtIds.map((d) => d.id) };
    } else if (query.country_id) {
      const stateIds = await State.findAll({
        where: { country_id: parseInt(query.country_id) },
        attributes: ['id'],
        raw: true,
      });
      const districtIds = await District.findAll({
        where: { state_id: { [Op.in]: stateIds.map((s) => s.id) } },
        attributes: ['id'],
        raw: true,
      });
      where.city_id = { [Op.in]: districtIds.map((d) => d.id) };
    }
  }
  return baseService.getAll(City, 'City', query, {
    searchFields: ['name', 'pincode'],
    sortableFields: ['created_at', 'name', 'pincode'],
    where,
    moduleSlug: 'locations',
    include: [
      {
        model: District,
        as: 'district',
        attributes: ['id', 'name', 'state_id', 'country_id'],
        include: [
          {
            model: State,
            as: 'state',
            attributes: ['id', 'name', 'country_id'],
            include: [
              { model: Country, as: 'country', attributes: ['id', 'name'] },
            ],
          },
        ],
      },
    ],
  });
};

const getCityById = async (id) => {
  return baseService.getById(City, 'City', id, {
    include: [{ model: District, as: 'district' }],
  });
};

const createCity = async (data, userId = null) => {
  try {
    const district = await District.findByPk(data.city_id);
    if (!district) throw ApiError.badRequest('Invalid district');

    if (data.is_default) {
      await City.update({ is_default: 0 }, { where: { city_id: data.city_id } });
    }
    if (data.name) {
      const nameExists = await City.findOne({
        where: { city_id: data.city_id, name: data.name }
      });
      if (nameExists) throw ApiError.badRequest(`A city with the name "${data.name}" already exists in this district.`);
    }
    return baseService.create(City, 'City', data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

const updateCity = async (id, data, userId = null) => {
  const city = await City.findByPk(id);
  const districtId = data.city_id || city.city_id;

  if (data.is_default) {
    await City.update({ is_default: 0 }, { where: { city_id: districtId, id: { [Op.ne]: id } } });
  }
  if (data.name) {
    const nameExists = await City.findOne({
      where: { id: { [Op.ne]: id }, city_id: districtId, name: data.name }
    });
    if (nameExists) throw ApiError.badRequest(`A city with the name "${data.name}" already exists in this district.`);
  }
  return baseService.update(City, 'City', id, data, userId);
};

const deleteCity = async (id, userId = null) => {
  return baseService.remove(City, 'City', id, userId);
};

// ==================== BULK IMPORT ====================

/** Escape a value for safe inline SQL interpolation */
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function isActive(v) { return (v !== false && v !== 0 && v !== '0') ? 1 : 0; }
function isDefault(v) { return (v === true || v === 1 || v === '1') ? 1 : 0; }

/**
 * Run an INSERT IGNORE with FK/unique checks disabled and a transaction.
 * table   — MySQL table name
 * columns — ordered column names
 * rows    — array of value arrays (must match column order)
 */
async function rawBulkInsert(table, columns, rows) {
  if (!rows.length) return;
  const colList = columns.join(', ');
  const values = rows.map((r) => `(${r.map(esc).join(', ')})`).join(',\n');
  await sequelize.transaction(async (t) => {
    await sequelize.query('SET foreign_key_checks = 0', { transaction: t });
    await sequelize.query('SET unique_checks = 0', { transaction: t });
    await sequelize.query(
      `INSERT IGNORE INTO \`${table}\` (${colList}) VALUES ${values}`,
      { transaction: t },
    );
    await sequelize.query('SET foreign_key_checks = 1', { transaction: t });
    await sequelize.query('SET unique_checks = 1', { transaction: t });
  });
}

const bulkImportCountries = async (rows, userId = null) => {
  const records = rows.map((r) => [
    r.name,
    (r.code || '').toString().trim().toUpperCase().slice(0, 3),
    r.nationality || null,
    parseInt(r.sort_order) || 0,
    isActive(r.is_active),
    isDefault(r.is_default),
    userId,
    userId,
  ]);
  await rawBulkInsert('countries',
    ['name', 'code', 'nationality', 'sort_order', 'is_active', 'is_default', 'created_by', 'updated_by'],
    records,
  );
  return { imported: records.length };
};

const bulkImportStates = async (rows, userId = null) => {
  const countryCodes = [...new Set(rows.filter((r) => r.country_code).map((r) => r.country_code.toUpperCase()))];
  const countryMap = {};
  if (countryCodes.length) {
    const found = await Country.findAll({ where: { code: countryCodes }, attributes: ['id', 'code'] });
    found.forEach((c) => { countryMap[c.code.toUpperCase()] = c.id; });
  }

  const records = [];
  const skipped = [];
  const missingCodes = new Set();
  for (const r of rows) {
    let countryId = r.country_id ? parseInt(r.country_id) : null;
    if (!countryId && r.country_code) countryId = countryMap[r.country_code.toUpperCase()];
    if (!countryId) { skipped.push(r.name); if (r.country_code) missingCodes.add(r.country_code.toUpperCase()); continue; }
    records.push([r.name, r.code || null, r.slug || null, countryId, parseInt(r.sort_order) || 0, isActive(r.is_active), isDefault(r.is_default), userId, userId]);
  }
  await rawBulkInsert('states',
    ['name', 'code', 'slug', 'country_id', 'sort_order', 'is_active', 'is_default', 'created_by', 'updated_by'],
    records,
  );
  return { imported: records.length, skipped: skipped.length, missingCountryCodes: [...missingCodes] };
};

const bulkImportDistricts = async (rows, userId = null) => {
  const stateCodes = [...new Set(rows.filter((r) => r.state_code).map((r) => r.state_code.toUpperCase()))];
  const countryCodes = [...new Set(rows.filter((r) => r.country_code).map((r) => r.country_code.toUpperCase()))];

  // Resolve country_code → country_id
  const countryIdMap = {}; // 'IN' → 5
  if (countryCodes.length) {
    const found = await Country.findAll({ where: { code: countryCodes }, attributes: ['id', 'code'] });
    found.forEach((c) => { countryIdMap[c.code.toUpperCase()] = c.id; });
  }

  // Resolve state using state_code + country_id (avoids TN=Tamil Nadu vs TN=Tennessee)
  const stateMap = {}; // 'TN|IN' → { id, country_id }  and 'TN' → fallback
  if (stateCodes.length) {
    const whereClause = { code: stateCodes };
    if (Object.keys(countryIdMap).length) {
      whereClause.country_id = { [Op.in]: Object.values(countryIdMap) };
    }
    const found = await State.findAll({ where: whereClause, attributes: ['id', 'code', 'country_id'] });
    found.forEach((s) => {
      const countryCode = Object.keys(countryIdMap).find((k) => countryIdMap[k] === s.country_id) || '';
      stateMap[`${s.code.toUpperCase()}|${countryCode}`] = { id: s.id, country_id: s.country_id };
      // fallback: state_code only (for CSVs without country_code column)
      if (!stateMap[s.code.toUpperCase()]) stateMap[s.code.toUpperCase()] = { id: s.id, country_id: s.country_id };
    });
  }

  const records = [];
  const skipped = [];
  for (const r of rows) {
    let stateId = r.state_id ? parseInt(r.state_id) : null;
    let countryId = r.country_id ? parseInt(r.country_id) : null;
    if (!stateId && r.state_code) {
      const countryCode = (r.country_code || '').toUpperCase();
      const entry = stateMap[`${r.state_code.toUpperCase()}|${countryCode}`]
        || stateMap[r.state_code.toUpperCase()];
      if (entry) { stateId = entry.id; if (!countryId) countryId = entry.country_id; }
    }
    if (!stateId) { skipped.push(r.name); continue; }
    records.push([r.name, r.slug || null, stateId, countryId || null, parseInt(r.sort_order) || 0, isActive(r.is_active), isDefault(r.is_default), userId, userId]);
  }
  await rawBulkInsert('districts',
    ['name', 'slug', 'state_id', 'country_id', 'sort_order', 'is_active', 'is_default', 'created_by', 'updated_by'],
    records,
  );
  return { imported: records.length, skipped: skipped.length };
};

const bulkImportCities = async (rows, userId = null) => {
  const districtNames = [...new Set(rows.filter((r) => r.district_name).map((r) => r.district_name))];
  const districtMap = {};
  if (districtNames.length) {
    const found = await District.findAll({
      where: { name: { [Op.in]: districtNames } },
      attributes: ['id', 'name'],
      include: [{ model: State, as: 'state', attributes: ['id', 'code'] }],
    });
    found.forEach((d) => {
      const key = `${d.name.toLowerCase()}|${(d.state?.code || '').toUpperCase()}`;
      districtMap[key] = d.id;
      if (!districtMap[d.name.toLowerCase()]) districtMap[d.name.toLowerCase()] = d.id;
    });
  }

  const records = [];
  const skipped = [];
  for (const r of rows) {
    let districtId = r.district_id ? parseInt(r.district_id) : (r.city_id ? parseInt(r.city_id) : null);
    if (!districtId && r.district_name) {
      const key = `${r.district_name.toLowerCase()}|${(r.state_code || '').toUpperCase()}`;
      districtId = districtMap[key] || districtMap[r.district_name.toLowerCase()];
    }
    if (!districtId) { skipped.push(r.name); continue; }
    records.push([r.name, r.pincode || '', districtId, isActive(r.is_active), isDefault(r.is_default), userId, userId]);
  }
  await rawBulkInsert('cities',
    ['name', 'pincode', 'city_id', 'is_active', 'is_default', 'created_by', 'updated_by'],
    records,
  );
  return { imported: records.length, skipped: skipped.length };
};

module.exports = {
  // Country
  getCountries, getCountryById, createCountry, updateCountry, deleteCountry,
  // State
  getStates, getStateById, createState, updateState, deleteState,
  // District
  getDistricts, getDistrictById, createDistrict, updateDistrict, deleteDistrict,
  // City
  getCities, getCityById, createCity, updateCity, deleteCity,
  // Bulk import
  bulkImportCountries, bulkImportStates, bulkImportDistricts, bulkImportCities,
};
