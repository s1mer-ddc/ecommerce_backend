const express = require('express');
const cartController = require('../controllers/cartController');
const authController = require('../controllers/authController');

const router = express.Router();

// Protect all routes after this middleware
router.use(authController.protect);

// Routes for authenticated users and guests
router
  .route('/')
  .get(cartController.getCart)
  .post(cartController.addItem)
  .delete(cartController.clearCart);

// Routes for specific cart items
router
  .route('/items/:itemId')
  .patch(cartController.updateItemQuantity)
  .delete(cartController.removeItem);

module.exports = router;
