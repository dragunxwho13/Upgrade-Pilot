// fixture: express-legacy.js
// Tiny fake Express 4 app that intentionally uses every Express breaking pattern.
// Used as a test fixture only — never executed.
'use strict';

const express = require('express');
const app = express();

// Rule: express/app-del  (line 11)
app.del('/orders/:id', (req, res) => {
  res.json({ deleted: true });
});

// Rule: express/res-send-status  (lines 16 and 21)
app.get('/gone', (req, res) => {
  res.send(410);
});

app.post('/missing', (req, res) => {
  return res.send(404);
});

// Rule: express/req-param  (line 26)
app.get('/item/:id', (req, res) => {
  const id = req.param('id');
  res.json({ id });
});

// Rule: express/wildcard-route  (line 31)
app.get('*', (req, res) => {
  res.send(404);
});
