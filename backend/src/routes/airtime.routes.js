const router = require('express').Router();
const { body } = require('express-validator');
const airtime = require('../controllers/airtime.controller');
const { authenticate } = require('../middleware/auth');

router.post('/redeem', authenticate, [
  body('points').isInt({ min: 1 }).withMessage('Points must be a positive integer'),
], airtime.redeem);

router.get('/history', authenticate, airtime.getRedemptions);

// Callback from Africa's Talking (no auth — AT sends this)
router.post('/callbacks/status', airtime.statusCallback);

module.exports = router;
