const Theme = require('../models/Theme');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

// Create a new theme
exports.createTheme = catchAsync(async (req, res, next) => {
  const newTheme = await Theme.create(req.body);
  
  res.status(201).json({
    status: 'success',
    data: {
      theme: newTheme
    }
  });
});

// Get all themes for a store
exports.getStoreThemes = catchAsync(async (req, res, next) => {
  const { storeId } = req.params;
  
  const themes = await Theme.find({ storeId });
  
  res.status(200).json({
    status: 'success',
    results: themes.length,
    data: {
      themes
    }
  });
});

// Get active theme for a store
exports.getActiveTheme = catchAsync(async (req, res, next) => {
  const { storeId } = req.params;
  
  const theme = await Theme.findOne({ storeId, isActive: true });
  
  if (!theme) {
    return next(new AppError('No active theme found for this store', 404));
  }
  
  res.status(200).json({
    status: 'success',
    data: {
      theme
    }
  });
});

// Update a theme
exports.updateTheme = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  
  const theme = await Theme.findByIdAndUpdate(
    id,
    req.body,
    {
      new: true,
      runValidators: true
    }
  );
  
  if (!theme) {
    return next(new AppError('No theme found with that ID', 404));
  }
  
  res.status(200).json({
    status: 'success',
    data: {
      theme
    }
  });
});

// Set theme as active
exports.setActiveTheme = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  
  // First, deactivate all themes for this store
  const theme = await Theme.findById(id);
  if (!theme) {
    return next(new AppError('No theme found with that ID', 404));
  }
  
  await Theme.updateMany(
    { storeId: theme.storeId },
    { $set: { isActive: false } }
  );
  
  // Then activate the selected theme
  const updatedTheme = await Theme.findByIdAndUpdate(
    id,
    { isActive: true },
    { new: true, runValidators: true }
  );
  
  res.status(200).json({
    status: 'success',
    data: {
      theme: updatedTheme
    }
  });
});

// Delete a theme
exports.deleteTheme = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  
  const theme = await Theme.findByIdAndDelete(id);
  
  if (!theme) {
    return next(new AppError('No theme found with that ID', 404));
  }
  
  res.status(204).json({
    status: 'success',
    data: null
  });
});

// Export default theme (for initialization)
exports.getDefaultTheme = catchAsync(async (req, res, next) => {
  const defaultTheme = {
    name: 'Modern Blue',
    colors: {
      primary: '#646cff',
      secondary: '#535bf2',
      background: '#ffffff',
      text: '#213547',
      buttonText: '#ffffff',
      cardBackground: '#f9f9f9',
      linkHover: '#747bff'
    },
    breakpoints: {
      mobile: '480px',
      tablet: '768px',
      desktop: '1200px'
    },
    fonts: {
      body: 'system-ui, Avenir, Helvetica, Arial, sans-serif',
      heading: 'Georgia, serif',
      monospace: 'Courier New, monospace'
    },
    buttons: {
      primary: {
        backgroundColor: '#646cff',
        textColor: '#ffffff',
        borderRadius: '8px',
        hoverBackground: '#535bf2'
      },
      secondary: {
        backgroundColor: '#ffffff',
        textColor: '#646cff',
        borderRadius: '8px',
        hoverBackground: '#f0f0ff'
      }
    },
    cards: {
      default: {
        backgroundColor: '#f9f9f9',
        borderRadius: '8px',
        shadow: '0 4px 6px rgba(0,0,0,0.1)'
      },
      highlighted: {
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        shadow: '0 6px 10px rgba(0,0,0,0.15)'
      }
    }
  };
  
  res.status(200).json({
    status: 'success',
    data: {
      theme: defaultTheme
    }
  });
});
