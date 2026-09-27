// fixture: clean.js
// Modern file with NO breaking patterns — scanner should return zero hits.
'use strict';

const express = require('express');
const app = express();

// Modern Express 5 style
app.delete('/orders/:id', async (req, res) => {
  res.sendStatus(204);
});

app.get('/item/:id', (req, res) => {
  const id = req.params.id;   // correct: use req.params directly
  res.json({ id });
});

// No wildcard bare-star
app.use((req, res) => {
  res.sendStatus(404);
});

module.exports = app;
