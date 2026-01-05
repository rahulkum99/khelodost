const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/error.middleware');
const { securityHeaders, apiLimiter } = require('./middlewares/security.middleware');

const app = express();

// Trust proxy for accurate IP detection (important for activity logging)
app.set('trust proxy', true);

// Security headers
app.use(securityHeaders);

// Enable CORS for all routes
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser());

// Apply rate limiting to API routes
app.use('/api', apiLimiter);

// Routes
app.use('/api', routes);

// Error handling middleware (must be last)
app.use(errorMiddleware);

module.exports = app;
