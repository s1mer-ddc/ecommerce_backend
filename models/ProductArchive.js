const mongoose = require('mongoose');

const productArchiveSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    deletedAt: {
        type: Date,
        default: Date.now
    },
    reason: {
        type: String,
        enum: ['manual-delete', 'inactive', 'out-of-stock', 'other'],
        default: 'manual-delete'
    },
    notes: String,
    restoredAt: Date,
    restoredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    restoreNotes: String
}, { timestamps: true });


productArchiveSchema.index({ product: 1, deletedAt: -1 });
productArchiveSchema.index({ deletedAt: -1 });
productArchiveSchema.index({ restoredAt: 1 });


productArchiveSchema.index(
    { product: 1, restoredAt: 1 },
    { unique: true, partialFilterExpression: { restoredAt: { $exists: false } } }
);

module.exports = mongoose.model('ProductArchive', productArchiveSchema);
