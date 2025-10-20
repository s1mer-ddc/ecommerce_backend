const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const Order = require('./Order');

const cartItemSchema = new mongoose.Schema(
    {
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: [true, 'Product is required'],
            index: true
        },
        name: {
            type: String,
            required: [true, 'Product name is required'],
            trim: true
        },
        quantity: {
            type: Number,
            required: [true, 'Quantity is required'],
            min: [1, 'Quantity must be at least 1'],
            max: [100, 'Maximum quantity per item is 100'],
            validate: {
                validator: Number.isInteger,
                message: 'Quantity must be an integer'
            }
        },
        price: {
            type: Number,
            required: [true, 'Price is required'],
            min: [0, 'Price cannot be negative']
        },
        image: {
            type: String,
            default: ''
        },
        variant: {
            name: {
                type: String,
                trim: true
            },
            sku: {
                type: String,
                trim: true,
                uppercase: true
            },
            color: {
                type: String,
                trim: true
            },
            size: {
                type: String,
                trim: true
            },
            price: {
                type: Number,
                min: 0
            },
            stock: {
                type: Number,
                min: 0
            },
            _id: false
        },
        addedAt: {
            type: Date,
            default: Date.now,
            index: true
        }
    },
    { _id: false, timestamps: true }
);

const shippingAddressSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    country: { type: String, required: true },
    city: { type: String, required: true },
    street: { type: String, required: true },
    postalCode: { type: String, required: true },
    notes: String
}, { _id: false });

/* TO add later : shippingAddress: shippingAddressSchema */
const cartSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            index: true,
            sparse: true
        },
        isGuest: {
            type: Boolean,
            default: false
        },
        guestEmail: {
            type: String,
            lowercase: true,
            trim: true,
            validate: {
                validator: function(email) {
                    if (this.isGuest && !email) return false;
                    if (email) {
                        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                        return re.test(email);
                    }
                    return true;
                },
                message: props => `Please provide a valid email address`
            },
            required: function() { return this.isGuest; }
        },
        items: {
            type: [cartItemSchema],
            default: [],
            validate: {
                validator: function(items) {
                    // Maximum 50 unique items in cart
                    return items.length <= 50;
                },
                message: 'Cart cannot contain more than 50 items'
            }
        },
        paymentMethod: {
            type: String,
            enum: {
                values: ['cash', 'paypal', 'stripe', 'card'],
                message: 'Payment method is either: cash, paypal, stripe, or card'
            },
            lowercase: true,
            trim: true
        },
        subtotal: {
            type: Number,
            default: 0,
            min: [0, 'Subtotal cannot be negative']
        },
        shippingCost: {
            type: Number,
            default: 0,
            min: [0, 'Shipping cost cannot be negative']
        },
        totalAmount: {
            type: Number,
            default: 0,
            min: [0, 'Total amount cannot be negative']
        },
        isConverted: {
            type: Boolean,
            default: false
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            index: { expires: '30d' }
        },
        lastUpdated: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

// Calculate cart totals and update the cart
cartSchema.methods.calculateTotals = async function() {
    try {
        let subtotal = 0;
        let itemCount = 0;
        
        this.items.forEach(item => {
            if (!item.price || !item.quantity) {
                throw new AppError('Invalid item in cart', 400);
            }
            subtotal += item.price * item.quantity;
            itemCount += item.quantity;
        });

        this.subtotal = parseFloat(subtotal.toFixed(2));
        this.totalAmount = parseFloat((this.subtotal + this.shippingCost).toFixed(2));
        this.lastUpdated = Date.now();
        
        return this.save();
    } catch (error) {
        throw new AppError(`Error calculating cart totals: ${error.message}`, 500);
    }
};

// check if the cart can be converted into an order
cartSchema.methods.canConvertToOrder = function(next) {
    if (this.isConverted) {
        return next(new AppError('Cart has already been converted to an order', 400));
    }

    if (!this.items || this.items.length === 0) {
        return next(new AppError('Cannot convert empty cart to order', 400));
    }

    if (!this.paymentMethod) {
        return next(new AppError('Payment method is required', 400));
    }

    for (const item of this.items) {
        if (!item.product || !item.quantity || !item.price) {
            return next(new AppError('Invalid items in cart', 400));
        }
    }

    return true;
};

// Add item to cart with validation
cartSchema.methods.addItem = async function(itemData) {
    if (this.isConverted) {
        throw new AppError('Cannot add items to a converted cart', 400);
    }

    const existingItemIndex = this.items.findIndex(item => 
        item.product.toString() === itemData.product.toString() &&
        JSON.stringify(item.variant) === JSON.stringify(itemData.variant || {})
    );

    if (existingItemIndex >= 0) {
        this.items[existingItemIndex].quantity += itemData.quantity;
    } else {
        this.items.push({
            ...itemData,
            addedAt: Date.now()
        });
    }

    return this.calculateTotals();
};

// Remove item from cart
cartSchema.methods.removeItem = async function(itemId) {
    if (this.isConverted) {
        throw new AppError('Cannot modify a converted cart', 400);
    }

    const targetId = itemId?.toString();
    const itemIndex = this.items.findIndex(item => {
        if (!item) return false;
        if (item._id?.toString() === targetId ||
            item.product?._id?.toString() === targetId ||
            item.product?.toString() === targetId ||
            (item.variant?._id && item.variant._id.toString() === targetId)) {
            return true;
        }
        return false;
    });
    
    if (itemIndex === -1) {
        return next(new AppError('Item not found in cart', 404));
    }

    this.items.splice(itemIndex, 1);
    return this.calculateTotals();
};

cartSchema.methods.updateItemQuantity = async function(itemId, newQuantity) {
    try {
        if (this.isConverted) {
            throw new AppError('Cannot modify a converted cart', 400);
        }
        const targetId = itemId?.toString();
        const item = this.items.find(item => {
            if (!item) return false;
            if (item.product?._id?.toString() === targetId || 
                item.product?.toString() === targetId ||
                (item.variant?._id && item.variant._id.toString() === targetId)) {
                return true;
            }
            return false;
        });
        
        if (!item) {
            throw new AppError('Item not found in cart', 404);
        }
        
        item.quantity = newQuantity;
        
        const result = await this.calculateTotals();
        return result;
    } catch (error) {
        throw error; 
    }
};

// Convert cart to order
cartSchema.methods.convertToOrder = async function({ paymentDetails = {}, shippingAddress, paymentMethod }) {
    if (this.isConverted) {
        throw new AppError('Cart has already been converted to an order', 400);
    }

    if (!this.items || this.items.length === 0) {
        throw new AppError('Cannot convert empty cart to order', 400);
    }

    if (!shippingAddress) {
        throw new AppError('Shipping address is required', 400);
    }
    
    if (!paymentMethod) {
        throw new AppError('Payment method is required', 400);
    }

    // Calculate totals if not already calculated
    if (!this.totalAmount || !this.subtotal) {
        await this.calculateTotals();
    }

    const orderItems = this.items.map(item => ({
        product: item.product,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        image: item.image,
        variant: item.variant
    }));

    const orderData = {
        orderItems,
        shippingAddress: {
            fullName: shippingAddress.fullName,
            phone: shippingAddress.phone,
            country: shippingAddress.country,
            city: shippingAddress.city,
            street: shippingAddress.street,
            postalCode: shippingAddress.postalCode,
            notes: shippingAddress.notes || ''
        },
        paymentMethod: paymentMethod,
        paymentDetails: {
            provider: paymentMethod,
            paymentID: paymentDetails.paymentID || `pay_${Date.now()}`,
            payerEmail: paymentDetails.payerEmail || (this.user ? this.user.email : this.guestEmail),
            cardLast4: paymentDetails.cardLast4 || '0000',
            receiptUrl: paymentDetails.receiptUrl || ''
        },
        totalAmount: this.totalAmount,
        itemsPrice: this.subtotal,
        shippingPrice: this.shippingCost || 0,
        taxPrice: this.taxAmount || 0,
        isPaid: paymentMethod !== 'cash',
        paidAt: paymentMethod !== 'cash' ? Date.now() : null,
        isDelivered: false,
        status: paymentMethod === 'cash' ? 'pending' : 'processing'
    };

    // Set user or guest information
    if (this.user) {
        orderData.user = this.user;
        orderData.isGuest = false;
    } else if (this.isGuest) {
        orderData.guestEmail = this.guestEmail;
        orderData.isGuest = true;
        orderData.guestName = this.guestName || 'Guest';
    }

    const order = await Order.create(orderData);

    this.isConverted = true;
    await this.save();
    return order;
};

cartSchema.index({ user: 1, isConverted: 1 });
cartSchema.index({ guestEmail: 1, isConverted: 1 });
cartSchema.index({ 'items.product': 1 });
cartSchema.index({ lastUpdated: 1 });

cartSchema.pre('save', function(next) {
    this.lastUpdated = Date.now();
    next();
});

module.exports = mongoose.model('Cart', cartSchema);