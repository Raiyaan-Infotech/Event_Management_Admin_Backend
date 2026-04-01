const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const { isAuthenticated, isDeveloper } = require('../middleware/auth');

// All company routes require developer role
router.use(isAuthenticated);
router.use(isDeveloper);

// Dashboard must be before /:id to avoid route collision
router.get('/dashboard', companyController.getDashboard);

router.get('/', companyController.getAll);
router.get('/:id', companyController.getById);
router.post('/', companyController.create);
router.put('/:id', companyController.update);
router.delete('/:id', companyController.delete);
router.patch('/:id/status', companyController.updateStatus);

module.exports = router;