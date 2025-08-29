const catchAsync = require('../utils/catchAsync')
const AppError = require('../utils/AppError')
const APIFeatures = require('../utils/apiFeatures')

exports.deleteOne = Model =>
    catchAsync(async (req, res, next) => {
        const doc = await Model.findById(req.params.id);

        if (!doc) {
            return next(new AppError('No document found with that ID', 404))
        };

        res.status(204).json({
            status: 'success',
            data: null
        });
    });

exports.updateOne = Model => catchAsync(async (req, res, next) => {
    const doc = await Model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    });

    if (!doc) {
        return next(new AppError('No document found with that ID'), 404)
    };

    res.status(200).json({
        status: 'success',
        data: {
            data: doc
        }
    })
});

exports.createOne = Model =>
    catchAsync(async (req, res, next) => {
        const doc = await Model.create(req.body);

        res.status(201).json({
            status: 'success',
            data: {
                data: doc
            }
        });
    });

exports.getOne = (Model, popOptions) => catchAsync(async (req, res, next) => {
    let query = Model.findById(req.params.id)
    if (popOptions) query = query.populate(popOptions)
    const doc = await query;

    if (!doc) {
        return next(new AppError('No document found with that ID', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
            data: doc
        }
    });
})

exports.getAll = Model =>
    catchAsync(async (req, res, next) => {
        let filter = {};
        // Only set filter if workspaceId param exists
        if (req.params && req.params.workspaceId) filter = { workspace: req.params.workspaceId };

        const features = new APIFeatures(Model.find(filter), req.query)
            .filter()
            .sort()
            .limitFields()
            .paginate();
        // const doc = await features.query.explain();
        const doc = await features.query;

        // SEND RESPONSE
        res.status(200).json({
            status: 'success',
            results: doc.length,
            data: {
                data: doc
            }
        });
    });


