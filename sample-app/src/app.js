/**
 * src/app.js
 *
 * Acme Orders API — Express 4 application factory.
 *
 * LEGACY patterns present in this file (all break under Express 5):
 *   1. app.del()         — removed; use app.delete()
 *   2. res.send(number)  — removed; use res.sendStatus() or res.status().send()
 *   3. app.get('*')      — wildcard route matching changed in Express 5
 *
 * See src/routes/orders.js for req.param() and Mongoose legacy patterns.
 */
'use strict';

require('dotenv').config();

const express     = require('express');
const orderRoutes = require('./routes/orders');

function createApp() {
  const app = express();

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0', ts: new Date().toISOString() });
  });

  // ── Order routes ────────────────────────────────────────────────────────────
  app.use('/orders', orderRoutes);

  // ── LEGACY: app.del() — removed in Express 5 ───────────────────────────────
  // Express 5 migration: replace with app.delete()
  app.del('/legacy/delete-order/:id', async (req, res) => {    // ← BREAKING in Express 5
    try {
      const Order = require('./models/Order');
      const order = await Order.findByIdAndDelete(req.params.id);
      if (!order) {
        // LEGACY: res.send(404) — removed in Express 5
        return res.send(404);                                   // ← BREAKING in Express 5
      }
      res.json({ deleted: true, id: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── LEGACY: app.get('*') wildcard — route matching changed in Express 5 ────
  // Express 5 migration: app.get('/{*splat}', handler)  or  app.get('*splat', handler)
  app.get('*', (req, res) => {                                  // ← BREAKING in Express 5
    // LEGACY: res.send(404) — removed in Express 5
    res.send(404);                                              // ← BREAKING in Express 5
  });

  return app;
}

module.exports = { createApp };
