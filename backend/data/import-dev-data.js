const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');

dotenv.config({ path: path.join(__dirname, '../config.env') });

const DB = process.env.DATABASE.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD || ''
);

mongoose
  .connect(DB, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => console.log('✅ MongoDB connection successful!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const readJsonFile = (filename) => {
  try {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${filename}`);
      return [];
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`❌ Error reading ${filename}:`, error.message);
    return [];
  }
};

const importData = async () => {
  try {
    const products = readJsonFile('sample-products.json');
    
    await Promise.all([
      Product.deleteMany(),
      User.deleteMany(),
      Order.deleteMany(),
      Review.deleteMany()
    ]);

    if (products.length > 0) {
      await Product.insertMany(products);
      console.log(`✅ Imported ${products.length} products`);
    }

    console.log('✨ Data import completed successfully!');
  } catch (error) {
    console.error('❌ Error importing data:', error);
  } finally {
    mongoose.connection.close();
  }
};

const deleteData = async () => {
  try {
    await Promise.all([
      Product.deleteMany(),
      User.deleteMany(),
      Order.deleteMany(),
      Review.deleteMany()
    ]);
    console.log('🗑️  All data deleted successfully!');
  } catch (error) {
    console.error('❌ Error deleting data:', error);
  } finally {
    mongoose.connection.close();
  }
};

const command = process.argv[2];

if (command === '--import') {
  importData();
} else if (command === '--delete') {
  deleteData();
} else {
  console.log('Please provide a valid command:');
  console.log('  node import-dev-data.js --import  Import sample data');
  console.log('  node import-dev-data.js --delete  Delete all data');
  process.exit(1);
}
