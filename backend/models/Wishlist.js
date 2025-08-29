const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        guestEmail: {
            type: String,
            lowercase: true
        },
        items: [
            {
                product: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Product',
                    required: true
                },
                addedAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ]
    },
    { timestamps: true }
);

wishlistSchema.index({ user: 1 });
wishlistSchema.index({ guestEmail: 1 });

module.exports = mongoose.model('Wishlist', wishlistSchema);
