const { DisposalSession, DisposalEvent, RewardBalance, RewardTransaction, User } = require('../models');
const { sequelize } = require('../config/database');

// Start a new disposal session (called by RPi or simulated in demo)
exports.startSession = async (req, res) => {
  try {
    const { userCode } = req.body;

    // Validate user code (RPi sends this)
    const user = await User.findOne({ where: { userCode, isActive: true } });
    if (!user) return res.status(404).json({ error: 'Invalid user code' });

    // Check for existing active session
    const active = await DisposalSession.findOne({ where: { userId: user.id, status: 'active' } });
    if (active) return res.json({ message: 'Session already active', session: active });

    const session = await DisposalSession.create({ userId: user.id });

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

    const pointsPerDisposal = parseInt(process.env.POINTS_PER_DISPOSAL) || 10;
    const pointsAwarded = isPlastic ? pointsPerDisposal : 0;

    // Create disposal event
    const event = await DisposalEvent.create({
      sessionId, userId: session.userId,
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
