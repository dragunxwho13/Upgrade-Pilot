/**
 * tests/orders.test.js
 *
 * 12 supertest integration tests for the Acme Orders API.
 *
 * All tests run against the in-memory MongoDB provided by the mock helper
 * (tests/helpers/db.js) — no real MongoDB connection required.
 *
 * Tests cover:
 *   1.  GET  /health              → 200 + { status: 'ok' }
 *   2.  GET  /orders              → 200 + empty array initially
 *   3.  POST /orders              → 201 + created order body
 *   4.  POST /orders (validation) → 400 on missing required fields
 *   5.  GET  /orders/:id          → 200 + correct order (exercises req.param())
 *   6.  GET  /orders/:id (miss)   → res.send(404) legacy pattern returns 404
 *   7.  PUT  /orders/:id          → 200 + updated body
 *   8.  PATCH /orders/:id/status  → 200 via legacy Model.update()
 *   9.  GET  /orders/meta/count   → 200 + total via legacy Model.count()
 *  10.  GET  /orders/customer/:n  → 200 + array via legacy callback query
 *  11.  app.del() route exists    → 200 response on DELETE via legacy app.del()
 *  12.  app.get('*') catch-all    → res.send(404) on unknown route = 404
 */

'use strict';

const request  = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('./helpers/mongoMemory');
const { createApp } = require('../src/app');
const Order = require('../src/models/Order');

let app;
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'acme_test' });
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Wipe the collection before every test for isolation
  await Order.deleteMany({});
});

// ── Helper: create a valid order via the API ──────────────────────────────────
async function createOrder(overrides = {}) {
  const body = { customer: 'Alice', product: 'Widget A', quantity: 2, totalAmount: 49.99, ...overrides };
  const res  = await request(app).post('/orders').send(body);
  return res.body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Health check
// ─────────────────────────────────────────────────────────────────────────────
test('1. GET /health returns 200 and status ok', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Empty order list
// ─────────────────────────────────────────────────────────────────────────────
test('2. GET /orders returns empty array when no orders exist', async () => {
  const res = await request(app).get('/orders');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body).toHaveLength(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Create order
// ─────────────────────────────────────────────────────────────────────────────
test('3. POST /orders creates a new order and returns 201', async () => {
  const res = await request(app).post('/orders').send({
    customer: 'Bob', product: 'Gadget', quantity: 1, totalAmount: 19.99,
  });
  expect(res.status).toBe(201);
  expect(res.body._id).toBeDefined();
  expect(res.body.customer).toBe('Bob');
  expect(res.body.status).toBe('pending');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Validation error on POST
// ─────────────────────────────────────────────────────────────────────────────
test('4. POST /orders returns 400 when required fields are missing', async () => {
  const res = await request(app).post('/orders').send({ quantity: 1 });
  expect(res.status).toBe(400);
  expect(res.body.error).toBeDefined();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Fetch by ID (exercises req.param() LEGACY pattern)
// ─────────────────────────────────────────────────────────────────────────────
test('5. GET /orders/:id returns the correct order (exercises req.param())', async () => {
  const created = await createOrder({ customer: 'Carol' });
  const res = await request(app).get(`/orders/${created._id}`);
  expect(res.status).toBe(200);
  expect(res.body._id).toBe(created._id);
  expect(res.body.customer).toBe('Carol');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Not found returns 404 via legacy res.send(404)
// ─────────────────────────────────────────────────────────────────────────────
test('6. GET /orders/:id returns 404 for a non-existent ID (legacy res.send(404))', async () => {
  const fakeId = new mongoose.Types.ObjectId().toString();
  const res = await request(app).get(`/orders/${fakeId}`);
  expect(res.status).toBe(404);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Update order via PUT
// ─────────────────────────────────────────────────────────────────────────────
test('7. PUT /orders/:id updates an order and returns the new document', async () => {
  const created = await createOrder({ product: 'Old Product' });
  const res = await request(app)
    .put(`/orders/${created._id}`)
    .send({ customer: 'Alice', product: 'New Product', quantity: 5 });
  expect(res.status).toBe(200);
  expect(res.body.product).toBe('New Product');
  expect(res.body.quantity).toBe(5);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Status update via legacy Model.update()
// ─────────────────────────────────────────────────────────────────────────────
test('8. PATCH /orders/:id/status updates status via legacy Model.update()', async () => {
  const created = await createOrder();
  const res = await request(app)
    .patch(`/orders/${created._id}/status`)
    .send({ status: 'shipped' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('shipped');

  // Verify persisted
  const inDb = await Order.findById(created._id);
  expect(inDb.status).toBe('shipped');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Count via legacy Model.count()
// ─────────────────────────────────────────────────────────────────────────────
test('9. GET /orders/meta/count returns correct total via legacy Model.count()', async () => {
  await createOrder({ customer: 'D1' });
  await createOrder({ customer: 'D2' });
  await createOrder({ customer: 'D3' });

  const res = await request(app).get('/orders/meta/count');
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(3);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — Customer filter via legacy callback query
// ─────────────────────────────────────────────────────────────────────────────
test('10. GET /orders/customer/:name returns orders by customer (legacy callback query)', async () => {
  await createOrder({ customer: 'Eve', product: 'P1' });
  await createOrder({ customer: 'Eve', product: 'P2' });
  await createOrder({ customer: 'Frank', product: 'P3' });

  const res = await request(app).get('/orders/customer/Eve');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body).toHaveLength(2);
  res.body.forEach(o => expect(o.customer).toBe('Eve'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — Legacy app.del() route
// ─────────────────────────────────────────────────────────────────────────────
test('11. DELETE /legacy/delete-order/:id works via legacy app.del() route', async () => {
  const created = await createOrder({ customer: 'Grace' });
  const res = await request(app).delete(`/legacy/delete-order/${created._id}`);
  expect(res.status).toBe(200);
  expect(res.body.deleted).toBe(true);
  expect(res.body.id).toBe(created._id);

  // Confirm it's gone
  const inDb = await Order.findById(created._id);
  expect(inDb).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — Legacy app.get('*') wildcard catch-all returns 404
// ─────────────────────────────────────────────────────────────────────────────
test('12. GET on unknown route returns 404 via legacy app.get("*") wildcard', async () => {
  const res = await request(app).get('/this/route/does/not/exist');
  expect(res.status).toBe(404);
});
