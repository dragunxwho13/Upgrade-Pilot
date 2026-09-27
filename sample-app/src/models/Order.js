/**
 * src/models/Order.js
 *
 * Mongoose 7 Order model.
 * Migrated from Mongoose 6 by UpgradePilot.
 *
 * Mongoose 7 changes:
 *   - Model.update()  → Model.updateOne()
 *   - Model.count()   → Model.countDocuments()
 *   - Callback-style queries → async/await
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
 * Migrated: uses Model.updateOne() (was Model.update())
 */
orderSchema.statics.legacyUpdateStatus = async function (id, status) {
  return Order.updateOne({ _id: id }, { $set: { status } });
};

/**
 * Migrated: uses Model.countDocuments() (was Model.count())
 */
orderSchema.statics.legacyCount = async function (filter) {
  return Order.countDocuments(filter);
};

/**
 * Migrated: async/await (was callback-style)
 */
orderSchema.statics.legacyFindByCustomer = async function (customer) {
  return Order.find({ customer });
};

/**
 * Migrated: async/await (was .exec(callback))
 */
orderSchema.statics.legacyExecFind = async function (customer) {
  return Order.find({ customer }).exec();
};

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;
