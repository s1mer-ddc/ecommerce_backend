const User = require('../models/User');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');

const checkUserAccess = catchAsync(async (req, res, next) => {
    if (!req.user && !req.query.guestEmail) {
        return next(new AppError('Authentication required or guest email must be provided', 401));
    }
    if (req.user && req.user.role === 'user' && req.params.customerId !== req.user.id) {
        return next(new AppError('You do not have permission to access this data', 403));
    }
    next();
});

exports.getCustomerAnalytics = catchAsync(async (req, res, next) => {
    const topSpenders = await Order.aggregate([
        {
            $match: { isPaid: true }
        },
        {
            $group: {
                _id: '$user',
                totalSpent: { $sum: '$totalPrice' },
                orderCount: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user'
            }
        },
        { $unwind: '$user' },
        {
            $project: {
                _id: 0,
                customerId: '$_id',
                name: '$user.name',
                email: '$user.email',
                totalSpent: 1,
                orderCount: 1,
                averageOrderValue: { $divide: ['$totalSpent', '$orderCount'] }
            }
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 10 }
    ]);

    // Get customer segmentation by purchase frequency
    const segmentation = await Order.aggregate([
        {
            $match: { isPaid: true }
        },
        {
            $group: {
                _id: '$user',
                orderCount: { $sum: 1 },
                totalSpent: { $sum: '$totalPrice' }
            }
        },
        {
            $bucket: {
                groupBy: '$orderCount',
                boundaries: [0, 1, 3, 5, 10, Infinity],
                default: 'Other',
                output: {
                    count: { $sum: 1 },
                    totalRevenue: { $sum: '$totalSpent' },
                    avgOrderValue: { $avg: { $divide: ['$totalSpent', '$orderCount'] } }
                }
            }
        }
    ]);

    // Get customer retention rate
    const retention = await Order.aggregate([
        {
            $group: {
                _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' }
                },
                newCustomers: {
                    $addToSet: '$user'
                },
                allCustomers: {
                    $push: '$user'
                }
            }
        },
        {
            $sort: { '_id.year': 1, '_id.month': 1 }
        },
        {
            $group: {
                _id: null,
                monthlyData: {
                    $push: {
                        month: { $concat: [
                            { $toString: '$_id.year' },
                            '-',
                            { $toString: '$_id.month' }
                        ]},
                        newCustomers: { $size: '$newCustomers' },
                        returningCustomers: {
                            $size: {
                                $setDifference: [
                                    '$allCustomers',
                                    '$newCustomers'
                                ]
                            }
                        }
                    }
                }
            }
        }
    ]);

    res.status(200).json({
        status: 'success',
        data: {
            topSpenders,
            segmentation,
            retention: retention[0]?.monthlyData || []
        }
    });
});

exports.getCustomerPurchaseHistory = catchAsync(async (req, res, next) => {
    let query = {};
    let customer = null;

    if (req.query.guestEmail) {
        query = { 
            guestEmail: req.query.guestEmail.toLowerCase(),
            isGuest: true
        };
        
        customer = {
            _id: 'guest',
            name: 'Guest User',
            email: req.query.guestEmail.toLowerCase(),
            isGuest: true
        };
    } 
    else if (req.user) {
        query = { user: req.user._id };
        customer = await User.findById(req.user._id);
        
        if (!customer) {
            return next(new AppError('No customer found with that ID', 404));
        }
    }

    const orders = await Order.find(query)
        .sort('-createdAt')
        .select('totalPrice status createdAt orderItems isGuest guestEmail');

    if (req.query.guestEmail) {
        const guestEmail = req.query.guestEmail.toLowerCase();
        const guestOrders = orders.filter(order => 
            order.isGuest && order.guestEmail === guestEmail
        );
        
        return res.status(200).json({
            status: 'success',
            results: guestOrders.length,
            data: {
                customer: {
                    id: 'guest',
                    name: 'Guest User',
                    email: guestEmail,
                    isGuest: true
                },
                orders: guestOrders
            }
        });
    }

    res.status(200).json({
        status: 'success',
        results: orders.length,
        data: {
            customer: {
                id: customer._id,
                name: customer.name,
                email: customer.email,
                joinDate: customer.createdAt,
                isGuest: false
            },
            orders
        }
    });
});

// Update customer loyalty status only for registered users
exports.updateLoyaltyStatus = catchAsync(async (req, res, next) => {
    const { customerId } = req.params;
    const { loyaltyTier, points, notes } = req.body;

    const customer = await User.findOne({ _id: customerId, isGuest: { $ne: true } });
    if (!customer) {
        return next(new AppError('No registered customer found with that ID', 404));
    }

    if (req.user.role !== 'admin' && customer._id.toString() !== req.user.id) {
        return next(new AppError('You do not have permission to update this customer\'s loyalty status', 403));
    }

    const updatedCustomer = await User.findByIdAndUpdate(
        customerId,
        {
            loyaltyTier,
            loyaltyPoints: points,
            $push: {
                loyaltyHistory: {
                    tier: loyaltyTier,
                    points: points,
                    updatedAt: Date.now(),
                    notes: notes || '',
                    updatedBy: req.user ? req.user.id : 'system'
                }
            }
        },
        {
            new: true,
            runValidators: true,
            select: 'name email loyaltyTier loyaltyPoints'
        }
    );

    res.status(200).json({
        status: 'success',
        data: {
            customer: updatedCustomer
        }
    });
});


exports.getCustomerLifetimeValue = catchAsync(async (req, res, next) => {
    const { customerId } = req.params;

    const result = await Order.aggregate([
        {
            $match: {
                user: new mongoose.Types.ObjectId(customerId),
                isPaid: true
            }
        },
        {
            $group: {
                _id: null,
                totalSpent: { $sum: '$totalPrice' },
                orderCount: { $sum: 1 },
                firstOrder: { $min: '$createdAt' },
                lastOrder: { $max: '$createdAt' },
                averageOrderValue: { $avg: '$totalPrice' }
            }
        },
        {
            $project: {
                _id: 0,
                totalSpent: 1,
                orderCount: 1,
                averageOrderValue: 1,
                customerSince: '$firstOrder',
                lastPurchase: '$lastOrder',
                daysAsCustomer: {
                    $divide: [
                        { $subtract: [new Date(), '$firstOrder'] },
                        1000 * 60 * 60 * 24 // Convert milliseconds to days
                    ]
                }
            }
        }
    ]);

    if (!result.length) {
        return next(new AppError('No orders found for this customer', 404));
    }

    res.status(200).json({
        status: 'success',
        data: result[0]
    });
});
