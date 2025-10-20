const mongoose = require('mongoose');
const Product = require('./Product');

const orderItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.ObjectId,
        ref: 'Product',
        required: true,
    },
    name: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    price: {
        type: Number,
        required: true
    },
    image: String,
}, { _id: false });


const shippingAddressSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    country: { type: String, required: true },
    city: { type: String, required: true },
    street: { type: String, required: true },
    postalCode: { type: String, required: true },
    notes: String
}, { _id: false });

const paymentDetailsSchema = new mongoose.Schema({
    provider: String,
    paymentID: String,
    payerEmail: String,
    cardLast4: String,
    receiptUrl: String,
}, { _id: false });


const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    isGuest: {
        type: Boolean,
        default: false
    },
    guestEmail: {
        type: String,
        required: function () {
            return this.isGuest; // required only if guest
        },
    },
    guestName: {
        type: String,
        required: false,
    },
    orderItems: {
        type: [orderItemSchema],
        required: true,
        validate: [arr => arr.length > 0, 'Order must have at least one item.']
    },
    shippingAddress: {
        type: shippingAddressSchema,
        required: true
    },
    paymentDetails: {
        type: paymentDetailsSchema,
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'paypal', 'stripe', 'card'],
        required: true
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed'],
        default: 'pending'
    },
    status: {
        type: String,
        enum: ['processing', 'confirmed', 'shipped', 'delivered', 'cancelled'],
        default: 'processing'
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    isPaid: {
        type: Boolean,
        default: false
    },
    paidAt: Date,
    isDelivered: {
        type: Boolean,
        default: false
    },
    deliveredAt: Date,
    isCancelled: {
        type: Boolean,
        default: false
    },
    cancelledAt: Date,
    notes: String,
    trackingNumber: String,
    invoiceURL: String,
    refundedAt: Date,
    refundReason: String
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
