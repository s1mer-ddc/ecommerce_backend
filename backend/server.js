const mongoose = require('mongoose');
const dotenv = require('dotenv');
const http = require('http');
const { createTerminus } = require('@godaddy/terminus');
const logger = require('./utils/logger');

dotenv.config({ path: './config.env' });

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  logger.error(`Name: ${err.name}, Message: ${err.message}`);
  logger.error(err.stack);
  
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

const app = require('./app');

const DB = process.env.DATABASE.replace(
  '<PASSWORD>',
  encodeURIComponent(process.env.DATABASE_PASSWORD)
);

const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4, 
};

const connectWithRetry = () => {
  mongoose
    .connect(DB, mongooseOptions)
    .then(() => logger.info('✅ MongoDB connection successful!'))
    .catch((err) => {
      logger.error('❌ MongoDB connection failed:', err.message);
      logger.info('Retrying connection in 5 seconds...');
      setTimeout(connectWithRetry, 5000);
    });
};

connectWithRetry();

const server = http.createServer(app);

const port = process.env.PORT || 5000;
const host = process.env.HOST || '0.0.0.0';

const onSignal = async () => {
  logger.info('🛑 Server is starting cleanup...');
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed.');
  } catch (error) {
    logger.error('Error during cleanup:', error);
    throw error;
  }
};

const onShutdown = () => {
  logger.info('🛑 Cleanup finished, server is shutting down');
  return Promise.resolve();
};

const healthCheck = () => {
  return Promise.resolve(
    mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy'
  );
};

createTerminus(server, {
  signal: 'SIGINT',
  healthChecks: { '/healthcheck': healthCheck },
  onSignal,
  onShutdown,
  timeout: 10000, // 10 seconds
  logger: (msg) => logger.info(msg),
});


server.listen(port, host, () => {
  logger.info(`🚀 Server running on http://${host}:${port}`);
  logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
  logger.error(`Name: ${err.name}, Message: ${err.message}`);
  logger.error(err.stack);
  
  server.close(() => {
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  logger.info('👋 SIGTERM RECEIVED. Shutting down gracefully');
  server.close(() => {
    logger.info('💥 Process terminated!');
  });
});

process.on('warning', (warning) => {
  logger.warn(`⚠️  Warning: ${warning.name} - ${warning.message}`);
  logger.warn(warning.stack);
});
