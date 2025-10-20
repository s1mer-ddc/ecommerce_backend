const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },
    variantId: {
        type: String,
        index: true
    },
    previousPrice: {
        type: Number,
        required: true
    },
    newPrice: {
        type: Number,
        required: true
    },
    changeType: {
        type: String,
        enum: ['base', 'sale', 'discount', 'manual', 'bulk', 'import'],
        required: true
    },
    changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reason: String,
    metadata: {
        saleId: mongoose.Schema.Types.ObjectId,
        importBatch: String,
        notes: String
    }
}, { timestamps: true });

// Compound index for faster lookups
priceHistorySchema.index({ product: 1, createdAt: -1 });
priceHistorySchema.index({ 'metadata.saleId': 1 });

priceHistorySchema.virtual('priceDifference').get(function() {
    return this.newPrice - this.previousPrice;
});


priceHistorySchema.virtual('percentageChange').get(function() {
    if (this.previousPrice === 0) return 0;
    return ((this.newPrice - this.previousPrice) / this.previousPrice) * 100;
});

priceHistorySchema.pre('save', function(next) {
    if (this.newPrice < 0) {
        throw new Error('Price cannot be negative');
    }
    next();
});

// Static method to get price history for a product
priceHistorySchema.statics.getProductHistory = async function(productId, options = {}) {
    const { startDate, endDate, limit = 50, skip = 0 } = options;
    
    const query = { product: productId };
    
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    return this.find(query)
        .sort({ createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .populate('changedBy', 'name email')
        .lean();
};

module.exports = mongoose.model('ProductPriceHistory', priceHistorySchema);
