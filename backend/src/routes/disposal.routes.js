const router = require('express').Router();
const disposal = require('../controllers/disposal.controller');
const { authenticate } = require('../middleware/auth');

// Public: RPi disposal unit endpoints (validated by userCode, not JWT)
router.post('/sessions/start', disposal.startSession);
router.post('/events', disposal.recordEvent);
router.post('/sessions/end', disposal.endSession);

// Protected: Mobile app endpoints
router.get('/history', authenticate, disposal.getHistory);
router.get('/stats', authenticate, disposal.getStats);

module.exports = router;
