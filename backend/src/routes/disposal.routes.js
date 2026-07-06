const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const router = require('express').Router();
const disposal = require('../controllers/disposal.controller');
const { authenticate } = require('../middleware/auth');

// Public: RPi disposal unit endpoints
router.post('/sessions/start', disposal.startSession);
router.post('/sessions/end', disposal.endSession);
router.post('/classify', upload.single('image'), disposal.classifyImage);
router.post('/events', disposal.recordEvent);
router.post('/events/batch', disposal.recordEventsBatch);
router.get('/kiosks/:unitId/status', disposal.getKioskStatus);
router.get('/kiosks/:unitId/active-session', disposal.getActiveSession);
router.patch('/kiosks/:unitId/capacity', disposal.updateKioskCapacity);

// Protected: Mobile app endpoints
router.get('/history', authenticate, disposal.getHistory);
router.get('/stats', authenticate, disposal.getStats);
router.get('/sessions/:sessionId', authenticate, disposal.getSession);

module.exports = router;