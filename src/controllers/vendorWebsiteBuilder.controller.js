const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const websiteService = require('../services/vendorWebsiteBuilder.service');

const getItems = (body) => {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
};

const getSchemaStatus = asyncHandler(async (req, res) => {
  const missingTables = await websiteService.getMissingTables();
  return ApiResponse.success(res, {
    schemaReady: missingTables.length === 0,
    missingTables,
  }, 'Website builder schema status retrieved');
});

const initializeWebsite = asyncHandler(async (req, res) => {
  const website = await websiteService.ensureWebsite(req.vendor, req.body || {});
  return ApiResponse.success(res, website, 'Vendor website initialized');
});

const getBuilderData = asyncHandler(async (req, res) => {
  const data = await websiteService.getBuilderPayload(req.vendor);
  return ApiResponse.success(res, data, 'Website builder data retrieved');
});

const getPreviewData = asyncHandler(async (req, res) => {
  const data = await websiteService.getPreviewPayload(req.vendor);
  return ApiResponse.success(res, data, 'Website preview data retrieved');
});

const getWebsite = asyncHandler(async (req, res) => {
  const website = await websiteService.getWebsite(req.vendor);
  return ApiResponse.success(res, website, 'Website settings retrieved');
});

const updateWebsite = asyncHandler(async (req, res) => {
  const website = await websiteService.updateWebsite(req.vendor, req.body || {});
  return ApiResponse.success(res, website, 'Website settings saved');
});

const getSingleton = (tableKey, message) => asyncHandler(async (req, res) => {
  const website = await websiteService.getWebsite(req.vendor);
  const data = website
    ? await websiteService.getSingleton(tableKey, req.vendor, website.id)
    : null;
  return ApiResponse.success(res, data, message || 'Section retrieved');
});

const saveSingleton = (tableKey, message) => asyncHandler(async (req, res) => {
  const data = await websiteService.upsertSingleton(tableKey, req.vendor, req.body || {});
  return ApiResponse.success(res, data, message || 'Section saved');
});

const listItems = (tableKey, message) => asyncHandler(async (req, res) => {
  const website = await websiteService.getWebsite(req.vendor);
  const data = website
    ? await websiteService.getList(tableKey, req.vendor, website.id)
    : [];
  return ApiResponse.success(res, data, message || 'Items retrieved');
});

const replaceItems = (tableKey, message) => asyncHandler(async (req, res) => {
  const data = await websiteService.replaceList(tableKey, req.vendor, getItems(req.body));
  return ApiResponse.success(res, data, message || 'Items saved');
});

const createItem = (tableKey, message, getExtra = null) => asyncHandler(async (req, res) => {
  const data = await websiteService.createListItem(
    tableKey,
    req.vendor,
    req.body || {},
    getExtra ? getExtra(req) : {},
  );
  return ApiResponse.created(res, data, message || 'Item created');
});

const updateItem = (tableKey, message) => asyncHandler(async (req, res) => {
  const data = await websiteService.updateListItem(tableKey, req.params.id, req.vendor, req.body || {});
  return ApiResponse.success(res, data, message || 'Item updated');
});

const deleteItem = (tableKey, message) => asyncHandler(async (req, res) => {
  const data = await websiteService.deleteListItem(tableKey, req.params.id, req.vendor);
  return ApiResponse.success(res, data, message || 'Item deleted');
});

const listSliderItems = asyncHandler(async (req, res) => {
  const website = await websiteService.getWebsite(req.vendor);
  const data = website
    ? await websiteService.getList(
        'sliderItems',
        req.vendor,
        website.id,
        'AND slider_id = :sliderId',
        { sliderId: req.params.sliderId },
      )
    : [];
  return ApiResponse.success(res, data, 'Slider items retrieved');
});

const replaceSliderItems = asyncHandler(async (req, res) => {
  const items = getItems(req.body).map((item) => ({
    ...item,
    slider_id: req.params.sliderId,
  }));
  const data = await websiteService.replaceList('sliderItems', req.vendor, items, {
    deleteWhereExtra: 'AND slider_id = :sliderId',
    deleteReplacements: { sliderId: req.params.sliderId },
    returnWhereExtra: 'AND slider_id = :sliderId',
    returnReplacements: { sliderId: req.params.sliderId },
  });
  return ApiResponse.success(res, data, 'Slider items saved');
});

const publishWebsite = asyncHandler(async (req, res) => {
  const data = await websiteService.publishWebsite(req.vendor);
  return ApiResponse.success(res, data, 'Website published');
});

module.exports = {
  getSchemaStatus,
  initializeWebsite,
  getBuilderData,
  getPreviewData,
  getWebsite,
  updateWebsite,
  getBasicInformation: getSingleton('basicInformation', 'Basic information retrieved'),
  saveBasicInformation: saveSingleton('basicInformation', 'Basic information saved'),
  getHeroSection: getSingleton('heroSection', 'Hero section retrieved'),
  saveHeroSection: saveSingleton('heroSection', 'Hero section saved'),
  getFooter: getSingleton('footer', 'Footer settings retrieved'),
  saveFooter: saveSingleton('footer', 'Footer settings saved'),
  getSeo: getSingleton('seo', 'SEO settings retrieved'),
  saveSeo: saveSingleton('seo', 'SEO settings saved'),
  listSocialLinks: listItems('socialLinks', 'Social links retrieved'),
  saveSocialLinks: replaceItems('socialLinks', 'Social links saved'),
  listPages: listItems('pages', 'Pages retrieved'),
  createPage: createItem('pages', 'Page created'),
  updatePage: updateItem('pages', 'Page updated'),
  deletePage: deleteItem('pages', 'Page deleted'),
  listMenuItems: listItems('menuItems', 'Menu items retrieved'),
  saveMenuItems: replaceItems('menuItems', 'Menu items saved'),
  listUiBlocks: listItems('uiBlocks', 'UI blocks retrieved'),
  saveUiBlocks: replaceItems('uiBlocks', 'UI blocks saved'),
  listSliders: listItems('sliders', 'Sliders retrieved'),
  createSlider: createItem('sliders', 'Slider created'),
  updateSlider: updateItem('sliders', 'Slider updated'),
  deleteSlider: deleteItem('sliders', 'Slider deleted'),
  listSliderItems,
  replaceSliderItems,
  createSliderItem: createItem('sliderItems', 'Slider item created', (req) => ({ slider_id: req.params.sliderId })),
  updateSliderItem: updateItem('sliderItems', 'Slider item updated'),
  deleteSliderItem: deleteItem('sliderItems', 'Slider item deleted'),
  listGalleryCategories: listItems('galleryCategories', 'Gallery categories retrieved'),
  createGalleryCategory: createItem('galleryCategories', 'Gallery category created'),
  updateGalleryCategory: updateItem('galleryCategories', 'Gallery category updated'),
  deleteGalleryCategory: deleteItem('galleryCategories', 'Gallery category deleted'),
  listGalleryItems: listItems('galleryItems', 'Gallery items retrieved'),
  createGalleryItem: createItem('galleryItems', 'Gallery item created'),
  updateGalleryItem: updateItem('galleryItems', 'Gallery item updated'),
  deleteGalleryItem: deleteItem('galleryItems', 'Gallery item deleted'),
  getContactSettings: getSingleton('contactSettings', 'Contact settings retrieved'),
  saveContactSettings: saveSingleton('contactSettings', 'Contact settings saved'),
  listContactSocialLinks: listItems('contactSocialLinks', 'Contact social links retrieved'),
  saveContactSocialLinks: replaceItems('contactSocialLinks', 'Contact social links saved'),
  listContactCategories: listItems('contactCategories', 'Contact categories retrieved'),
  createContactCategory: createItem('contactCategories', 'Contact category created'),
  updateContactCategory: updateItem('contactCategories', 'Contact category updated'),
  deleteContactCategory: deleteItem('contactCategories', 'Contact category deleted'),
  listContactMessages: listItems('contactMessages', 'Contact messages retrieved'),
  createContactMessage: createItem('contactMessages', 'Contact message created'),
  updateContactMessage: updateItem('contactMessages', 'Contact message updated'),
  deleteContactMessage: deleteItem('contactMessages', 'Contact message deleted'),
  listTestimonials: listItems('testimonials', 'Testimonials retrieved'),
  createTestimonial: createItem('testimonials', 'Testimonial created'),
  updateTestimonial: updateItem('testimonials', 'Testimonial updated'),
  deleteTestimonial: deleteItem('testimonials', 'Testimonial deleted'),
  listClients: listItems('clients', 'Clients retrieved'),
  createClient: createItem('clients', 'Client created'),
  updateClient: updateItem('clients', 'Client updated'),
  deleteClient: deleteItem('clients', 'Client deleted'),
  listSponsors: listItems('sponsors', 'Sponsors retrieved'),
  createSponsor: createItem('sponsors', 'Sponsor created'),
  updateSponsor: updateItem('sponsors', 'Sponsor updated'),
  deleteSponsor: deleteItem('sponsors', 'Sponsor deleted'),
  publishWebsite,
};
