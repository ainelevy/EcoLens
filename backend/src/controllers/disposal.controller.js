const FormData = require('form-data');
const axios = require('axios');
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:7860';
const { DisposalSession, DisposalEvent, RewardBalance, RewardTransaction, User, SmartUnit } = require('../models');
const { sequelize } = require('../config/database');

// Start a new disposal session (called by RPi or simulated in demo)
exports.startSession = async (req, res) => {
  try {
    const { userCode, unitId } = req.body;

    // Validate user code (RPi sends this)
    const user = await User.findOne({ where: { userCode, isActive: true } });
    if (!user) return res.status(404).json({ error: 'Invalid user code' });

    // If the user already has an active session ON THIS SAME unit, re-scanning is
    // idempotent — just return it (avoids ending/recreating the session in progress).
    const sameUnitActive = await DisposalSession.findOne({
      where: { userId: user.id, status: 'active', unitId: unitId || null },
    });
    if (sameUnitActive) {
      return res.json({ message: 'Session already active', session: sameUnitActive, userName: user.name });
    }

    // Otherwise, auto-end any stale active sessions the user left open (e.g. on a
    // different kiosk they walked away from) so the new scan always starts clean.
    await DisposalSession.update(
      { status: 'completed', endedAt: new Date() },
      { where: { userId: user.id, status: 'active' } }
    );

    // If a kiosk sent its unitId, mark it as seen
    if (unitId) {
      const unit = await SmartUnit.findByPk(unitId);
      if (unit) {
        unit.lastSeenAt = new Date();
        await unit.save();
      }
    }

    const session = await DisposalSession.create({ userId: user.id, unitId: unitId || null });

    res.status(201).json({
      message: `Welcome, ${user.name}! Insert one plastic item.`,
      session: { id: session.id, startedAt: session.startedAt },
      userName: user.name,
    });
  } catch (err) {
    console.error('Start session error:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
};

// Record a disposal event (called by RPi after classification)
exports.recordEvent = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { sessionId, classifiedAs, confidence, isPlastic } = req.body;

    const session = await DisposalSession.findByPk(sessionId);
    if (!session || session.status !== 'active')
      return res.status(400).json({ error: 'No active session found' });

    const pointsPerDisposal = parseInt(process.env.POINTS_PER_DISPOSAL) || 50;
    const pointsAwarded = isPlastic ? pointsPerDisposal : 0;

    // Create disposal event (carry unitId from the session)
    const event = await DisposalEvent.create({
      sessionId, userId: session.userId, unitId: session.unitId,
      classifiedAs, confidence, isPlastic, pointsAwarded,
    }, { transaction: t });

    // Update session totals
    session.totalItems += 1;
    session.totalPoints += pointsAwarded;
    await session.save({ transaction: t });

    // Award points if valid plastic
    if (isPlastic) {
      const balance = await RewardBalance.findOne({ where: { userId: session.userId } });
      balance.currentPoints += pointsAwarded;
      balance.lifetimePoints += pointsAwarded;
      await balance.save({ transaction: t });

      await RewardTransaction.create({
        userId: session.userId, eventId: event.id,
        type: 'earned', points: pointsAwarded,
        description: `Earned ${pointsAwarded} points for valid plastic disposal`,
      }, { transaction: t });
    }

    await t.commit();

    res.status(201).json({
      message: isPlastic ? `Item accepted. +${pointsAwarded} points.` : 'Invalid item. No points added.',
      event: { id: event.id, classifiedAs, confidence, isPlastic, pointsAwarded },
      sessionTotals: { totalItems: session.totalItems, totalPoints: session.totalPoints },
    });
  } catch (err) {
    await t.rollback();
    console.error('Record event error:', err);
    res.status(500).json({ error: 'Failed to record disposal event' });
  }
};

// Record MANY disposal events in one request (called by the kiosk in "rapid mode",
// which queues events locally and flushes them in batches to avoid a network
// round-trip per bottle). Points are awarded for the whole batch in one transaction.
exports.recordEventsBatch = async (req, res) => {
  try {
    const { sessionId, events } = req.body;
    if (!sessionId || !Array.isArray(events) || events.length === 0)
      return res.status(400).json({ error: 'sessionId and a non-empty events[] are required' });

    const session = await DisposalSession.findByPk(sessionId);
    if (!session || session.status !== 'active')
      return res.status(400).json({ error: 'No active session found' });

    const pointsPerDisposal = parseInt(process.env.POINTS_PER_DISPOSAL) || 50;

    const summary = await sequelize.transaction(async (t) => {
      const rows = events.map((e) => ({
        sessionId,
        userId: session.userId,
        unitId: session.unitId,
        classifiedAs: e.classifiedAs || 'unknown',
        confidence: typeof e.confidence === 'number' ? e.confidence : 0,
        isPlastic: !!e.isPlastic,
        pointsAwarded: e.isPlastic ? pointsPerDisposal : 0,
      }));

      const created = await DisposalEvent.bulkCreate(rows, { transaction: t });

      const acceptedPoints = created.reduce((s, ev) => s + ev.pointsAwarded, 0);
      const acceptedCount = created.filter((ev) => ev.isPlastic).length;

      // Update session totals
      session.totalItems += created.length;
      session.totalPoints += acceptedPoints;
      await session.save({ transaction: t });

      // Award points once for the whole batch
      if (acceptedPoints > 0) {
        const balance = await RewardBalance.findOne({ where: { userId: session.userId }, transaction: t });
        balance.currentPoints += acceptedPoints;
        balance.lifetimePoints += acceptedPoints;
        await balance.save({ transaction: t });

        // Keep the per-event audit trail (one 'earned' row per accepted item)
        const txRows = created
          .filter((ev) => ev.isPlastic)
          .map((ev) => ({
            userId: session.userId,
            eventId: ev.id,
            type: 'earned',
            points: ev.pointsAwarded,
            description: `Earned ${ev.pointsAwarded} points for valid plastic disposal`,
          }));
        await RewardTransaction.bulkCreate(txRows, { transaction: t });
      }

      return { received: created.length, accepted: acceptedCount, pointsAwarded: acceptedPoints };
    });

    res.status(201).json({
      message: `Recorded ${summary.received} items (${summary.accepted} accepted, +${summary.pointsAwarded} points).`,
      ...summary,
      sessionTotals: { totalItems: session.totalItems, totalPoints: session.totalPoints },
    });
  } catch (err) {
    console.error('Batch record error:', err);
    res.status(500).json({ error: 'Failed to record disposal events' });
  }
};

// End a disposal session
exports.endSession = async (req, res) => {
  try {
    const { sessionId } = req.body;

    const session = await DisposalSession.findByPk(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    session.status = 'completed';
    session.endedAt = new Date();
    await session.save();

    res.json({
      message: `Session ended. Total items: ${session.totalItems}. Points earned: ${session.totalPoints}.`,
      session,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to end session' });
  }
};

// Get disposal history for the authenticated user
exports.getHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await DisposalEvent.findAndCountAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit, offset,
    });

    res.json({
      events: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load history' });
  }
};

// Get disposal statistics for the authenticated user
exports.getStats = async (req, res) => {
  try {
    const totalEvents = await DisposalEvent.count({ where: { userId: req.user.id } });
    const acceptedEvents = await DisposalEvent.count({ where: { userId: req.user.id, isPlastic: true } });
    const rejectedEvents = totalEvents - acceptedEvents;

    const sessions = await DisposalSession.count({ where: { userId: req.user.id, status: 'completed' } });

    const balance = await RewardBalance.findOne({ where: { userId: req.user.id } });
    const rate = parseInt(process.env.POINTS_TO_UGX_RATE) || 5;

    res.json({
      totalSessions: sessions,
      totalItems: totalEvents,
      acceptedItems: acceptedEvents,
      rejectedItems: rejectedEvents,
      acceptanceRate: totalEvents > 0 ? ((acceptedEvents / totalEvents) * 100).toFixed(1) + '%' : '0%',
      currentPoints: balance?.currentPoints || 0,
      lifetimePoints: balance?.lifetimePoints || 0,
      airtimeEarned: `UGX ${(balance?.lifetimePoints || 0) * rate}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load statistics' });
  }
};

// GET /api/disposal/kiosks/:unitId/status — public, kiosk fetches its own state on startup
exports.getKioskStatus = async (req, res) => {
  try {
    const unit = await SmartUnit.findByPk(req.params.unitId);
    if (!unit) return res.status(404).json({ error: 'Kiosk not found' });
    res.json({
      unitId: unit.id,
      status: unit.status,
      currentBottleCount: unit.currentBottleCount || 0,
      capacity: unit.capacity || 300,
      isFull: (unit.currentBottleCount || 0) >= (unit.capacity || 300),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get kiosk status' });
  }
};

// GET /api/disposal/kiosks/:unitId/active-session — public, kiosk polls this to detect a
// session that was started from a user's phone (via QR scan). Returns the most recent active
// session on this unit so the kiosk can switch from its QR screen into the disposal flow.
exports.getActiveSession = async (req, res) => {
  try {
    const session = await DisposalSession.findOne({
      where: { unitId: req.params.unitId, status: 'active' },
      order: [['startedAt', 'DESC']],
      include: [{ model: User, attributes: ['name', 'userCode'] }],
    });
    if (!session) return res.json({ active: false });
    res.json({
      active: true,
      session: { id: session.id, startedAt: session.startedAt },
      userName: session.User?.name || '',
      userCode: session.User?.userCode || '',
    });
  } catch (err) {
    console.error('Get active session error:', err);
    res.status(500).json({ error: 'Failed to get active session' });
  }
};

// PATCH /api/disposal/kiosks/:unitId/capacity — kiosk reports its bottle count (and, optionally,
// its physical capacity, so the DB stays in sync with the hardware) after each disposal / on boot.
exports.updateKioskCapacity = async (req, res) => {
  try {
    const { bottleCount, capacity } = req.body;
    const unit = await SmartUnit.findByPk(req.params.unitId);
    if (!unit) return res.status(404).json({ error: 'Kiosk not found' });
    if (bottleCount !== undefined) unit.currentBottleCount = Math.max(0, parseInt(bottleCount) || 0);
    if (capacity !== undefined) {
      const cap = parseInt(capacity);
      if (cap > 0) unit.capacity = cap;
    }
    unit.lastSeenAt = new Date();
    await unit.save();
    res.json({ ok: true, currentBottleCount: unit.currentBottleCount, capacity: unit.capacity });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update capacity' });
  }
};

// GET /api/disposal/sessions/:sessionId — JWT; live totals for the owner's session so the
// mobile app can show a running total while the user feeds bottles at the kiosk.
exports.getSession = async (req, res) => {
  try {
    const session = await DisposalSession.findByPk(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'Not your session' });

    const pointsPerDisposal = parseInt(process.env.POINTS_PER_DISPOSAL) || 50;
    res.json({
      id: session.id,
      status: session.status,
      totalItems: session.totalItems,
      totalPoints: session.totalPoints,
      acceptedItems: pointsPerDisposal > 0 ? Math.round(session.totalPoints / pointsPerDisposal) : 0,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    });
  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ error: 'Failed to load session' });
  }
};

exports.classifyImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: 'capture.jpg',
      contentType: 'image/jpeg',
    });
    const mlResponse = await axios.post(`${ML_SERVICE_URL}/classify`, form, {
      headers: form.getHeaders(),
      timeout: 15000,
    });
    return res.json(mlResponse.data);
  } catch (err) {
    console.error('Classify error:', err.message);
    return res.status(500).json({ error: 'Classification failed' });
  }
};