const express = require('express');
const controller = require('../controllers/vendorWebsiteBuilder.controller');

const router = express.Router();

router.get('/schema-status', controller.getSchemaStatus);
router.post('/initialize', controller.initializeWebsite);
router.get('/builder-data', controller.getBuilderData);
router.get('/preview-payload', controller.getPreviewData);
router.get('/', controller.getWebsite);
router.put('/', controller.updateWebsite);

router.get('/basic-information', controller.getBasicInformation);
router.put('/basic-information', controller.saveBasicInformation);

router.get('/social-links', controller.listSocialLinks);
router.put('/social-links', controller.saveSocialLinks);

router.get('/pages', controller.listPages);
router.post('/pages', controller.createPage);
router.put('/pages/:id', controller.updatePage);
router.delete('/pages/:id', controller.deletePage);

router.get('/menu-items', controller.listMenuItems);
router.put('/menu-items', controller.saveMenuItems);

router.get('/ui-blocks', controller.listUiBlocks);
router.put('/ui-blocks', controller.saveUiBlocks);

router.get('/hero-section', controller.getHeroSection);
router.put('/hero-section', controller.saveHeroSection);

router.get('/sliders', controller.listSliders);
router.post('/sliders', controller.createSlider);
router.put('/sliders/:id', controller.updateSlider);
router.delete('/sliders/:id', controller.deleteSlider);
router.get('/sliders/:sliderId/items', controller.listSliderItems);
router.put('/sliders/:sliderId/items', controller.replaceSliderItems);
router.post('/sliders/:sliderId/items', controller.createSliderItem);
router.put('/slider-items/:id', controller.updateSliderItem);
router.delete('/slider-items/:id', controller.deleteSliderItem);

router.get('/gallery/categories', controller.listGalleryCategories);
router.post('/gallery/categories', controller.createGalleryCategory);
router.put('/gallery/categories/:id', controller.updateGalleryCategory);
router.delete('/gallery/categories/:id', controller.deleteGalleryCategory);
router.get('/gallery/items', controller.listGalleryItems);
router.post('/gallery/items', controller.createGalleryItem);
router.put('/gallery/items/:id', controller.updateGalleryItem);
router.delete('/gallery/items/:id', controller.deleteGalleryItem);

router.get('/contact/settings', controller.getContactSettings);
router.put('/contact/settings', controller.saveContactSettings);
router.get('/contact/social-links', controller.listContactSocialLinks);
router.put('/contact/social-links', controller.saveContactSocialLinks);
router.get('/contact/categories', controller.listContactCategories);
router.post('/contact/categories', controller.createContactCategory);
router.put('/contact/categories/:id', controller.updateContactCategory);
router.delete('/contact/categories/:id', controller.deleteContactCategory);
router.get('/contact/messages', controller.listContactMessages);
router.post('/contact/messages', controller.createContactMessage);
router.put('/contact/messages/:id', controller.updateContactMessage);
router.delete('/contact/messages/:id', controller.deleteContactMessage);

router.get('/testimonials', controller.listTestimonials);
router.post('/testimonials', controller.createTestimonial);
router.put('/testimonials/:id', controller.updateTestimonial);
router.delete('/testimonials/:id', controller.deleteTestimonial);

router.get('/portfolio/clients', controller.listClients);
router.post('/portfolio/clients', controller.createClient);
router.put('/portfolio/clients/:id', controller.updateClient);
router.delete('/portfolio/clients/:id', controller.deleteClient);

router.get('/portfolio/sponsors', controller.listSponsors);
router.post('/portfolio/sponsors', controller.createSponsor);
router.put('/portfolio/sponsors/:id', controller.updateSponsor);
router.delete('/portfolio/sponsors/:id', controller.deleteSponsor);

router.get('/footer', controller.getFooter);
router.put('/footer', controller.saveFooter);

router.get('/seo', controller.getSeo);
router.put('/seo', controller.saveSeo);

router.post('/publish', controller.publishWebsite);

module.exports = router;
