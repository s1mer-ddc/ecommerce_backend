const mongoose = require('mongoose');
const Product = require('./Product');

const reviewSchema = new mongoose.Schema(
    {
        rating: {
            type: Number,
            required: [true, 'Please provide a rating'],
            min: [1, 'Rating must be at least 1'],
            max: [5, 'Rating cannot be more than 5']
        },
        comment: {
            type: String,
            trim: true,
            maxlength: [1000, 'Review cannot be longer than 1000 characters']
        },
        createdAt: {
            type: Date,
            default: Date.now
        },
        product: {
            type: mongoose.Schema.ObjectId,
            ref: 'Product',
            required: [true, 'Review must belong to a product']
        },
        order: {
            type: mongoose.Schema.ObjectId,
            ref: 'Order',
            required: [true, 'Review must be associated with an order']
        },
        user: {
            type: mongoose.Schema.ObjectId,
            ref: 'User',
            required: [
                function() { return !this.guestEmail; },
                'Either user or guest email is required'
            ]
        },
        guestName: {
            type: String,
            required: [
                function() { return !!this.guestEmail; },
                'Guest name is required for guest reviews'
            ]
        },
        guestEmail: {
            type: String,
            lowercase: true,
            trim: true,
            required: [
                function() { return !this.user; },
                'Either user or guest email is required'
            ],
            validate: {
                validator: function(email) {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    return emailRegex.test(email);
                },
                message: 'Please provide a valid email address'
            }
        }
    },
    {
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// Compound index to prevent duplicate reviews
reviewSchema.index(
    { product: 1, user: 1 },
    { unique: true, partialFilterExpression: { user: { $exists: true } } }
);

// Compound index for guest reviews
reviewSchema.index(
    { product: 1, guestEmail: 1, order: 1 },
    { unique: true, partialFilterExpression: { guestEmail: { $exists: true } } }
);

reviewSchema.pre(/^find/, function (next) {
    this.populate({
        path: 'user',
        select: 'name photo'
    });
    next();
});

reviewSchema.statics.calcAverageRatings = async function (productId) {
    const stats = await this.aggregate([
        {
            $match: { product: productId }
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
        await Product.findByIdAndUpdate(productId, {
            ratingsQuantity: stats[0].nRating,
            ratingsAverage: stats[0].avgRating
        });
    } else {
        await Product.findByIdAndUpdate(productId, {
            ratingsQuantity: 0,
            ratingsAverage: 4.5
        });
    }
};

reviewSchema.post('save', function () {
    this.constructor.calcAverageRatings(this.product);
});

reviewSchema.pre(/^findOneAnd/, async function (next) {
    this.r = await this.findOne();
    next();
});

reviewSchema.post(/^findOneAnd/, async function () {
    await this.r.constructor.calcAverageRatings(this.r.product);
});

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
