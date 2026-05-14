'use strict';

const rateLimit = require('express-rate-limit');

// General API rate limiter: 100 requests per 15 minutes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please wait 15 minutes before trying again.',
    retryAfter: '15 minutes',
  },
});

// AI endpoint rate limiter: 20 requests per hour
const aiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'AI analysis rate limit exceeded. Maximum 20 AI requests per hour.',
    retryAfter: '1 hour',
  },
});

// Auth rate limiter: 10 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please wait 15 minutes.',
    retryAfter: '15 minutes',
  },
});

module.exports = { generalLimiter, aiRateLimiter, authLimiter };
