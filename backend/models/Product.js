const mongoose = require('mongoose');
const slugify = require('slugify');

const variantSchema = new mongoose.Schema({
    name: {
        type: String,
        trim: true
    },
    sku: {
        type: String,
        unique: true,
        sparse: true,
        trim: true
    },
    color: String,
    size: String,
    stock: {
        type: Number,
        default: 0,
        min: 0
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    salePrice: Number,
    images: [String],
    barcode: String,
    weight: Number,
    dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: {
            type: String,
            enum: ['cm', 'in', 'm', 'mm'],
            default: 'cm'
        }
    },
    attributes: mongoose.Schema.Types.Mixed,
    stockHistory: [{
        previousStock: Number,
        newStock: Number,
        date: {
            type: Date,
            default: Date.now
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        reason: String
    }],
    isActive: {
        type: Boolean,
        default: true
    }
}, { _id: true, timestamps: true });

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Product name is required'],
        trim: true,
        maxlength: [200, 'Product name cannot be more than 200 characters'],
        index: true
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    sku: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
        uppercase: true
    },
    description: {
        type: String,
        maxlength: [10000, 'Description cannot be more than 10000 characters']
    },
    shortDescription: {
        type: String,
        maxlength: [500, 'Short description cannot be more than 500 characters']
    },
    brand: {
        type: String,
        trim: true,
        index: true
    },
    category: {
        type: String,
        required: [true, 'Category is required'],
        trim: true,
        index: true
    },
    subCategories: {
        type: [String],
        default: []
    },
    tags: {
        type: [String],
        default: [],
        index: true
    },
    thumbnail: String,
    images: {
        type: [String],
        default: []
    },
    basePrice: {
        type: Number,
        required: [true, 'Base price is required'],
        min: [0, 'Price cannot be negative'],
        set: val => Math.round(val * 100) / 100 // Round to 2 decimal places
    },
    salePrice: {
        type: Number,
        min: [0, 'Sale price cannot be negative'],
        validate: {
            validator: function(val) {
                return val <= this.basePrice;
            },
            message: 'Sale price must be less than or equal to base price'
        },
        set: val => val ? Math.round(val * 100) / 100 : null
    },
    costPrice: {
        type: Number,
        min: 0,
        set: val => val ? Math.round(val * 100) / 100 : null
    },
    discountPercentage: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    taxRate: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    stock: {
        type: Number,
        required: [true, 'Stock is required'],
        min: [0, 'Stock cannot be negative']
    },
    lowStockThreshold: {
        type: Number,
        default: 10,
        min: 0
    },
    weight: {
        value: Number,
        unit: {
            type: String,
            enum: ['g', 'kg', 'lb', 'oz'],
            default: 'g'
        }
    },
    dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: {
            type: String,
            enum: ['cm', 'in', 'm', 'mm'],
            default: 'cm'
        }
    },
    variants: {
        type: [variantSchema],
        default: []
    },
    attributes: mongoose.Schema.Types.Mixed,
    specifications: [{
        name: String,
        value: String,
        group: String
    }],
    isFeatured: {
        type: Boolean,
        default: false,
        index: true
    },
    featuredAt: {
        type: Date,
        index: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    isDigital: {
        type: Boolean,
        default: false
    },
    isDownloadable: {
        type: Boolean,
        default: false
    },
    downloadLimit: Number,
    downloadExpiryDays: Number,
    downloadFiles: [{
        name: String,
        file: String,
        type: String
    }],
    relatedProducts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    upSellProducts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    crossSellProducts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    ratingsAverage: {
        type: Number,
        min: [1, 'Rating must be at least 1'],
        max: [5, 'Rating cannot be more than 5'],
        set: val => Math.round(val * 10) / 10
    },
    ratingsQuantity: {
        type: Number,
        default: 0
    },
    viewCount: {
        type: Number,
        default: 0
    },
    soldQuantity: {
        type: Number,
        default: 0
    },
    metaTitle: String,
    metaDescription: String,
    metaKeywords: [String],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    deletedAt: Date,
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    status: {
        type: String,
        enum: ['draft', 'active', 'inactive', 'archived'],
        default: 'draft',
        index: true
    },
    externalId: String,
    customFields: mongoose.Schema.Types.Mixed
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Update product's average rating
productSchema.statics.updateProductRating = async function(productId) {
    const stats = await this.model('Review').aggregate([
        {
            $match: { product: new mongoose.Types.ObjectId(productId) }
        },
        {
            $group: {
                _id: '$product',
                nRating: { $sum: 1 },
                avgRating: { $avg: '$rating' }
            }
        }
    ]);

    if (stats.length > 0) {
        await this.findByIdAndUpdate(productId, {
            ratingsQuantity: stats[0].nRating,
            rating: parseFloat(stats[0].avgRating.toFixed(1))
        });
    } else {
        await this.findByIdAndUpdate(productId, {
            ratingsQuantity: 0,
            rating: 0
        });
    }
};

productSchema.index({ name: 'text', description: 'text' });
productSchema.index({ category: 1 });
productSchema.index({ rating: -1 });
productSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', productSchema);
