const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/error.middleware');
const { securityHeaders, apiLimiter } = require('./middlewares/security.middleware');

const app = express();

// Trust proxy for accurate IP detection (important for activity logging)
// Set to 1 to trust first proxy (e.g., nginx reverse proxy)
app.set('trust proxy', 1);

// Security headers
app.use(securityHeaders);

// Enable CORS for all routes
app.use(cors({
  origin: 'http://localhost:5173',
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
