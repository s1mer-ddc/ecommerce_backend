const Review = require('./../models/Review');
const factory = require('./handlerFactory');

exports.setProdUserIds = (req, res, next) => {
    // Allow nested routes
    if (!req.body.product) req.body.tour = req.params.productId;
    if (!req.body.product) req.body.user = req.user.id;
    next();
};

exports.getAllReviews = factory.getAll(Review);
exports.getReview = factory.getOne(Review);
exports.createReview = factory.createOne(Review);
exports.updateReview = factory.updateOne(Review);
exports.deleteReview = factory.deleteOne(Review);
