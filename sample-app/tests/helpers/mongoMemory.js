/**
 * tests/helpers/mongoMemory.js
 *
 * Thin wrapper so the test file imports a consistent API regardless of
 * whether mongodb-memory-server is the full package or a lite variant.
 *
 * Re-exports MongoMemoryServer for use in beforeAll / afterAll hooks.
 */
'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
module.exports = { MongoMemoryServer };
