/**
 * src/models/Order.js
 *
 * Mongoose 6 Order model.
 * Intentionally uses APIs that break under Mongoose 7:
 *   - Model.update()   (removed in v7; use updateOne/updateMany)
 *   - Model.count()    (removed in v7; use countDocuments)
 *   - callback-style query execution
 */
'use strict';

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    customer:    { type: String, required: true },
    product:     { type: String, required: true },
    quantity:    { type: Number, default: 1 },
    status:      { type: String, enum: ['pending', 'processing', 'shipped', 'cancelled'], default: 'pending' },
    totalAmount: { type: Number, default: 0 },
    notes:       { type: String, default: '' },
  },
  { timestamps: true }
);

/**
 * LEGACY: uses Model.update() — removed in Mongoose 7.
 * Mongoose 7 replacement: Order.updateOne(filter, update)
 */
orderSchema.statics.legacyUpdateStatus = function (id, status, cb) {
  // Model.update() is the breaking pattern — Mongoose 7 removes this method
  return Order.update({ _id: id }, { $set: { status } }, cb);
};

/**
 * LEGACY: uses Model.count() — removed in Mongoose 7.
 * Mongoose 7 replacement: Order.countDocuments(filter)
 */
orderSchema.statics.legacyCount = function (filter, cb) {
  return Order.count(filter, cb);
};

/**
 * LEGACY: callback-style query — Mongoose 7 requires promises / async-await.
 */
orderSchema.statics.legacyFindByCustomer = function (customer, cb) {
  return Order.find({ customer }, cb);
};

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;
