const { Admin, SmartUnit, DisposalEvent, DisposalSession, User, RewardBalance, AirtimeRedemption } = require('../models');
const { generateAdminToken } = require('../middleware/auth');
const { sequelize } = require('../config/database');

// POST /api/admin/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ where: { email, isActive: true } });
    if (!admin || !(await admin.comparePassword(password)))
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = generateAdminToken(admin);
    res.json({ message: 'Admin login successful', token, admin: admin.toSafeJSON() });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
};

// POST /api/admin/kiosks  — register a new kiosk
exports.registerKiosk = async (req, res) => {
  try {
    const { unitName, location } = req.body;
    if (!unitName || !location)
      return res.status(400).json({ error: 'unitName and location are required' });

    const unit = await SmartUnit.create({ unitName, location });
    res.status(201).json({ message: 'Kiosk registered', unit });
  } catch (err) {
    console.error('Register kiosk error:', err);
    res.status(500).json({ error: 'Failed to register kiosk' });
  }
};

// GET /api/admin/kiosks  — list all kiosks with per-kiosk stats
exports.listKiosks = async (req, res) => {
  try {
    const units = await SmartUnit.findAll({ order: [['createdAt', 'DESC']] });

    const result = await Promise.all(units.map(async (u) => {
      const totalEvents = await DisposalEvent.count({ where: { unitId: u.id } });
      const acceptedEvents = await DisposalEvent.count({ where: { unitId: u.id, isPlastic: true } });
      const sessions = await DisposalSession.count({ where: { unitId: u.id } });
      const pointsAgg = await DisposalEvent.sum('pointsAwarded', { where: { unitId: u.id } });

      return {
        id: u.id,
        unitName: u.unitName,
        unitCode: u.unitCode,
        location: u.location,
        status: u.status,
        lastSeenAt: u.lastSeenAt,
        currentBottleCount: u.currentBottleCount || 0,
        capacity: u.capacity || 300,
        isFull: (u.currentBottleCount || 0) >= (u.capacity || 300),
        stats: {
          totalSessions: sessions,
          totalDisposals: totalEvents,
          acceptedDisposals: acceptedEvents,
          rejectedDisposals: totalEvents - acceptedEvents,
          totalPointsAwarded: pointsAgg || 0,
        },
      };
    }));

    res.json({ kiosks: result });
  } catch (err) {
    console.error('List kiosks error:', err);
    res.status(500).json({ error: 'Failed to load kiosks' });
  }
};

// GET /api/admin/redemptions — every airtime redemption, with the user who redeemed
exports.listRedemptions = async (req, res) => {
  try {
    const redemptions = await AirtimeRedemption.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] }],
      order: [['createdAt', 'DESC']],
    });

    const stats = {
      total: redemptions.length,
      successful: redemptions.filter(r => r.status === 'successful').length,
      failed: redemptions.filter(r => r.status === 'failed').length,
      totalUGX: redemptions.reduce((s, r) => s + Number(r.airtimeAmountUgx || 0), 0),
      totalPoints: redemptions.reduce((s, r) => s + Number(r.pointsRedeemed || 0), 0),
    };

    res.json({ redemptions, stats });
  } catch (err) {
    console.error('List redemptions error:', err);
    res.status(500).json({ error: 'Failed to load redemptions' });
  }
};

// GET /api/admin/overview  — system-wide totals
exports.overview = async (req, res) => {
  try {
    const totalKiosks = await SmartUnit.count();
    const activeKiosks = await SmartUnit.count({ where: { status: 'active' } });
    const totalUsers = await User.count();
    const totalDisposals = await DisposalEvent.count();
    const acceptedDisposals = await DisposalEvent.count({ where: { isPlastic: true } });
    const totalPoints = await DisposalEvent.sum('pointsAwarded');

    res.json({
      totalKiosks,
      activeKiosks,
      totalUsers,
      totalDisposals,
      acceptedDisposals,
      totalPointsAwarded: totalPoints || 0,
    });
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
};

// GET /api/admin/kiosks/:id  — individual kiosk with full stats + recent events
exports.getKiosk = async (req, res) => {
  try {
    const u = await SmartUnit.findByPk(req.params.id);
    if (!u) return res.status(404).json({ error: 'Kiosk not found' });

    const totalEvents    = await DisposalEvent.count({ where: { unitId: u.id } });
    const acceptedEvents = await DisposalEvent.count({ where: { unitId: u.id, isPlastic: true } });
    const sessions       = await DisposalSession.count({ where: { unitId: u.id } });
    const pointsAgg      = await DisposalEvent.sum('pointsAwarded', { where: { unitId: u.id } });
    const recentEvents   = await DisposalEvent.findAll({
      where: { unitId: u.id },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });

    res.json({
      ...u.toJSON(),
      stats: {
        totalSessions: sessions,
        totalDisposals: totalEvents,
        acceptedDisposals: acceptedEvents,
        rejectedDisposals: totalEvents - acceptedEvents,
        totalPointsAwarded: pointsAgg || 0,
      },
      recentEvents,
    });
  } catch (err) {
    console.error('Get kiosk error:', err);
    res.status(500).json({ error: 'Failed to get kiosk' });
  }
};

// POST /api/admin/kiosks/:id/reset-capacity  — admin empties kiosk physically, resets counter
exports.resetKioskCapacity = async (req, res) => {
  try {
    const unit = await SmartUnit.findByPk(req.params.id);
    if (!unit) return res.status(404).json({ error: 'Kiosk not found' });
    unit.currentBottleCount = 0;
    unit.status = 'active';
    await unit.save();
    res.json({ message: 'Kiosk capacity reset. Ready to accept bottles.', unit });
  } catch (err) {
    console.error('Reset capacity error:', err);
    res.status(500).json({ error: 'Failed to reset capacity' });
  }
};

// PATCH /api/admin/kiosks/:id  — update status/location
exports.updateKiosk = async (req, res) => {
  try {
    const unit = await SmartUnit.findByPk(req.params.id);
    if (!unit) return res.status(404).json({ error: 'Kiosk not found' });

    const { status, location, unitName } = req.body;
    if (status) unit.status = status;
    if (location) unit.location = location;
    if (unitName) unit.unitName = unitName;
    await unit.save();

    res.json({ message: 'Kiosk updated', unit });
  } catch (err) {
    console.error('Update kiosk error:', err);
    res.status(500).json({ error: 'Failed to update kiosk' });
  }
};

// GET /api/admin/users — list all registered users with balances
exports.listUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      include: [{ model: RewardBalance, as: 'balance', attributes: ['currentPoints', 'lifetimePoints'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ users: users.map(u => ({ ...u.toSafeJSON(), balance: u.balance })) });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
};

// POST /api/admin/users — admin creates a user account
exports.createUser = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password)
      return res.status(400).json({ error: 'name, email, phone and password are required' });

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create({ name, email, phone, password });
    await RewardBalance.create({ userId: user.id });
    res.status(201).json({ message: 'User created', user: user.toSafeJSON() });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// PATCH /api/admin/users/:id — deactivate or reactivate a user
exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
    await user.save();
    res.json({ message: 'User updated', user: user.toSafeJSON() });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
};