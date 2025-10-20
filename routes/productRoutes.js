const express = require('express');
const productController = require('../controllers/productController');
const authController = require('../controllers/authController');
const upload = require('../utils/multer');

const router = express.Router();

// Multer upload configurations
const uploadProductImages = upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'images', maxCount: 10 }
]);

const uploadSingleImage = upload.single('image');

// ======================
// PUBLIC ROUTES
// ======================

router.get('/', productController.getAllProducts);

// ======================
// PROTECTED ROUTES
// ======================
router.use(authController.protect);

// Export products route (admin only)
router.get('/export', 
    authController.restrictTo('admin'),
    productController.exportProducts
);

// Get product by ID (must come after specific routes)
router.get('/:id', productController.getProductById);

// Analytics route (admin only)
router.get('/:id/analytics',
    authController.restrictTo('admin'),
    productController.getProductAnalytics
);

// Apply admin restriction to all routes below
router.use(authController.restrictTo('admin'));

// Create a new product
router.post(
    '/',
    uploadProductImages,
    productController.createProduct
);

router.get('/inactive/list', productController.getInactiveProducts);

router.patch('/bulk/status', productController.bulkUpdateStatus);

router.patch('/bulk/update', productController.bulkUpdateProducts);

// GET /:id is already defined in public routes
router.route('/:id')
    .patch(
        uploadProductImages,
        productController.updateProduct
    )
    .delete(productController.deleteProduct);

router.route('/:productId/variants')
    .get(productController.getProductVariants)
    .post(productController.createProductVariant);

router.route('/:productId/variants/:variantId')
    .get(productController.getProductVariant)
    .patch(productController.updateProductVariant)
    .delete(productController.deleteProductVariant);

router.patch('/:id/restore', productController.restoreProduct); // Restore soft-deleted
router.delete('/:id/permanent', productController.deleteProductPermanently); // Hard delete
router.patch('/:id/featured', productController.toggleFeaturedStatus); // Toggle featured
router.patch('/:id/stock', productController.updateProductStock); // Product images
router.post(
    '/:id/images',
    authController.protect,
    authController.restrictTo('admin'),
    uploadProductImages,
    productController.resizeProductImages,
    productController.uploadProductImages
);

router.delete(
    '/:id/images/:imageId',
    authController.protect,
    authController.restrictTo('admin'),
    productController.deleteProductImage
);

// Get price history for a product
router.get(
    '/:id/price-history',
    authController.protect,
    productController.getProductPriceHistory
);

module.exports = router;
