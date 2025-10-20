const mongoose = require('mongoose');

const buttonSchema = new mongoose.Schema({
  backgroundColor: { type: String, required: true },
  textColor: { type: String, required: true },
  borderRadius: { type: String, required: true },
  hoverBackground: { type: String, required: true }
}, { _id: false });

const cardSchema = new mongoose.Schema({
  backgroundColor: { type: String, required: true },
  borderRadius: { type: String, required: true },
  shadow: { type: String, required: true }
}, { _id: false });

const breakpointsSchema = new mongoose.Schema({
  mobile: { type: String, required: true },
  tablet: { type: String, required: true },
  desktop: { type: String, required: true }
}, { _id: false });

const fontsSchema = new mongoose.Schema({
  body: { type: String, required: true },
  heading: { type: String, required: true },
  monospace: { type: String, required: true }
}, { _id: false });

const themeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'A theme must have a name'],
    trim: true
  },
  storeId: {
    type: String,
    required: [true, 'A theme must be associated with a store']
  },
  colors: {
    primary: { type: String, required: true },
    secondary: { type: String, required: true },
    background: { type: String, required: true },
    text: { type: String, required: true },
    buttonText: { type: String, required: true },
    cardBackground: { type: String, required: true },
    linkHover: { type: String, required: true }
  },
  breakpoints: {
    type: breakpointsSchema,
    required: true
  },
  fonts: {
    type: fontsSchema,
    required: true
  },
  buttons: {
    primary: { type: buttonSchema, required: true },
    secondary: { type: buttonSchema, required: true }
  },
  cards: {
    default: { type: cardSchema, required: true },
    highlighted: { type: cardSchema, required: true }
  },
  isActive: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now()
  },
  updatedAt: {
    type: Date,
    default: Date.now()
  }
});

// Ensure only one theme is active per store
themeSchema.pre('save', async function(next) {
  if (this.isActive) {
    await this.constructor.updateMany(
      { storeId: this.storeId, _id: { $ne: this._id } },
      { $set: { isActive: false } }
    );
  }
  next();
});

const Theme = mongoose.model('Theme', themeSchema);

module.exports = Theme;
