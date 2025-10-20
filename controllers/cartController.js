const Cart = require('../models/Cart');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { body, param, validationResult } = require('express-validator');
const Product = require('../models/Product');

// Get cart
exports.getCart = catchAsync(async (req, res, next) => {
    const cart = await Cart.findOne({
        $or: [
            { user: req.user?._id },
            { guestEmail: req.query.guestEmail?.toLowerCase() }
        ],
        isConverted: false
    }).populate('items.product', 'name price images');

    if (!cart) {
        return next(new AppError('No active cart found', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
            cart
        }
    });
});

// Add item to cart
exports.addItem = [
    [
        body('product').isMongoId().withMessage('Invalid product ID'),
        body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
    ],
    
    catchAsync(async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return next(new AppError(errors.array()[0].msg, 400));
        }
        
        const product = await Product.findById(req.body.product);
        if (!product) {
            return next(new AppError('Product not found', 404));
        }
        
        let price = product.basePrice;
        const variants = [];
        let variantNames = [];
        
        if (req.body.variant) {
            const variantIds = Array.isArray(req.body.variant) ? req.body.variant : [req.body.variant];
            
            for (const variantId of variantIds) {
                const variant = product.variants.id(variantId);
                if (!variant) {
                    return next(new AppError(`Variant with ID ${variantId} not found`, 404));
                }
                variants.push({
                    _id: variant._id,
                    name: variant.name,
                    price: variant.price,
                    sku: variant.sku || ''
                });
                variantNames.push(variant.name);
            }
            price = variants[0].price;
        }

        let cart;
        
        if (req.user) {
            cart = await Cart.findOne({ user: req.user._id, isConverted: false });
            if (!cart) {
                cart = await Cart.create({ user: req.user._id });
            }
        } else if (req.body.guestEmail) {
            cart = await Cart.findOne({ 
                guestEmail: req.body.guestEmail.toLowerCase(), 
                isConverted: false 
            });
            
            if (!cart) {
                cart = await Cart.create({ 
                    isGuest: true, 
                    guestEmail: req.body.guestEmail.toLowerCase() 
                });
            }
        } else {
            return next(new AppError('User authentication or guest email is required', 400));
        }

        const cartItems = [];
        
        if (variants.length > 0) {
            for (const variant of variants) {
                cartItems.push({
                    product: req.body.product,
                    name: `${product.name} - ${variant.name}`,
                    quantity: req.body.quantity,
                    price: variant.price,
                    image: product.thumbnail || product.images?.[0] || '',
                    variant: {
                        _id: variant._id,
                        name: variant.name,
                        price: variant.price,
                        sku: variant.sku || ''
                    }
                });
            }
        } else {
            cartItems.push({
                product: req.body.product,
                name: product.name,
                quantity: req.body.quantity,
                price: price,
                image: product.thumbnail || product.images?.[0] || ''
            });
        }

        // Add all items to the cart
        for (const item of cartItems) {
            await cart.addItem(item);
        }

        res.status(200).json({
            status: 'success',
            data: {
                cart
            }
        });
    })
];

// Update item quantity
exports.updateItemQuantity = [
    [
        param('itemId').isMongoId().withMessage('Invalid item ID'),
        body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
    ],
    
    catchAsync(async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return next(new AppError(errors.array()[0].msg, 400));
        }

        const cart = await Cart.findOne({
            $or: [
                { user: req.user?._id },
                { guestEmail: req.body.guestEmail?.toLowerCase() }
            ],
            isConverted: false
        });

        if (!cart) {
            return next(new AppError('No active cart found', 404));
        }

        try {
            await cart.updateItemQuantity(req.params.itemId, req.body.quantity);

            const updatedCart = await Cart.findById(cart._id);
            
            res.status(200).json({
                status: 'success',
                data: {
                    cart: updatedCart
                }
            });
        } catch (error) {
            return next(error);
        }
    })
];


// Clear cart
exports.clearCart = catchAsync(async (req, res, next) => {
    const query = {
        isConverted: false
    };

    if (req.user?._id) {
        query.user = req.user._id;
    } else if (req.body.guestEmail) {
        query.guestEmail = req.body.guestEmail.toLowerCase();
    } else {
        return next(new AppError('User authentication or guest email is required', 400));
    }

    const cart = await Cart.findOneAndUpdate(
        query,
        { 
            $set: { 
                items: [], 
                subtotal: 0, 
                totalAmount: 0, 
                shippingCost: 0,
                discount: 0
            } 
        },
        { new: true, runValidators: true }
    );

    if (!cart) {
         return next(new AppError('No active cart found', 404));
    }

    await cart.calculateTotals();
    await cart.save();

    res.status(200).json({
        status: 'success',
        data: {
            cart
        }
    });
});

// Remove item from cart
exports.removeItem = [
    param('itemId').isMongoId().withMessage('Invalid item ID'),
    
    catchAsync(async (req, res, next) => {
        const cart = await Cart.findOne({
            $or: [
                { user: req.user?._id },
                { guestEmail: req.body.guestEmail?.toLowerCase() }
            ],
            isConverted: false
        });

        if (!cart) {
            return next(new AppError('No active cart found', 404));
        }

        await cart.removeItem(req.params.itemId);
        await cart.save();

        res.status(204).json({
            status: 'success',
            data: null
        });
    })
];


