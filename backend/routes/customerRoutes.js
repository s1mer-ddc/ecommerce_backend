const express = require('express');
const customerController = require('./../controllers/customerController');
const authController = require('./../controllers/authController');

const router = express.Router();

// Public routes 
router.get('/guest/orders', customerController.getCustomerPurchaseHistory);

// Protected routes
router.use(authController.protect);

// Customer-specific routes 
router.get('/me/purchase-history', 
    customerController.getCustomerPurchaseHistory
);

// Admin-only routes
router.use(authController.restrictTo('admin'));

router.get('/analytics', customerController.getCustomerAnalytics);

router.get('/:customerId/purchase-history', 
    customerController.getCustomerPurchaseHistory
);

router.patch('/:customerId/loyalty', 
    customerController.updateLoyaltyStatus
);

router.get('/:customerId/lifetime-value', 
    customerController.getCustomerLifetimeValue
);

module.exports = router;
