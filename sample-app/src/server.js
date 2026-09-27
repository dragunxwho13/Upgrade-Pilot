/**
 * src/server.js
 *
 * HTTP server entry point — not used during tests (tests import app directly).
 */
'use strict';

const mongoose    = require('mongoose');
const { createApp } = require('./app');

const PORT      = process.env.PORT      || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/acme_orders';

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log(`MongoDB connected: ${MONGO_URI}`);
    const app = createApp();
    app.listen(PORT, () => console.log(`Acme Orders API listening on :${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
