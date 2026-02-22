const express = require('express');
const db      = require('../db');
const router  = express.Router();

router.get('/', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.status(200).json({ status: 'ok' });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

module.exports = router;
