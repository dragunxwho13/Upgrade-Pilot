/**
 * src/routes/orders.js
 *
 * Express 4 order routes.
 * Intentionally contains patterns that break under Express 5:
 *   - res.send(statusCode)     → must become res.sendStatus(code)
 *   - req.param(name)          → removed; use req.params / req.query
 *   - app.del()                → removed; use app.delete()
 *   - app.get('*') wildcard    → route matching changed in Express 5
 *
 * These are registered on the Router, not on `app` directly, so app.del()
 * and the wildcard are demonstrated in app.js instead.
 */
'use strict';

const express = require('express');
const router  = express.Router();
const Order   = require('../models/Order');

// GET /orders — list all orders (promise-based, fine in both versions)
router.get('/', async (req, res) => {
  try {
    const orders = await Order.find({});
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /orders/:id — fetch one order
router.get('/:id', async (req, res) => {
  try {
    // LEGACY: req.param() — removed in Express 5
    // Express 5 migration: use req.params.id directly
    const id = req.param('id');            // ← BREAKING in Express 5
    const order = await Order.findById(id);
    if (!order) {
      // LEGACY: res.send(404) — removed in Express 5
      // Express 5 migration: res.sendStatus(404)
      return res.send(404);                // ← BREAKING in Express 5
    }
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /orders — create a new order
router.post('/', async (req, res) => {
  try {
    const order = new Order(req.body);
    await order.save();
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /orders/:id — update an order (promise-based)
router.put('/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /orders/:id/status — update order status using legacy Model.update()
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    // LEGACY: Model.update() — removed in Mongoose 7
    await Order.update({ _id: req.params.id }, { $set: { status } });
    res.json({ message: 'Status updated', status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /orders/count — count orders using legacy Model.count()
router.get('/meta/count', async (req, res) => {
  try {
    // LEGACY: Model.count() — removed in Mongoose 7
    const total = await Order.count({});
    res.json({ total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /orders/customer/:name — fetch by customer using legacy callback query
router.get('/customer/:name', (req, res) => {
  const name = req.params.name;
  // LEGACY: callback-style query — Mongoose 7 removes callback support
  Order.find({ customer: name }, function (err, orders) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(orders);
  });
});

module.exports = router;
