const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
    {
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        priceSnapshot: { type: Number }, // optional: price at add-to-cart time
        addedAt: {
            type: Date,
            default: Date.now
        },
    },
    { _id: false }
);

const cartSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }, // for logged-in
        guestEmail: {
            type: String,
            lowercase: true
        },               // for guests
        items: {
            type: [cartItemSchema],
            default: []
        },
        currency: {
            type: String,
            default: 'USD'
        },
        notes: String,
        isConverted: {
            type: Boolean,
            default: false
        }, // locked after conversion
    },
    { timestamps: true }
);

cartSchema.index({ user: 1, guestEmail: 1 }, { partialFilterExpression: { user: { $exists: true } } });
cartSchema.index({ guestEmail: 1 }, { partialFilterExpression: { guestEmail: { $exists: true } } });

module.exports = mongoose.model('Cart', cartSchema);
