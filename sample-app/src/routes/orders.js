/**
 * src/routes/orders.js
 *
 * Acme Orders API — Express 5 + Mongoose 7 route handlers.
 * Migrated from Express 4 / Mongoose 6 by UpgradePilot.
 *
 * Express 5 changes:
 *   - req.param('id')  → req.params.id
 *   - res.send(404)    → res.sendStatus(404)
 *
 * Mongoose 7 changes:
 *   - Model.update()   → Model.updateOne()
 *   - Model.count()    → Model.countDocuments()
 *   - callback-style find() → async/await
 */
'use strict';

const express = require('express');
const router  = express.Router();
const Order   = require('../models/Order');

// GET /orders — list all orders
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
    const id    = req.params.id;
    const order = await Order.findById(id);
    if (!order) {
      return res.sendStatus(404);
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

// PUT /orders/:id — update an order
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

// PATCH /orders/:id/status — update order status (Mongoose 7: updateOne)
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await Order.updateOne({ _id: req.params.id }, { $set: { status } });
    res.json({ message: 'Status updated', status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /orders/meta/count — count orders (Mongoose 7: countDocuments)
router.get('/meta/count', async (req, res) => {
  try {
    const total = await Order.countDocuments({});
    res.json({ total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /orders/customer/:name — fetch by customer (Mongoose 7: async/await)
router.get('/customer/:name', async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.params.name });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
