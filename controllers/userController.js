const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const factory = require('./handlerFactory');

const filterObj = (obj, ...allowedFields) => {
    const newObj = {};
    Object.keys(obj).forEach(el => {
        if (allowedFields.includes(el)) newObj[el] = obj[el];
    });
    return newObj;
};

exports.getMe = (req, res, next) => {
    req.params.id = req.user.id;
    next();
};

exports.updateMe = catchAsync(async (req, res, next) => {
    if (req.user.isGuest) {
        return next(new AppError('Guest users cannot update profile info.', 403));
    }

    if (req.body.password || req.body.passwordConfirm) {
        return next(
            new AppError(
                'This route is not for password updates. Please use /updateMyPassword.',
                400
            )
        );
    }

    const filteredBody = filterObj(req.body, 'name', 'email');

    const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        status: 'success',
        data: {
            user: updatedUser
        }
    });
});


exports.deleteMe = catchAsync(async (req, res, next) => {
    if (req.user.isGuest) {
        await User.findByIdAndDelete(req.user.id);
    } else {
        await User.findByIdAndUpdate(req.user.id, { active: false });
    }

    res.status(204).json({
        status: 'success',
        data: null
    });
});

// Guest user creation (for guest checkout)
exports.createGuestUser = catchAsync(async (req, res, next) => {
    const { name, email } = req.body;

    if (!name || !email) {
        return next(new AppError('Please provide name and email for guest checkout.', 400));
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return next(new AppError('Email already associated with an account. Please login.', 400));
    }

    const guestUser = await User.create({
        name,
        email,
        isGuest: true,
        role: 'guest'
    });

    res.status(201).json({
        status: 'success',
        data: {
            user: guestUser
        }
    });
});

// Admin-only user creation
exports.createUser = catchAsync(async (req, res, next) => {
    const { name, email, password, passwordConfirm, role } = req.body;

    if (!name || !email || !password || !passwordConfirm) {
        return next(new AppError('Please provide name, email, password, and password confirmation.', 400));
    }

    const newUser = await User.create({
        name,
        email,
        password,
        passwordConfirm,
        role: role || 'user'
    });

    // Don't send back the password
    newUser.password = undefined;

    res.status(201).json({
        status: 'success',
        data: {
            user: newUser
        }
    });
});

// The rest use factory handlers (admin only)
exports.getUser = factory.getOne(User);
exports.getAllUsers = factory.getAll(User);
exports.updateUser = factory.updateOne(User);
exports.deleteUser = factory.deleteOne(User);

