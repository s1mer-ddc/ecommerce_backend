const express = require('express');
const themeController = require('../controllers/themeController');
const authController = require('../controllers/authController');

const router = express.Router();

// Protect all routes after this middleware
router.use(authController.protect);

// Routes for theme management
router
  .route('/')
  .post(
    authController.restrictTo('admin'),
    themeController.createTheme
  );

router
  .route('/store/:storeId')
  .get(themeController.getStoreThemes);

router
  .route('/store/:storeId/active')
  .get(themeController.getActiveTheme);

router
  .route('/:id')
  .patch(
    authController.restrictTo('admin'),
    themeController.updateTheme
  )
  .delete(
    authController.restrictTo('admin'),
    themeController.deleteTheme
  );

router
  .route('/:id/set-active')
  .patch(
    authController.restrictTo('admin'),
    themeController.setActiveTheme
  );

// Public route to get default theme (no authentication required)
router.get('/default-theme', themeController.getDefaultTheme);

module.exports = router;
