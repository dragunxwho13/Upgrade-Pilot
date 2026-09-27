// fixture: mongoose-legacy.js
// Tiny fake Mongoose 6 model file that intentionally uses every Mongoose breaking pattern.
// Used as a test fixture only — never executed.
'use strict';

const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({ name: String });
const Order = mongoose.model('Order', OrderSchema);

// Rule: mongoose/model-update  (line 12)
Order.update({ name: 'old' }, { $set: { name: 'new' } });

// Rule: mongoose/model-count  (line 15)
const n = await Order.count({ name: 'test' });

// Rule: mongoose/callback-query  (line 18)
Order.find({ name: 'Alice' }, function (err, docs) {
  console.log(docs);
});

// Rule: mongoose/callback-exec  (line 23)
Order.find({ name: 'Bob' }).exec(function (err, docs) {
  console.log(docs);
});

// Rule: mongoose/find-one-and-update-callback  (line 28)
Order.findOneAndUpdate({ name: 'Carol' }, { $set: { name: 'Carolyn' } }, function (err, doc) {
  console.log(doc);
});
