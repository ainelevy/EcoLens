const router = require('express').Router();
const { body } = require('express-validator');
const auth = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
], auth.register);

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], auth.login);

router.get('/profile', authenticate, auth.getProfile);
router.put('/phone', authenticate, auth.updatePhone);

module.exports = router;
