const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize, errors } = format;
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);

const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logFormat = printf(({ level, message, timestamp, stack }) => {
  const logMessage = `${timestamp} ${level}: ${stack || message}`;
  return logMessage;
});

const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  logFormat
);

const fileFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  format.json()
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  transports: [
    new transports.Console({
      format: consoleFormat,
      handleExceptions: true,
    }),
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      tailable: true,
      zippedArchive: true,
    }),
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      tailable: true,
      zippedArchive: true,
    }),
  ],
  exitOnError: false, 
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
  if (reason.stack) {
    logger.error(reason.stack);
  }
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`, error);
});

process.on('warning', (warning) => {
  logger.warn(`Warning: ${warning.name} - ${warning.message}`, warning);
});

async function cleanupOldLogs() {
  try {
    const files = await readdir(logDir);
    const now = new Date().getTime();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000; // 30 days 

    for (const file of files) {
      if (file.endsWith('.log')) {
        const filePath = path.join(logDir, file);
        const stats = await fs.promises.stat(filePath);
        
        if (stats.mtimeMs < thirtyDaysAgo) {
          await unlink(filePath);
          logger.info(`Deleted old log file: ${file}`);
        }
      }
    }
  } catch (error) {
    logger.error('Error cleaning up log files:', error);
  }
}

cleanupOldLogs().catch(console.error);

setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000).unref();

module.exports = logger;
