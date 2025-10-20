const express = require("express");
const orderController = require("./../controllers/orderController");
const authController = require("./../controllers/authController");

const router = express.Router();

// Public routes
router.post("/", orderController.createOrder);

// Protected routes (require authentication)
router.use(authController.protect);

router.post("/convert-cart", orderController.createOrderFromCart);

// router.post("/", orderController.createOrder);
// User's order routes
router.get("/", orderController.getAllOrders);
router.get("/:orderId", orderController.getMyOrderById);
router.patch("/:orderId/cancel", orderController.cancelMyOrder);
router.get("/:orderId/track", orderController.trackMyOrder);
router.get("/:orderId/invoice", orderController.generateInvoiceForOrder);
router.post("/:orderId/rate", orderController.rateOrderedProduct);

router.use(authController.restrictTo("admin"));

// Admin
router.patch("/:orderId/status", orderController.updateOrderStatus);
router.patch("/:orderId/markPaid", orderController.markOrderAsPaid);
router.patch("/:orderId/markDelivered", orderController.markOrderAsDelivered);
router.patch("/:orderId/markCancelled", orderController.markOrderAsCancelled);
router.patch("/:orderId/tracking", orderController.addTrackingInfo);
router.delete("/:orderId", orderController.deleteOrder);

// Analytics
router.get("/analytics/total-revenue", orderController.getTotalRevenue);
router.get(
  "/analytics/orders-count-by-status",
  orderController.getOrdersCountByStatus
);
router.get("/analytics/top-products", orderController.getTopSellingProducts);
router.get("/analytics/top-customers", orderController.getTopCustomers);
router.get(
  "/analytics/most-reviewed-products",
  orderController.getMostReviewedProducts
);
router.get(
  "/analytics/customer-lifetime-value",
  orderController.getCustomerLifetimeValue
);
router.get(
  "/analytics/avg-time-between-orders",
  orderController.getAvgTimeBetweenOrders
);
router.get(
  "/analytics/product-return-rate",
  orderController.getProductReturnRate
);


module.exports = router;
