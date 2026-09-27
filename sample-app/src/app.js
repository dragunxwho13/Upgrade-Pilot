/**
 * src/app.js
 *
 * Acme Orders API — Express 5 + Mongoose 7 application factory.
 * Migrated from Express 4 / Mongoose 6 by UpgradePilot.
 *
 * Express 5 changes applied:
 *   1. app.del()        → app.delete()
 *   2. res.send(NNN)    → res.sendStatus(NNN)
 *   3. app.get('*')     → app.get('/{*splat}')
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

  // ── Migrated: app.delete() (was app.del()) ──────────────────────────────────
  app.delete('/legacy/delete-order/:id', async (req, res) => {
    try {
      const Order = require('./models/Order');
      const order = await Order.findByIdAndDelete(req.params.id);
      if (!order) {
        return res.sendStatus(404);
      }
      res.json({ deleted: true, id: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Migrated: /{*splat} wildcard (was bare '*') ─────────────────────────────
  app.get('/{*splat}', (req, res) => {
    res.sendStatus(404);
  });

  return app;
}

module.exports = { createApp };
