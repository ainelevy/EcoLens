const { User, RewardBalance } = require('../models');
const { generateToken } = require('../middleware/auth');
const { validationResult } = require('express-validator');

exports.register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, phone } = req.body;

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create({ name, email, password, phone });

    // Create reward balance for the new user
    await RewardBalance.create({ userId: user.id });

    const token = generateToken(user);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: user.toSafeJSON(),
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: user.toSafeJSON(),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const balance = await RewardBalance.findOne({ where: { userId: req.user.id } });
    const rate = parseInt(process.env.POINTS_TO_UGX_RATE) || 5;

    res.json({
      user: req.user.toSafeJSON(),
      balance: {
        currentPoints: balance?.currentPoints || 0,
        lifetimePoints: balance?.lifetimePoints || 0,
        airtimeEquivalent: `UGX ${(balance?.currentPoints || 0) * rate}`,
      },
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
};

exports.updatePhone = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    req.user.phone = phone;
    await req.user.save();

    res.json({ message: 'Phone number updated', user: req.user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update phone' });
  }
};
