const fs = require("fs");
const path = require("path");
const Product = require("../models/Product");
const slugify = require("slugify");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Review = require("../models/Review");
const { generateInvoice } = require("../utils/invoiceGenerator");

// --------------- USER SIDE ORDER FEATURES --------------------------//

exports.createOrder = catchAsync(async (req, res, next) => {
  const { productId, quantity = 1 } = req.body;

  if (!productId) {
    return next(new AppError("You must select a product.", 400));
  }

  const product = await Product.findById(productId);
  //
  if (!product || !product.isActive) {
    return next(new AppError("Product not found or inactive.", 404));
  }

  // Validate quantity
  if (quantity < 1) {
    return next(new AppError("Quantity must be at least 1", 400));
  }

  // Check product stock
  if (quantity > product.stock) {
    return next(
      new AppError(`Only ${product.stock} items available in stock`, 400)
    );
  }

  const orderItem = {
    product: product._id,
    name: product.name,
    quantity: quantity,
    price: product.basePrice,
    image: product.images?.[0] || product.image || "",
  };

  const {
    fullName,
    phone,
    country,
    city,
    street,
    postalCode,
    notes,
    guestEmail,
  } = req.body;

  if (!fullName || !phone || !country || !city || !street || !postalCode) {
    return next(new AppError("Missing shipping address fields.", 400));
  }

  const shippingAddress = {
    fullName,
    phone,
    country,
    city,
    street,
    postalCode,
    notes: notes || "",
  };

  const {
    provider,
    paymentID,
    payerEmail,
    card,
    receiptUrl,
    guestName,
    paymentMethod,
  } = req.body;

  //!provider || !paymentID ||
  if (!paymentMethod) {
    return next(new AppError("Missing payment details.", 400));
  }

  const paymentDetails = {
    provider,
    paymentID,
    payerEmail,
    cardLast4: card?.last4 || card?.slice(-4) || "0000",
    receiptUrl: receiptUrl || "",
  };

  const orderData = {
    orderItems: [orderItem],
    shippingAddress,
    paymentDetails,
    paymentMethod,
    totalAmount: product.basePrice * quantity,
    status: "processing",
  };

  const isAuthenticated = req.user && req.user._id;

  if (isAuthenticated) {
    // For authenticated users
    orderData.user = req.user._id;
    orderData.isGuest = false;
  } else {
    // For guests
    if (!guestEmail && !payerEmail) {
      return next(new AppError("Email is required for guest checkout", 400));
    }
    orderData.isGuest = true;
    orderData.guestEmail = guestEmail || payerEmail;
    orderData.guestName = guestName || "Guest User";
  }

  const newOrder = await Order.create(orderData);

  // Prepare response
  const response = {
    status: "success",
    message: "Order created successfully.",
    order: {
      _id: newOrder._id,
      orderItems: newOrder.orderItems,
      shippingAddress: newOrder.shippingAddress,
      paymentMethod: newOrder.paymentMethod,
      totalAmount: newOrder.totalAmount,
      status: newOrder.status,
      createdAt: newOrder.createdAt,
    },
  };

  if (isAuthenticated) {
    response.order.user = newOrder.user;
  } else {
    response.order.isGuest = true;
    response.order.guestEmail = newOrder.guestEmail; // Include guest email in response
  }

  res.status(201).json(response);
});

exports.getAllOrders = catchAsync(async (req, res, next) => {
  const filter = {};

  // For non-admin users, restrict to their own orders
  if (!req.user || req.user.role !== "admin") {
    if (req.user) {
      filter.user = req.user._id; // Authenticated users see their own orders
    } else if (req.query.guestEmail) {
      filter.guestEmail = req.query.guestEmail.toLowerCase();
      filter.isGuest = true;
    } else {
      return next(
        new AppError("Guests must provide their email to view orders.", 400)
      );
    }
  } else {
    // Admin filters
    if (req.query.guestStatus === "true") {
      filter.isGuest = true;
    } else if (req.query.guestStatus === "false") {
      filter.isGuest = { $ne: true }; // Matches both false and undefined
    }

    if (req.query.paid === "true") {
      filter.isPaid = true;
    } else if (req.query.paid === "false") {
      filter.isPaid = { $ne: true };
    }

    // Filter by guest email if provided
    if (req.query.guestEmail) {
      filter.guestEmail = req.query.guestEmail.toLowerCase();
    }
  }

  if (req.query.status) {
    const allowedStatuses = [
      "processing",
      "confirmed",
      "shipped",
      "delivered",
      "cancelled",
    ];
    const status = req.query.status.toLowerCase();
    if (!allowedStatuses.includes(status)) {
      return next(new AppError(`Invalid status filter: ${status}`, 400));
    }
    filter.status = status;
  }

  if (req.query.createdAfter || req.query.createdBefore) {
    filter.createdAt = {};
    if (req.query.createdAfter) {
      const after = new Date(req.query.createdAfter);
      if (isNaN(after))
        return next(new AppError("Invalid createdAfter date.", 400));
      filter.createdAt.$gte = after;
    }
    if (req.query.createdBefore) {
      const before = new Date(req.query.createdBefore);
      if (isNaN(before))
        return next(new AppError("Invalid createdBefore date.", 400));
      filter.createdAt.$lte = before;
    }
  }

  const searchTerm = req.query.search?.toLowerCase().trim() || null;

  const sort = req.query.sort || "-createdAt";

  const page = Number(req.query.page) || 1;

  const limit = Number(req.query.limit) || 10;

  const skip = (page - 1) * limit;

  let orders = await Order.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate({
      path: "orderItems.product",
      select: "name image price",
    })
    .select("-__v");

  if (searchTerm) {
    orders = orders.filter((order) =>
      order.orderItems.some((item) =>
        item.product?.name?.toLowerCase().includes(searchTerm)
      )
    );
  }

  const totalOrders = await Order.countDocuments(filter);
  const totalPages = Math.ceil(totalOrders / limit);

  if (!orders.length) {
    return next(
      new AppError("No orders found for your filters or search.", 404)
    );
  }

  res.status(200).json({
    status: "success",
    results: orders.length,
    pagination: {
      totalOrders,
      totalPages,
      currentPage: page,
      limit,
    },
    filtersUsed: {
      status: req.query.status || "all",
      createdAfter: req.query.createdAfter || null,
      createdBefore: req.query.createdBefore || null,
      search: req.query.search || null,
      sort,
    },
    data: orders,
  });
});

exports.getMyOrderById = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const query = { _id: orderId };

  if (!orderId || orderId.length !== 24) {
    return next(new AppError(`Please provide a valid order ID.`, 400));
  }

  // For non-admin users, add access control
  if (!req.user || req.user.role !== "admin") {
    // For authenticated users
    if (req.user) {
      query.user = req.user._id;
    }
    // For guests - require guestEmail query parameter
    else if (req.query.guestEmail) {
      query.guestEmail = req.query.guestEmail.toLowerCase();
      query.isGuest = true;
    } else {
      return next(
        new AppError("Please provide your email to view this order.", 400)
      );
    }
  }

  const order = await Order.findOne(query)
    .populate({
      path: "orderItems.product",
      select: "name image price",
    })
    .select("-__v");

  if (!order) {
    return next(
      new AppError(`No order found with that ID for your account.`, 404)
    );
  }

  res.status(200).json({
    status: "success",
    data: order,
  });
});

exports.cancelMyOrder = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId || orderId.length !== 24) {
    return next(new AppError("Please provide a valid order ID.", 400));
  }

  const isAdmin = req.user?.role === "admin";
  const query = { _id: orderId };

  // For non-admin users, add access control
  if (!isAdmin) {
    // For authenticated users
    if (req.user) {
      query.user = req.user._id;
    }
    // For guests - require guestEmail in request body
    else if (req.body.guestEmail) {
      query.guestEmail = req.body.guestEmail.toLowerCase();
      query.isGuest = true;
    } else {
      return next(
        new AppError("Please provide your email to cancel this order.", 400)
      );
    }
  }

  const order = await Order.findOne(query)
    .populate({
      path: "orderItems.product",
      select: "name image price stock",
    })
    .select("-__v");

  if (!order) {
    return next(
      new AppError("No order found with this ID for your account.", 404)
    );
  }

  // Check order status
  if (order.status === "cancelled" || order.isCancelled) {
    return next(new AppError("This order has already been cancelled.", 400));
  }

  if (order.status === "delivered" || order.isDelivered) {
    return next(new AppError("Delivered orders cannot be cancelled.", 400));
  }

  if (order.status === "shipped" && order.paymentStatus === "paid") {
    return next(
      new AppError("Shipped and paid orders cannot be cancelled.", 400)
    );
  }

  // Update order status
  order.status = "cancelled";
  order.isCancelled = true;
  order.cancelledAt = Date.now();
  order.cancelledAt = Date.now();
  await order.save();

  res.status(200).json({
    status: "success",
    message: "Your order has been successfully cancelled.",
    data: {
      orderId: order._id,
      status: order.status,
      cancelledAt: order.cancelledAt,
      totalAmount: order.totalAmount,
      products: order.orderItems,
    },
  });
});

exports.trackMyOrder = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId || orderId.length !== 24) {
    return next(new AppError("Please provide a valid order ID.", 400));
  }

  const isAdmin = req.user?.role === "admin";
  const query = { _id: orderId };

  // For non-admin users, add access control
  if (!isAdmin) {
    // For authenticated users
    if (req.user) {
      query.user = req.user._id;
    }
    // For guests - require guestEmail in request body
    else if (req.body.guestEmail) {
      query.guestEmail = req.body.guestEmail.toLowerCase();
      query.isGuest = true;
    } else {
      return next(
        new AppError("Please provide your email to track this order.", 400)
      );
    }
  }

  const order = await Order.findOne(query)
    .populate({
      path: "orderItems.product",
      select: "name image price",
    })
    .select("-__v");

  if (!order) {
    return next(new AppError("No order found with this ID.", 404));
  }

  if (order.status === "cancelled" || order.isCancelled) {
    return next(
      new AppError("This order was cancelled and cannot be tracked.", 400)
    );
  }

  let estimatedDelivery = null;
  if (order.status === "shipped") {
    const shippedDate = order.updatedAt || order.createdAt;
    estimatedDelivery = new Date(shippedDate);
    estimatedDelivery.setDate(estimatedDelivery.getDate() + 3); // Assume 3 days
  }

  res.status(200).json({
    status: "success",
    message: "Tracking information retrieved successfully.",
    data: {
      orderId: order._id,
      status: order.status,
      isPaid: order.isPaid,
      isDelivered: order.isDelivered,
      paidAt: order.paidAt,
      deliveredAt: order.deliveredAt,
      trackingNumber: order.trackingNumber || "Not assigned yet",
      estimatedDelivery: estimatedDelivery || "Pending shipment",
      itemsCount: order.orderItems.length,
      totalAmount: order.totalAmount,
      products: order.orderItems.map((item) => ({
        name: item.product?.name,
        image: item.product?.image,
        quantity: item.quantity,
        price: item.price,
      })),
    },
  });
});

exports.generateInvoiceForOrder = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  let query = { _id: orderId };
  if (req.user) {
    query.user = req.user._id;
  } else if (req.body.guestEmail) {
    query.guestEmail = req.body.guestEmail.toLowerCase();
  }

  const order = await Order.findOne(query).populate("orderItems.product");

  if (!order || !order.isPaid) {
    return next(new AppError("Order not found or not paid.", 400));
  }

  // Ensure invoices directory exists
  const invoicesDir = path.join(__dirname, "../invoices");
  if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir, { recursive: true });
  }

  const invoicePath = path.join(invoicesDir, `invoice-${order._id}.pdf`);
  await generateInvoice(
    order,
    req.user || { name: order.guestName, email: order.guestEmail },
    invoicePath
  );

  order.invoiceURL = `/invoices/invoice-${order._id}.pdf`;
  await order.save();

  res.status(200).json({
    status: "success",
    message: "Invoice generated successfully.",
    data: { invoiceURL: order.invoiceURL },
  });
});

exports.rateOrderedProduct = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  const { productId, rating, comment = "" } = req.body;

  if (!productId || rating === undefined) {
    return next(new AppError("Product ID and rating are required.", 400));
  }

  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    return next(new AppError("Rating must be a number between 1 and 5.", 400));
  }

  if (productId.length !== 24 || orderId.length !== 24) {
    return next(new AppError("Invalid order or product ID format.", 400));
  }

  // Find the order
  let query = { _id: orderId, isDelivered: true };

  if (req.user && req.user.role !== "admin") {
    query.user = req.user._id;
  } else if (req.query.guestEmail) {
    query.guestEmail = req.query.guestEmail.toLowerCase();
  } else {
    return next(
      new AppError(
        "Authentication required or guest email must be provided.",
        401
      )
    );
  }

  const order = await Order.findOne(query).select(
    "orderItems guestName guestEmail"
  );
  if (!order) {
    return next(new AppError("Order not found or not yet delivered.", 404));
  }

  const orderedProduct = order.orderItems.find(
    (item) => item.product && item.product.toString() === productId
  );

  if (!orderedProduct) {
    return next(new AppError("This product was not part of your order.", 403));
  }

  // Check for existing review
  const existingReview = await Review.findOne({
    order: orderId,
    product: productId,
    $or: [
      { user: req.user?._id },
      { guestEmail: req.user ? null : req.body.guestEmail?.toLowerCase() },
    ],
  });

  if (existingReview) {
    return next(
      new AppError(
        "You have already reviewed this product from this order.",
        400
      )
    );
  }

  const reviewData = {
    product: productId,
    rating,
    comment: comment?.trim(),
    order: orderId,
  };

  if (req.user) {
    reviewData.user = req.user._id;
  } else {
    const guestEmail = req.query.guestEmail || req.body.guestEmail;
    if (!guestEmail) {
      return next(new AppError("Guest email is required.", 400));
    }
    reviewData.guestEmail = guestEmail.toLowerCase();
    reviewData.guestName = order.guestName || "Guest";
  }

  const review = await Review.create(reviewData);

  await Product.updateProductRating(productId);

  res.status(201).json({
    status: "success",
    message: "Thank you for your review!",
    data: {
      review: {
        id: review._id,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
      },
    },
  });
});

// --------------- ADMIN SIDE ORDER FEATURES -------------------//

exports.updateOrderStatus = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId || orderId.length !== 24) {
    return next(new AppError(`Please provide a valid order ID.`, 400));
  }

  let { newStatus, notes } = req.body;

  if (!newStatus) {
    return next(new AppError(`Please provide a new order status.`, 400));
  }

  newStatus = newStatus.toLowerCase();

  const allowedStatuses = [
    "processing",
    "confirmed",
    "shipped",
    "delivered",
    "cancelled",
  ];
  if (!allowedStatuses.includes(newStatus)) {
    return next(new AppError(`Invalid status: ${newStatus}`, 400));
  }

  const order = await Order.findById(orderId)
    .populate({
      path: "orderItems.product",
      select: "name image price",
    })
    .select("-__v");

  if (!order) {
    return next(new AppError("No order found with this ID.", 404));
  }

  if (
    ["confirmed", "shipped", "delivered"].includes(order.status) &&
    newStatus === "cancelled"
  ) {
    return next(
      new AppError(
        "You cannot cancel an order that is already confirmed or beyond.",
        400
      )
    );
  }

  if (order.status === "delivered") {
    return next(new AppError("Delivered orders cannot be updated.", 400));
  }

  if (order.status === newStatus) {
    return next(new AppError("Order already has this status.", 400));
  }

  order.status = newStatus;

  if (newStatus === "cancelled") {
    order.isCancelled = true;
    order.cancelledAt = Date.now();
  }

  if (newStatus === "delivered") {
    order.isDelivered = true;
    order.deliveredAt = Date.now();
  }

  if (notes) {
    order.notes = notes;
  }

  if (newStatus === "delivered" && order.paymentMethod === "cash") {
    order.isPaid = true;
    order.paidAt = Date.now();
    order.paymentStatus = "paid";
  }

  await order.save();

  res.status(200).json({
    status: "success",
    message: "Order status updated successfully.",
    data: {
      orderId: order._id,
      newStatus: order.status,
      isDelivered: order.isDelivered,
      isCancelled: order.isCancelled,
      totalAmount: order.totalAmount,
      paid: order.isPaid,
      products: order.orderItems,
      updatedAt: order.updatedAt,
    },
  });
});

exports.markOrderAsPaid = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId || orderId.length !== 24) {
    return next(new AppError("Please provide a valid order ID.", 400));
  }

  if (req.user.role !== "admin") {
    return next(new AppError("Only admins can mark orders as paid.", 403));
  }

  const order = await Order.findById(orderId)
    .populate({
      path: "orderItems.product",
      select: "name image price",
    })
    .select("-__v");

  if (!order) {
    return next(new AppError("No order found with this ID.", 404));
  }

  if (order.status === "cancelled" || order.isCancelled) {
    return next(
      new AppError("This order is cancelled and cannot be marked as paid.", 400)
    );
  }

  if (order.isPaid) {
    return next(new AppError("Order is already marked as paid.", 400));
  }

  order.isPaid = true;
  order.paidAt = Date.now();
  order.isDelivered = true;
  order.status = "delivered";
  order.paymentStatus = "paid";
  if (req.body.notes) order.notes = req.body.notes;

  await order.save();

  res.status(200).json({
    status: "success",
    message: "Order successfully marked as paid.",
    data: {
      orderId: order._id,
      isPaid: order.isPaid,
      paidAt: order.paidAt,
      status: order.status,
      totalAmount: order.totalAmount,
      products: order.orderItems,
    },
  });
});

exports.markOrderAsDelivered = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId || orderId.length !== 24) {
    return next(new AppError("Please provide a valid order ID.", 400));
  }

  if (req.user.role !== "admin") {
    return next(new AppError("Only admins can mark orders as delivered.", 403));
  }

  const order = await Order.findById(orderId)
    .populate("orderItems.product", "name image price")
    .select("-__v");

  if (!order) return next(new AppError("Order not found.", 404));

  if (order.status === "cancelled" || order.isCancelled) {
    return next(
      new AppError(
        "This order was cancelled and cannot be marked as delivered.",
        400
      )
    );
  }

  if (order.isDelivered) {
    return next(new AppError("Order is already marked as delivered.", 400));
  }

  order.status = "delivered";
  order.isDelivered = true;
  order.deliveredAt = Date.now();
  if (req.body.notes) order.notes = req.body.notes;

  if (order.paymentMethod === "cash" && !order.isPaid) {
    order.isPaid = true;
    order.paidAt = Date.now();
    order.paymentStatus = "paid";
  }

  await order.save();

  res.status(200).json({
    status: "success",
    message: "Order marked as delivered.",
    data: {
      orderId: order._id,
      deliveredAt: order.deliveredAt,
      isDelivered: order.isDelivered,
      isPaid: order.isPaid,
      paymentStatus: order.paymentStatus,
      products: order.orderItems,
    },
  });
});

exports.markOrderAsCancelled = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId || orderId.length !== 24) {
    return next(new AppError("Please provide a valid order ID.", 400));
  }

  if (req.user.role !== "admin") {
    return next(new AppError("Only admins can cancel orders.", 403));
  }

  const order = await Order.findById(orderId)
    .populate("orderItems.product", "name image price")
    .select("-__v");

  if (!order) return next(new AppError("Order not found.", 404));

  if (order.status === "delivered") {
    return next(new AppError("Delivered orders cannot be cancelled.", 400));
  }

  if (order.status === "cancelled" || order.isCancelled) {
    return next(new AppError("Order is already cancelled.", 400));
  }

  order.status = "cancelled";
  order.isCancelled = true;
  order.cancelledAt = Date.now();

  if (req.body.notes) order.notes = req.body.notes;

  await order.save();

  res.status(200).json({
    status: "success",
    message: "Order marked as cancelled.",
    data: {
      orderId: order._id,
      status: order.status,
      isCancelled: order.isCancelled,
      cancelledAt: order.cancelledAt,
      products: order.orderItems,
    },
  });
});

exports.addTrackingInfo = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { trackingNumber, shippingProvider } = req.body;

  if (!orderId || orderId.length !== 24) {
    return next(new AppError("Please provide a valid order ID.", 400));
  }

  if (!trackingNumber || !shippingProvider) {
    return next(
      new AppError("Tracking number and shipping provider are required.", 400)
    );
  }

  const order = await Order.findById(orderId);

  if (!order || order.isDeleted) {
    return next(new AppError("Order not found.", 404));
  }

  order.trackingNumber = trackingNumber;
  order.shippingProvider = shippingProvider;
  /* 
    add the logs late int the schema and all controllers
    order.logs.push({
        action: 'Tracking info updated',
        by: req.user._id,
        note: `${shippingProvider} - ${trackingNumber}`
    }); */

  await order.save();

  res.status(200).json({
    status: "success",
    message: "Tracking information updated successfully.",
    data: order,
  });
});

exports.deleteOrder = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId || orderId.length !== 24) {
    return next(new AppError("Please provide a valid order ID.", 400));
  }

  const order = await Order.findById(orderId);

  if (!order) {
    return next(new AppError("Order not found.", 404));
  }

  if (order.isDeleted) {
    return next(new AppError("Order already deleted.", 400));
  }

  order.isDeleted = true;
  order.deletedAt = Date.now();
  order.logs.push({
    action: "Order deleted",
    by: req.user._id,
    note: "Marked as deleted by admin",
  });

  await order.save();

  res.status(200).json({
    status: "success",
    message: "Order successfully marked as deleted.",
    data: { orderId: order._id },
  });
});

// ----------------------- ANALYTICS FEATURES -----------------------------------/

exports.getTotalRevenue = catchAsync(async (req, res, next) => {
  const { startDate, endDate, paymentMethod } = req.query;

  const filter = { isPaid: true };

  if (startDate || endDate) {
    filter.paidAt = {};
    if (startDate) {
      const from = new Date(startDate);
      if (isNaN(from)) return next(new AppError("Invalid startDate", 400));
      filter.paidAt.$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (isNaN(to)) return next(new AppError("Invalid endDate", 400));
      filter.paidAt.$lte = to;
    }
  }

  if (paymentMethod) {
    const allowed = ["cash", "paypal", "stripe", "card"];
    if (!allowed.includes(paymentMethod.toLowerCase())) {
      return next(new AppError("Invalid payment method", 400));
    }
    filter.paymentMethod = paymentMethod.toLowerCase();
  }

  const orders = await Order.find(filter).populate({
    path: "orderItems.product",
    select: "name image price",
  });

  if (!orders.length) {
    return next(new AppError("No paid orders found with these filters.", 404));
  }

  let totalRevenue = 0;
  let highestOrder = null;
  const revenueDetails = [];
  const monthlyStats = {}; // { '2024-07': totalRevenue }

  for (const order of orders) {
    if (!order.isPaid || order.totalAmount <= 0) continue;

    totalRevenue += order.totalAmount;

    const paidMonth = order.paidAt.toISOString().slice(0, 7); // YYYY-MM
    if (!monthlyStats[paidMonth]) monthlyStats[paidMonth] = 0;
    monthlyStats[paidMonth] += order.totalAmount;

    const detail = {
      orderId: order._id,
      user: order.user,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      paidAt: order.paidAt,
      itemCount: order.orderItems.length,
    };
    revenueDetails.push(detail);

    if (!highestOrder || order.totalAmount > highestOrder.totalAmount) {
      highestOrder = {
        orderId: order._id,
        user: order.user,
        totalAmount: order.totalAmount,
        paidAt: order.paidAt,
        itemCount: order.orderItems.length,
      };
    }
  }

  const averageOrderValue = Number(
    (totalRevenue / revenueDetails.length).toFixed(2)
  );

  const paymentSummary = {};
  for (const order of orders) {
    const method = order.paymentMethod;
    if (!paymentSummary[method]) {
      paymentSummary[method] = {
        count: 0,
        total: 0,
      };
    }
    paymentSummary[method].count++;
    paymentSummary[method].total += order.totalAmount;
  }

  res.status(200).json({
    status: "success",
    revenue: {
      totalRevenue,
      averageOrderValue,
      paidOrdersCount: revenueDetails.length,
      highestOrder,
      monthlyBreakdown: monthlyStats,
      byPaymentMethod: paymentSummary,
    },
    filtersUsed: {
      startDate: startDate || null,
      endDate: endDate || null,
      paymentMethod: paymentMethod || "all",
    },
    data: revenueDetails,
  });
});

exports.getOrdersCountByStatus = catchAsync(async (req, res, next) => {
  const allowedStatuses = [
    "processing",
    "confirmed",
    "shipped",
    "delivered",
    "cancelled",
  ];

  const statusCounts = await Order.aggregate([
    {
      $match: {
        status: { $in: allowedStatuses },
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        status: "$_id",
        count: 1,
      },
    },
  ]);

  const resultMap = {};
  for (const status of allowedStatuses) {
    const found = statusCounts.find((item) => item.status === status);
    resultMap[status] = found ? found.count : 0;
  }

  const total = Object.values(resultMap).reduce((acc, val) => acc + val, 0);

  res.status(200).json({
    status: "success",
    totalOrders: total,
    breakdown: resultMap,
  });
});

exports.getTopSellingProducts = catchAsync(async (req, res, next) => {
  const limit = Number(req.query.limit) || 10;

  const topProducts = await Order.aggregate([
    { $match: { isPaid: true } },
    { $unwind: "$orderItems" },
    {
      $group: {
        _id: "$orderItems.product",
        totalQuantity: { $sum: { $toInt: "$orderItems.quantity" } },
        totalRevenue: { $sum: "$orderItems.price" },
      },
    },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "productDetails",
      },
    },
    { $unwind: "$productDetails" },
    {
      $project: {
        productId: "$_id",
        name: "$productDetails.name",
        image: "$productDetails.image",
        totalQuantity: 1,
        totalRevenue: 1,
      },
    },
    { $sort: { totalQuantity: -1, totalRevenue: -1 } },
    { $limit: limit },
  ]);

  if (!topProducts.length) {
    return next(new AppError("No product sales found.", 404));
  }

  res.status(200).json({
    status: "success",
    results: topProducts.length,
    data: topProducts,
  });
});

exports.getTopCustomers = catchAsync(async (req, res, next) => {
  const limit = Number(req.query.limit) || 10;

  const topUsers = await Order.aggregate([
    { $match: { isPaid: true } },
    {
      $group: {
        _id: "$user",
        totalSpent: { $sum: "$totalAmount" },
        ordersCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "userDetails",
      },
    },
    { $unwind: "$userDetails" },
    {
      $project: {
        userId: "$_id",
        name: "$userDetails.name",
        email: "$userDetails.email",
        totalSpent: 1,
        ordersCount: 1,
      },
    },
    { $sort: { totalSpent: -1 } },
    { $limit: limit },
  ]);

  if (!topUsers.length) {
    return next(new AppError("No user spending data found.", 404));
  }

  res.status(200).json({
    status: "success",
    results: topUsers.length,
    data: topUsers,
  });
});

exports.getTopSellingProducts = catchAsync(async (req, res, next) => {
  const { limit = 10, startDate, endDate } = req.query;

  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }

  const topProducts = await Order.aggregate([
    { $match: { isPaid: true, ...dateFilter } },
    { $unwind: "$orderItems" },
    {
      $group: {
        _id: "$orderItems.product",
        totalSold: { $sum: "$orderItems.quantity" },
        totalRevenue: { $sum: "$orderItems.price" },
      },
    },
    { $sort: { totalSold: -1 } },
    { $limit: +limit },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    {
      $project: {
        _id: 0,
        productId: "$product._id",
        name: "$product.name",
        image: "$product.image",
        totalSold: 1,
        totalRevenue: 1,
        price: "$product.price",
        category: "$product.category",
      },
    },
  ]);

  res.status(200).json({
    status: "success",
    results: topProducts.length,
    data: topProducts,
  });
});

exports.getTopCustomers = catchAsync(async (req, res, next) => {
  const { limit = 10, startDate, endDate } = req.query;

  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }

  const topCustomers = await Order.aggregate([
    { $match: { isPaid: true, ...dateFilter } },
    {
      $group: {
        _id: "$user",
        totalSpent: { $sum: "$totalAmount" },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalSpent: -1 } },
    { $limit: +limit },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        _id: 0,
        userId: "$user._id",
        name: "$user.name",
        email: "$user.email",
        totalSpent: 1,
        orderCount: 1,
        role: "$user.role",
        createdAt: "$user.createdAt",
      },
    },
  ]);

  res.status(200).json({
    status: "success",
    results: topCustomers.length,
    data: topCustomers,
  });
});

exports.getMostReviewedProducts = catchAsync(async (req, res, next) => {
  const products = await Product.aggregate([
    {
      $project: {
        name: 1,
        totalReviews: { $size: "$reviews" },
        avgRating: { $avg: "$reviews.rating" },
      },
    },
    { $sort: { totalReviews: -1, avgRating: -1 } },
    { $limit: 10 },
  ]);

  res.status(200).json({
    status: "success",
    count: products.length,
    data: products,
  });
});

// Estimate: average order value × purchase frequency × customer lifespan
exports.getCustomerLifetimeValue = catchAsync(async (req, res, next) => {
  const customers = await User.find({ role: "user" }).lean();
  const orders = await Order.find({ isPaid: true }).populate("user");

  const clvData = customers.map((user) => {
    const userOrders = orders.filter(
      (o) => o.user?._id.toString() === user._id.toString()
    );
    const totalSpent = userOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const avgOrderValue = userOrders.length
      ? totalSpent / userOrders.length
      : 0;
    const purchaseFrequency = userOrders.length;
    const estimatedLifespan = 2;

    return {
      userId: user._id,
      name: user.name,
      email: user.email,
      clv: Number(
        (avgOrderValue * purchaseFrequency * estimatedLifespan).toFixed(2)
      ),
    };
  });

  clvData.sort((a, b) => b.clv - a.clv);

  res.status(200).json({
    status: "success",
    results: clvData.length,
    data: clvData,
  });
});

exports.getAvgTimeBetweenOrders = catchAsync(async (req, res, next) => {
  const orders = await Order.find({ isPaid: true })
    .sort("createdAt")
    .populate("user");

  const userMap = {};

  orders.forEach((order) => {
    const userId = order.user?._id.toString();
    if (!userMap[userId]) userMap[userId] = [];
    userMap[userId].push(new Date(order.createdAt));
  });

  const result = Object.entries(userMap)
    .map(([userId, dates]) => {
      if (dates.length < 2) return null;

      const diffs = [];
      for (let i = 1; i < dates.length; i++) {
        diffs.push((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
      }

      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;

      return {
        userId,
        avgDaysBetweenOrders: Number(avg.toFixed(1)),
        orderCount: dates.length,
      };
    })
    .filter(Boolean);

  res.status(200).json({ status: "success", data: result });
});

exports.getProductReturnRate = catchAsync(async (req, res, next) => {
  const totalSoldItems = await Order.aggregate([
    { $match: { isPaid: true } },
    { $unwind: "$orderItems" },
    {
      $group: {
        _id: "$orderItems.product",
        sold: { $sum: "$orderItems.quantity" },
      },
    },
  ]);

  const returnedItems = await Return.aggregate([
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        returned: { $sum: "$items.quantity" },
      },
    },
  ]);

  const returnMap = {};
  returnedItems.forEach((r) => (returnMap[r._id.toString()] = r.returned));

  const result = totalSoldItems.map((item) => {
    const returned = returnMap[item._id.toString()] || 0;
    const rate = (returned / item.sold) * 100;
    return {
      productId: item._id,
      sold: item.sold,
      returned,
      returnRate: Number(rate.toFixed(2)),
    };
  });

  res.status(200).json({ status: "success", data: result });
});


// --------------- CART TO ORDER CONVERSION --------------------------//
exports.createOrderFromCart = catchAsync(async (req, res, next) => {
  const { 
    paymentDetails = {},
    shippingAddress,
    paymentMethod 
  } = req.body;
  
  // Validate required fields
  if (!shippingAddress) {
    return next(new AppError('Shipping address is required', 400));
  }
  
  if (!paymentMethod) {
    return next(new AppError('Payment method is required', 400));
  }
  
  // Find active cart
  let cart;
  if (req.user && req.user._id) {
    cart = await Cart.findOne({ user: req.user._id, isConverted: false });
  } else if (req.body.guestEmail) {
    cart = await Cart.findOne({ 
      guestEmail: req.body.guestEmail.toLowerCase(), 
      isConverted: false 
    });
  } else {
    return next(new AppError('User authentication or guest email is required', 400));
  }

  if (!cart) {
    return next(new AppError('No active cart found', 404));
  }

  const order = await cart.convertToOrder({
    paymentDetails,
    shippingAddress,
    paymentMethod
  });

  res.status(201).json({
    status: 'success',
    data: {
      order
    }
  });
});
