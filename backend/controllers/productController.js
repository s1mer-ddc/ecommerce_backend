const Product = require('../models/Product');
const ProductArchive = require('../models/ProductArchive');
const ProductPriceHistory = require('../models/ProductPriceHistory');
const Order = require('../models/Order');
const Review = require('../models/Review');
const User = require('../models/User');

const slugify = require('slugify');
const catchAsync = require('../utils/catchAsync');
const AppError = require('./../utils/AppError');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { Parser } = require('json2csv');

// Promisify file system methods
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);

// Multer configuration for file uploads
const multerStorage = multer.memoryStorage();

// File filter for image uploads
const multerFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image')) {
        cb(null, true);
    } else {
        cb(new AppError('Not an image! Please upload only images.', 400), false);
    }
};

const upload = multer({
    storage: multerStorage,
    fileFilter: multerFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

exports.uploadProductImages = upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'thumbnail', maxCount: 1 }
]);

// Handle product image uploads
exports.uploadProductImages = catchAsync(async (req, res, next) => {
    if (!req.files) return next();

    const product = await Product.findById(req.params.id);
    if (!product) {
        return next(new AppError('No product found with that ID', 404));
    }

    // 1) Process thumbnail if exists
    if (req.files.thumbnail) {
        const thumbnail = req.files.thumbnail[0];
        const thumbnailName = `product-${Date.now()}-thumbnail.jpeg`;
        
        await sharp(thumbnail.buffer)
            .resize(500, 500)
            .toFormat('jpeg')
            .jpeg({ quality: 90 })
            .toFile(`public/uploads/${thumbnailName}`);
        
        product.thumbnail = thumbnailName;
    }

    // 2) Process other images if they exist
    if (req.files.images) {
        const images = await Promise.all(
            req.files.images.map(async (file, i) => {
                const filename = `product-${Date.now()}-${i + 1}.jpeg`;
                
                await sharp(file.buffer)
                    .resize(2000, 1333)
                    .toFormat('jpeg')
                    .jpeg({ quality: 90 })
                    .toFile(`public/uploads/${filename}`);
                
                return filename;
            })
        );
        
        // Add new images to the existing ones
        product.images = [...(product.images || []), ...images];
    }

    await product.save();

    res.status(200).json({
        status: 'success',
        data: {
            product
        }
    });
});

// Image processing middleware
exports.resizeProductImages = catchAsync(async (req, res, next) => {
    if (!req.files.images) return next();

    // 1) Process thumbnail if exists
    if (req.files.thumbnail) {
        req.body.thumbnail = `product-${Date.now()}-thumbnail.jpeg`;
        await sharp(req.files.thumbnail[0].buffer)
            .resize(500, 500)
            .toFormat('jpeg')
            .jpeg({ quality: 90 })
            .toFile(`public/img/products/${req.body.thumbnail}`);
    }

    // 2) Process other images
    req.body.images = [];
    await Promise.all(
        req.files.images.map(async (file, i) => {
            const filename = `product-${Date.now()}-${i + 1}.jpeg`;
            await sharp(file.buffer)
                .resize(2000, 1333)
                .toFormat('jpeg')
                .jpeg({ quality: 90 })
                .toFile(`public/img/products/${filename}`);

            req.body.images.push(filename);
        })
    );

    next();
});

exports.createProduct = catchAsync(async (req, res, next) => {
    const { name, basePrice, description, category, brand, stock, variants = [], specifications = {}, tags = [] } = req.body;

    // 1) Basic validation
    if (!name || !basePrice) {
        return next(new AppError('Name and base price are required.', 400));
    }

    // 2) Generate slug and check for duplicates
    const slug = slugify(name, { lower: true, strict: true });
    const existing = await Product.findOne({ slug });
    if (existing) {
        return next(new AppError('Product with same name already exists.', 400));
    }

    // 4) Handle variants if provided
    let variantData = [];
    if (variants && variants.length > 0) {
        variantData = variants.map(variant => ({
            name: variant.name,
            sku: variant.sku || `${slug}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            price: variant.price || basePrice,
            stock: variant.stock || 0,
            attributes: variant.attributes || {}
        }));
    }
    
    // 5) Clean up category and brand
    const categoryName = typeof category === 'string' ? category.trim() : '';
    const brandName = typeof brand === 'string' ? brand.trim() : '';

    // 4) Create product
    const productData = {
        name: name.trim(),
        slug,
        basePrice: parseFloat(basePrice),
        description: description || '',
        shortDescription: req.body.shortDescription || '',
        category: categoryName,
        brand: brandName,
        stock: variantData.length > 0 ? 0 : parseInt(stock) || 0,
        variants: variantData,
        images: req.body.images || [],
        thumbnail: req.body.thumbnail || null,
        specifications,
        tags: Array.isArray(tags) ? tags : [tags],
        createdBy: req.user?.id
    };

    const product = await Product.create(productData);

    // 5) Create price history entry
    await ProductPriceHistory.create({
        product: product._id,
        previousPrice: 0, // Since it's a new product, previous price is 0
        newPrice: product.basePrice,
        changeType: 'base', // Using 'base' as the initial price type
        changedBy: req.user?.id,
        date: new Date(),
        notes: 'Initial product base price',
        metadata: {
            source: 'product_creation',
            user: req.user?.id
        }
    });

    res.status(201).json({
        status: 'success',
        data: {
            product
        }
    });
});

exports.getAllProducts = catchAsync(async (req, res, next) => {
    const {
        search,
        category,
        brand,
        min,
        max,
        inStock,
        isActive = true,
        isFeatured,
        tag,
        sort = '-createdAt',
        fields,
        page = 1,
        limit = 12
    } = req.query;

    // 1) Build the query
    const query = { isActive };

    // Text search (supports full-text search if text index is created)
    if (search) {
        query.$text = { $search: search };
    }

    // Filtering
    if (category) query.category = { $in: category.split(',') };
    if (brand) query.brand = { $in: brand.split(',') };
    if (tag) query.tags = { $in: tag.split(',') };
    if (isFeatured !== undefined) query.isFeatured = isFeatured === 'true';

    // Price range
    const priceFilter = {};
    if (min) priceFilter.$gte = parseFloat(min);
    if (max) priceFilter.$lte = parseFloat(max);
    if (Object.keys(priceFilter).length > 0) {
        query.$or = [
            { basePrice: priceFilter },
            { 'variants.price': priceFilter }
        ];
    }

    // Stock availability
    if (inStock === 'true') {
        query.$or = [
            { stock: { $gt: 0 } },
            { 'variants.stock': { $gt: 0 } }
        ];
    }

    // 2) Build the query
    const skip = (page - 1) * limit;
    const totalPromise = Product.countDocuments(query);

    // Field limiting
    let productsQuery = Product.find(query);

    // Sorting
    let sortBy = {};
    if (sort) {
        const sortFields = sort.split(',');
        sortFields.forEach(field => {
            const sortOrder = field.startsWith('-') ? -1 : 1;
            const fieldName = field.replace(/^[-+]/, '');
            sortBy[fieldName] = sortOrder;
        });
    } else {
        sortBy = { createdAt: -1 };
    }

    // Field limiting
    if (fields) {
        const fieldsList = fields.split(',').join(' ');
        productsQuery = productsQuery.select(fieldsList);
    }

    // Execute query with sorting and pagination
    const [total, products] = await Promise.all([
        totalPromise,
        productsQuery
            .sort(sortBy)
            .skip(skip)
            .limit(parseInt(limit))
    ]);

    // 3) Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // 4) Send response
    res.status(200).json({
        status: 'success',
        results: products.length,
        data: {
            products,
            pagination: {
                total,
                totalPages,
                currentPage: parseInt(page),
                hasNextPage,
                hasPreviousPage,
                nextPage: hasNextPage ? parseInt(page) + 1 : null,
                previousPage: hasPreviousPage ? parseInt(page) - 1 : null
            }
        }
    });
});


exports.getProductById = catchAsync(async (req, res, next) => {
    // 1) Get product first
    const product = await Product.findById(req.params.id);
    
    if (!product) {
        return next(new AppError('Product not found.', 404));
    }

    // 2) Get approved reviews separately
    const reviews = await Review.find({
        product: product._id,
        status: 'approved'
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('rating comment user createdAt')
    .populate({
        path: 'user',
        select: 'name photo'
    });
    
    // 3) Add reviews to product object
    const productWithReviews = product.toObject();
    productWithReviews.reviews = reviews;

    // 2) Check if product is active (unless admin)
    if (!productWithReviews.isActive && !req.user?.isAdmin) {
        return next(new AppError('Product not found.', 404));
    }

    // 3) Get related products from same category
    const relatedProducts = await Product.find({
        _id: { $ne: product._id },
        category: product.category,
        isActive: true
    })
    .limit(4)
    .select('name slug basePrice thumbnail ratingsAverage')
    .lean();
    
    // Format prices for display
    relatedProducts.forEach(p => {
        p.price = p.basePrice;
        delete p.basePrice;
    });

    // 4) Get price history (last 30 days)
    const priceHistory = await ProductPriceHistory.find({
        product: product._id,
        date: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    })
        .sort('date')
        .select('price date -_id')
        .lean();

    // 5) Increment view count (for analytics)
    product.views += 1;

    await product.save({ validateBeforeSave: false });

    // 6) Check if product is in user's wishlist
    let isInWishlist = false;
    if (req.user) {
        const user = await User.findById(req.user.id);
        isInWishlist = user.wishlist.includes(product._id);
    }

    // 7) Prepare response
    const response = {
        status: 'success',
        data: {
            product: {
                ...productWithReviews,
                isInWishlist
            },
            related: relatedProducts,
            priceHistory,
            meta: {
                totalReviews: product.ratingsQuantity || 0,
                averageRating: product.ratingsAverage || 0
            }
        }
    };

    res.status(200).json(response);
});


exports.updateProduct = catchAsync(async (req, res, next) => {
    // 1) Get the product
    const product = await Product.findById(req.params.id);
    if (!product) {
        return next(new AppError('Product not found.', 404));
    }

    // 2) Check for price change to track history
    if (req.body.basePrice && req.body.basePrice !== product.basePrice) {
        await ProductPriceHistory.create({
            product: product._id,
            previousPrice: product.basePrice,
            newPrice: req.body.basePrice,
            changeType: 'manual',
            changedBy: req.user?.id,
            reason: req.body.priceChangeReason || 'manual-update',
            metadata: {
                notes: 'Price updated manually',
                source: 'admin_update'
            }
        });
    }

    // 3) Handle slug update if name changed
    if (req.body.name && req.body.name !== product.name) {
        req.body.slug = slugify(req.body.name, { lower: true, strict: true });

        // Check for slug uniqueness
        const existingSlug = await Product.findOne({
            slug: req.body.slug,
            _id: { $ne: product._id }
        });

        if (existingSlug) {
            return next(new AppError('A product with this name already exists.', 400));
        }
    }

    // 4) Handle variants update
    if (req.body.variants) {
        // Update existing variants or add new ones
        req.body.variants = req.body.variants.map(variant => {
            if (variant._id) {
                // Update existing variant
                const existingVariant = product.variants.id(variant._id);
                if (existingVariant) {
                    if (variant.stock !== undefined && variant.stock !== existingVariant.stock) {
                        variant.stockHistory = variant.stockHistory || [];
                        variant.stockHistory.push({
                            previousStock: existingVariant.stock,
                            newStock: variant.stock,
                            date: new Date(),
                            updatedBy: req.user?.id,
                            reason: variant.stockChangeReason || 'manual-update'
                        });
                    }
                    return { ...existingVariant.toObject(), ...variant };
                }
            }
            // Add new variant
            return {
                ...variant,
                sku: variant.sku || `${product.slug}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                stockHistory: [{
                    previousStock: 0,
                    newStock: variant.stock || 0,
                    date: new Date(),
                    updatedBy: req.user?.id,
                    reason: 'variant-created'
                }]
            };
        });
    }

    // 5) Handle image updates
    if (req.body.images) {
        // Remove old images that are not in the new list
        const imagesToKeep = new Set(req.body.images);
        const imagesToDelete = product.images.filter(img => !imagesToKeep.has(img));

        // Delete unused images from storage
        await Promise.all(
            imagesToDelete.map(async (image) => {
                try {
                    await unlink(path.join(__dirname, `../public/img/products/${image}`));
                } catch (err) {
                    console.error(`Error deleting image ${image}:`, err);
                }
            })
        );
    }

    // 6) Update product
    const updatedProduct = await Product.findByIdAndUpdate(
        req.params.id,
        req.body,
        {
            new: true,
            runValidators: true
        }
    )
    .populate('category', 'name slug')
    .populate('brand', 'name logo');

    if (!updatedProduct) {
        return next(new AppError('No document found with that ID', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
            product: updatedProduct
        }
    });
});


exports.deleteProduct = catchAsync(async (req, res, next) => {
    // 1) Find the product to be deleted
    const product = await Product.findById(req.params.id);
    if (!product) {
        return next(new AppError('Product not found.', 404));
    }

    // 2) Create archive record before soft delete
    await ProductArchive.create({
        product: product._id,
        data: product.toObject(),
        deletedBy: req.user?._id,
        deletedAt: new Date(),
        reason: req.body.reason === 'out-of-stock' ? 'out-of-stock' : 
                req.body.reason === 'inactive' ? 'inactive' :
                req.body.reason === 'other' ? 'other' : 'manual-delete',
        notes: req.body.notes
    });

    // 3) Soft delete the product
    product.isActive = false;
    product.deletedAt = new Date();
    product.deletedBy = req.user?._id;
    await product.save({ validateBeforeSave: false });

    // 4) Remove from search index
    if (product.createSearchIndex) {
        await product.createSearchIndex();
    }

    res.status(200).json({
        status: 'success',
        data: null,
        message: 'Product has been soft-deleted.'
    });
});


exports.restoreProduct = catchAsync(async (req, res, next) => {
    // 1) Find the archived product
    const archivedProduct = await ProductArchive.findOne({
        product: req.params.id,
        restoredAt: { $exists: false }
    }).sort({ deletedAt: -1 });

    if (!archivedProduct) {
        return next(new AppError('No archived version of this product found.', 404));
    }

    // 2) Restore the product
    const product = await Product.findByIdAndUpdate(
        req.params.id,
        {
            ...archivedProduct.data,
            isActive: true,
            $unset: { deletedAt: '', deletedBy: '' },
            updatedAt: new Date(),
            updatedBy: req.user?.id
        },
        { new: true, runValidators: true }
    );

    if (!product) {
        return next(new AppError('Product not found in database.', 404));
    }

    // 3) Mark the archive as restored
    archivedProduct.restoredAt = new Date();
    archivedProduct.restoredBy = req.user?.id;
    archivedProduct.restoreNotes = req.body.notes;
    await archivedProduct.save();

    // 4) Update search index if the model has the method
    if (typeof Product.syncIndexes === 'function') {
        await Product.syncIndexes();
    }

    res.status(200).json({
        status: 'success',
        data: {
            product
        },
        message: 'Product has been restored successfully.'
    });
});

// @desc    Get price history for a product
// @route   GET /api/v1/products/:id/price-history
// @access  Private
const getProductPriceHistory = catchAsync(async (req, res, next) => {
    const history = await ProductPriceHistory.find({ product: req.params.id })
        .sort({ createdAt: -1 })
        .select('previousPrice newPrice changeType changedAt reason');

    res.status(200).json({
        status: 'success',
        results: history.length,
        data: {
            history
        }
    });
});

exports.getProductPriceHistory = getProductPriceHistory;

exports.deleteProductPermanently = catchAsync(async (req, res, next) => {
    // 1) Get product before deletion
    const product = await Product.findById(req.params.id);
    if (!product) {
        return next(new AppError('Product not found.', 404));
    }

    // 2) Delete associated images
    if (product.images && product.images.length > 0) {
        await Promise.all(
            product.images.map(async (image) => {
                const imagePath = path.join(__dirname, `../public/img/products/${image}`);
                try {
                    await unlink(imagePath);
                } catch (err) {
                    console.error(`Error deleting image ${image}:`, err);
                }
            })
        );
    }

    // 3) Delete thumbnail if exists
    if (product.thumbnail) {
        const thumbnailPath = path.join(__dirname, `../public/img/products/${product.thumbnail}`);
        try {
            await unlink(thumbnailPath);
        } catch (err) {
            console.error('Error deleting thumbnail:', err);
        }
    }

    // 4) Create archive record before permanent deletion
    await ProductArchive.create({
        product: product._id,
        data: product.toObject(),
        deletedBy: req.user?._id,
        deletedAt: new Date(),
        reason: 'manual-delete',
        notes: req.body.notes || 'Permanently deleted from system',
        metadata: {
            deletionType: 'permanent'
        }
    });

    // 5) Delete all related data
    await Promise.all([
        Product.findByIdAndDelete(req.params.id),
        ProductArchive.deleteMany({ product: req.params.id, 'metadata.deletionType': { $ne: 'permanent' } }),
        ProductPriceHistory.deleteMany({ product: req.params.id }),
        Review.deleteMany({ product: req.params.id }),
        // Remove from user wishlists
        User.updateMany(
            { wishlist: req.params.id },
            { $pull: { wishlist: req.params.id } }
        )
    ]);

    res.status(204).json({
        status: 'success',
        data: null,
        message: 'Product and all associated data have been permanently deleted.'
    });
});

// Toggle featured status for a product
exports.toggleFeaturedStatus = catchAsync(async (req, res, next) => {
    const product = await Product.findById(req.params.id);
    if (!product) {
        return next(new AppError('Product not found.', 404));
    }

    // Toggle featured status
    product.isFeatured = !product.isFeatured;
    product.featuredAt = product.isFeatured ? new Date() : null;

    // If making featured, ensure it's active
    if (product.isFeatured) {
        product.isActive = true;
    }

    await product.save();

    res.status(200).json({
        status: 'success',
        data: {
            isFeatured: product.isFeatured,
            featuredAt: product.featuredAt
        },
        message: `Product has been ${product.isFeatured ? 'marked as featured' : 'removed from featured'}.`
    });
});

// Get a specific variant for a product
exports.getProductVariant = catchAsync(async (req, res, next) => {
    const { productId, variantId } = req.params;

    // Find the product
    const product = await Product.findById(productId);
    if (!product) {
        return next(new AppError('Product not found', 404));
    }

    // Find the variant using Mongoose's id() helper
    const variant = product.variants.id(variantId);
    if (!variant) {
        return next(new AppError('Variant not found', 404));
    }

    // Get additional variant analytics if needed
    const variantAnalytics = {
        isLowStock: variant.stock <= (variant.lowStockThreshold || 5),
        stockHistory: variant.stockHistory || []
    };

    // Combine variant data with analytics
    const variantData = {
        ...variant.toObject(),
        analytics: variantAnalytics
    };

    res.status(200).json({
        status: 'success',
        data: {
            variant: variantData
        }
    });
});

// Get all variants for a product
exports.getProductVariants = catchAsync(async (req, res, next) => {
    const product = await Product.findById(req.params.productId).select('variants');
    
    if (!product) {
        return next(new AppError('No product found with that ID', 404));
    }

    res.status(200).json({
        status: 'success',
        results: product.variants.length,
        data: {
            variants: product.variants
        }
    });
});

// Delete a product variant
exports.deleteProductVariant = catchAsync(async (req, res, next) => {
    const { productId, variantId } = req.params;

    // 1) Find the product
    const product = await Product.findById(productId);
    if (!product) {
        return next(new AppError('No product found with that ID', 404));
    }

    // 2) Find the variant index
    const variantIndex = product.variants.findIndex(
        v => v._id.toString() === variantId
    );

    if (variantIndex === -1) {
        return next(new AppError('No variant found with that ID', 404));
    }

    // 3) Remove the variant
    product.variants.splice(variantIndex, 1);

    // 4) Save the product
    await product.save({ validateBeforeSave: false });

    res.status(204).json({
        status: 'success',
        data: null
    });
});

// Create a new variant for a product
exports.createProductVariant = catchAsync(async (req, res, next) => {
    const { name, price, stock, sku, attributes } = req.body;
    const { productId } = req.params;

    if (!name) {
        return next(new AppError('Variant name is required', 400));
    }

    const product = await Product.findById(productId);
    if (!product) {
        return next(new AppError('Product not found', 404));
    }

    const variantData = {
        name,
        price: price || product.basePrice,
        stock: stock || 0,
        sku: sku || `${product.slug}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        attributes: attributes || {},
        stockHistory: [{
            previousStock: 0,
            newStock: stock || 0,
            date: new Date(),
            updatedBy: req.user?.id,
            reason: 'variant-created'
        }]
    };

    product.variants.push(variantData);
    await product.save({ validateBeforeSave: false });

    const newVariant = product.variants[product.variants.length - 1];

    res.status(201).json({
        status: 'success',
        data: {
            variant: newVariant
        }
    });
});

// Update an existing variant
exports.updateProductVariant = catchAsync(async (req, res, next) => {
    const { productId, variantId } = req.params;
    const { name, price, stock, sku, attributes } = req.body;

    console.log('Updating variant:', { productId, variantId, body: req.body });

    // 1) Find the product
    const product = await Product.findById(productId);
    if (!product) {
        console.log('Product not found:', productId);
        return next(new AppError('Product not found', 404));
    }

    // 2) Find the variant - handle both string and ObjectId comparisons
    let variantIndex = -1;
    let variant = null;
    
    for (let i = 0; i < product.variants.length; i++) {
        const v = product.variants[i];
        if (v._id && (v._id.toString() === variantId || v._id.equals(variantId))) {
            variantIndex = i;
            variant = v;
            break;
        }
    }

    if (variantIndex === -1) {
        console.log('Variant not found. Available variant IDs:', 
            product.variants.map(v => ({
                id: v._id,
                idString: v._id ? v._id.toString() : 'null',
                name: v.name
            }))
        );
        return next(new AppError(`Variant not found with ID: ${variantId}`, 404));
    }

    // 3) Prepare updates
    const updates = {};
    if (name) updates.name = name;
    if (price !== undefined) updates.price = price;
    if (sku) updates.sku = sku;
    if (attributes) {
        updates.attributes = { ...variant.attributes, ...attributes };
    }

    // 4) Handle stock update with history
    if (stock !== undefined && stock !== variant.stock) {
        updates.stock = stock;
        updates.stockHistory = Array.isArray(variant.stockHistory) ? [...variant.stockHistory] : [];
        updates.stockHistory.push({
            previousStock: variant.stock,
            newStock: stock,
            date: new Date(),
            updatedBy: req.user?._id || null,
            reason: 'manual-update'
        });
    }

    // 5) Apply updates
    const updatedVariant = { ...variant.toObject(), ...updates };
    product.variants.set(variantIndex, updatedVariant);

    // 6) Save the product
    await product.save({ validateBeforeSave: false });

    // 7) Get the updated product with the variant
    const updatedProduct = await Product.findById(productId);
    const updatedVariantFromDb = updatedProduct.variants.id(variantId);

    if (!updatedVariantFromDb) {
        console.error('Failed to retrieve updated variant after save');
        return next(new AppError('Error updating variant', 500));
    }

    res.status(200).json({
        status: 'success',
        data: {
            variant: updatedVariantFromDb
        }
    });
});

// Get product analytics
exports.getProductAnalytics = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const { startDate, endDate, groupBy = 'day' } = req.query;

    // Date range for analytics
    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);

    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    // Get product with basic info and view history if it exists
    const product = await Product.findById(id)
        .select('name slug category views viewHistory variants ratingsAverage ratingsQuantity');
        
    if (!product) {
        return next(new AppError('Product not found.', 404));
    }

    // Process view history if it exists
    let viewsData = [];
    if (product.viewHistory && product.viewHistory.length > 0) {
        // Filter view history by date range
        const filteredViews = product.viewHistory.filter(view => {
            const viewDate = new Date(view.date);
            return viewDate >= start && viewDate <= end;
        });

        // Group by date
        const viewsByDate = filteredViews.reduce((acc, view) => {
            const date = new Date(view.date);
            const dateKey = groupBy === 'day' 
                ? date.toISOString().split('T')[0]
                : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            
            if (!acc[dateKey]) {
                acc[dateKey] = {
                    date: dateKey,
                    views: 0,
                    uniqueVisitors: new Set()
                };
            }
            
            acc[dateKey].views += 1;
            if (view.user) {
                acc[dateKey].uniqueVisitors.add(view.user.toString());
            }
            
            return acc;
        }, {});

        // Convert to array format
        viewsData = Object.values(viewsByDate).map(item => ({
            date: item.date,
            views: item.views,
            uniqueVisitors: item.uniqueVisitors.size
        }));

        // Sort by date
        viewsData.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // Get sales data
    let salesData = [];
    try {
        salesData = await Order.aggregate([
            {
                $match: {
                    'items.product': product._id,
                    createdAt: { $gte: start, $lte: end },
                    status: { $in: ['completed', 'delivered'] }
                }
            },
            {
                $unwind: '$items'
            },
            {
                $match: {
                    'items.product': product._id
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: groupBy === 'day' ? '%Y-%m-%d' : '%Y-%m', date: '$createdAt' }
                    },
                    quantitySold: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                    orders: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    date: '$_id',
                    quantitySold: 1,
                    totalRevenue: 1,
                    averageOrderValue: { $divide: ['$totalRevenue', Math.max(1, '$orders')] }
                }
            },
            { $sort: { date: 1 } }
        ]);
    } catch (error) {
        console.error('Error fetching sales data:', error);
        // Continue with empty sales data if there's an error
        salesData = [];
    }

    // Get inventory status
    const inventoryStatus = {
        currentStock: product.stock,
        lowStockThreshold: product.lowStockThreshold || 10,
        isLowStock: product.stock <= (product.lowStockThreshold || 10),
        variants: product.variants.map(v => ({
            id: v._id,
            name: v.name,
            stock: v.stock,
            isLowStock: v.stock <= (v.lowStockThreshold || 5)
        }))
    };

    // Get recent reviews
    const recentReviews = await Review.find({
        product: product._id,
        status: 'approved'
    })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name photo');

    // Prepare response
    const totalViews = viewsData.reduce((sum, item) => sum + (item.views || 0), 0);
    const totalQuantitySold = salesData.reduce((sum, item) => sum + (item.quantitySold || 0), 0);
    const totalRevenue = salesData.reduce((sum, item) => sum + (item.totalRevenue || 0), 0);

    const analytics = {
        product: {
            id: product._id,
            name: product.name,
            slug: product.slug,
            category: product.category,
            totalViews: product.views || 0
        },
        dateRange: {
            start: start,
            end: end,
            groupBy: groupBy
        },
        views: viewsData || [],
        sales: salesData || [],
        inventory: {
            currentStock: product.stock || 0,
            lowStockThreshold: product.lowStockThreshold || 10,
            isLowStock: (product.stock || 0) <= (product.lowStockThreshold || 10),
            variants: (product.variants || []).map(v => ({
                id: v._id,
                name: v.name || 'Unnamed Variant',
                stock: v.stock || 0,
                isLowStock: (v.stock || 0) <= (v.lowStockThreshold || 5)
            }))
        },
        recentReviews: Array.isArray(recentReviews) ? recentReviews : [],
        summary: {
            totalViews: totalViews,
            totalUniqueVisitors: viewsData.reduce((sum, item) => sum + (item.uniqueVisitors || 0), 0),
            totalQuantitySold: totalQuantitySold,
            totalRevenue: totalRevenue,
            averageRating: product.ratingsAverage || 0,
            totalReviews: product.ratingsQuantity || 0,
            averageOrderValue: totalQuantitySold > 0 ? (totalRevenue / totalQuantitySold).toFixed(2) : 0
        }
    };

    res.status(200).json({
        status: 'success',
        data: analytics
    });
});


// Delete a product image
exports.deleteProductImage = catchAsync(async (req, res, next) => {
    const { id, imageId } = req.params;

    // 1) Find the product
    const product = await Product.findById(id);
    if (!product) {
        return next(new AppError('Product not found.', 404));
    }

    // 2) Find the image in the product's images array
    const imageIndex = product.images.findIndex(img => img === imageId);
    if (imageIndex === -1) {
        return next(new AppError('Image not found in product.', 404));
    }

    // 3) Remove the image from the array
    product.images.splice(imageIndex, 1);

    // 4) If this was the thumbnail, unset it
    if (product.thumbnail === imageId) {
        product.thumbnail = product.images[0] || undefined;
    }

    // 5) Save the product
    await product.save({ validateBeforeSave: false });

    // 6) Delete the actual file (optional, can be handled by a cleanup job)
    const imagePath = path.join(__dirname, `../public/uploads/${imageId}`);
    if (fs.existsSync(imagePath)) {
        await unlink(imagePath);
    }

    res.status(204).json({
        status: 'success',
        data: null
    });
});

exports.exportProducts = catchAsync(async (req, res, next) => {
    const { format = 'csv', includeInactive = false } = req.query;

    // Build query
    const query = {}
    if (!includeInactive) {
        query.isActive = true;
    }

    // Get products with minimal fields for export
    const products = await Product.find(query)
        .select('name sku slug description basePrice stock category brand tags isActive isFeatured')
        .populate('category', 'name')
        .populate('brand', 'name')
        .lean();

    if (format.toLowerCase() === 'json') {
        // Return as JSON
        res.setHeader('Content-Type', 'application/json');

        res.setHeader('Content-Disposition', 'attachment; filename=products_export.json');

        return res.status(200).send(JSON.stringify(products, null, 2));
    }

    // Default to CSV
    const fields = [
        'name',
        'sku',
        'slug',
        'description',
        'basePrice',
        'stock',
        'category.name',
        'brand.name',
        'tags',
        'isActive',
        'isFeatured'
    ];

    // Convert to CSV
    const json2csv = new Parser({ fields });
    const csv = json2csv.parse(products);

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=products_export.csv');

    res.status(200).send(csv);
});

// Bulk update product status
exports.bulkUpdateStatus = catchAsync(async (req, res, next) => {
    const { productIds, status } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
        return next(new AppError('Please provide product IDs to update.', 400));
    }

    if (!['active', 'inactive', 'draft'].includes(status)) {
        return next(new AppError('Invalid status value.', 400));
    }

    const result = await Product.updateMany(
        { _id: { $in: productIds } },
        {
            isActive: status === 'active',
            status: status,
            updatedAt: new Date(),
            updatedBy: req.user?.id
        }
    );

    // Log the bulk update
    await ProductAudit.insertMany(
        productIds.map(productId => ({
            product: productId,
            action: 'bulk-update',
            user: req.user?.id,
            changes: { status },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            reason: req.body.reason,
            notes: `Bulk updated status to ${status}`
        }))
    );

    res.status(200).json({
        status: 'success',
        data: {
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount
        },
        message: `Updated ${result.modifiedCount} products to status '${status}'.`
    });
});

exports.updateProductStock = catchAsync(async (req, res, next) => {
    const { stock, variantIndex } = req.body;
    const product = await Product.findById(req.params.id);

    if (!product) return next(new AppError('Product not found.', 404));

    if (variantIndex !== undefined && product.variants?.[variantIndex]) {
        product.variants[variantIndex].stock = stock;
    } else {
        product.stock = stock;
    }

    await product.save();
    res.json({ message: 'Stock updated.', product });
});


exports.getInactiveProducts = catchAsync(async (req, res, next) => {
    const products = await Product.find({ isActive: false }).sort({ updatedAt: -1 });
    res.json({ count: products.length, products });
});


exports.bulkUpdateProducts = catchAsync(async (req, res, next) => {
    const { ids, updateFields } = req.body;

    if (!Array.isArray(ids) || !updateFields || typeof updateFields !== 'object') {
        return next(new AppError('Invalid bulk update payload.', 400));
    }

    const result = await Product.updateMany(
        {
            _id: {
                $in: ids
            }
        },
        {
            $set: updateFields
        }
    );

    res.json({ message: 'Bulk update complete.', modifiedCount: result.modifiedCount });
});

