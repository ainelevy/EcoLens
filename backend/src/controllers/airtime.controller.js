const { RewardBalance, AirtimeRedemption, RewardTransaction } = require('../models');
const { sequelize } = require('../config/database');

// Send airtime via Africa's Talking API
async function sendAirtime(phoneNumber, amount, currencyCode) {
  try {
    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({
      apiKey: process.env.AT_API_KEY,
      username: process.env.AT_USERNAME,
    });
    const airtime = at.AIRTIME;

    const result = await airtime.send({
      recipients: [{ phoneNumber, amount: `${currencyCode} ${amount.toFixed(2)}` }],
    });

    // Parse the response
    const entry = result.responses?.[0];
    if (entry && entry.status === 'Sent') {
      return { success: true, requestId: entry.requestId, discount: entry.discount };
    } else {
      return { success: false, error: entry?.errorMessage || result.errorMessage || 'Unknown error' };
    }
  } catch (err) {
    console.error('Africa\'s Talking API error:', err);
    return { success: false, error: err.message || 'API call failed' };
  }
}

// Redeem points for airtime
exports.redeem = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { points } = req.body;
    const userId = req.user.id;
    const rate = parseInt(process.env.POINTS_TO_UGX_RATE) || 5;
    const minPoints = parseInt(process.env.MIN_REDEMPTION_POINTS) || 100;
    const currency = process.env.AT_CURRENCY_CODE || 'UGX';

    if (!points || points < minPoints)
      return res.status(400).json({ error: `Minimum redemption is ${minPoints} points` });

    // Check balance
    const balance = await RewardBalance.findOne({ where: { userId }, transaction: t });
    if (!balance || balance.currentPoints < points)
      return res.status(400).json({ error: `Insufficient points. You have ${balance?.currentPoints || 0} points.` });

    const ugxAmount = points * rate;
    const phoneNumber = req.user.phone;

    // Create pending redemption record
    const redemption = await AirtimeRedemption.create({
      userId, pointsRedeemed: points,
      airtimeAmountUgx: ugxAmount, phoneNumber, status: 'pending',
    }, { transaction: t });

    // Call Africa's Talking API
    const result = await sendAirtime(phoneNumber, ugxAmount, currency);

    if (result.success) {
      // Deduct points ONLY on success
      balance.currentPoints -= points;
      await balance.save({ transaction: t });

      redemption.status = 'successful';
      redemption.atTransactionId = result.requestId;
      await redemption.save({ transaction: t });

      await RewardTransaction.create({
        userId, type: 'redeemed', points: -points,
        description: `Redeemed ${points} points for ${currency} ${ugxAmount} airtime to ${phoneNumber}`,
      }, { transaction: t });

      await t.commit();

      res.json({
        message: `Airtime of ${currency} ${ugxAmount} sent to ${phoneNumber} successfully.`,
        redemption: {
          id: redemption.id, pointsRedeemed: points,
          airtimeAmount: `${currency} ${ugxAmount}`,
          phoneNumber, transactionId: result.requestId, status: 'successful',
        },
        remainingPoints: balance.currentPoints,
      });
    } else {
      // Failed — do NOT deduct points
      redemption.status = 'failed';
      redemption.errorMessage = result.error;
      await redemption.save({ transaction: t });
      await t.commit();

      res.status(502).json({
        error: 'Airtime disbursement failed. Points not deducted. Please try again.',
        details: result.error,
      });
    }
  } catch (err) {
    await t.rollback();
    console.error('Redeem error:', err);
    res.status(500).json({ error: 'Redemption failed' });
  }
};

// Get redemption history
exports.getRedemptions = async (req, res) => {
  try {
    const redemptions = await AirtimeRedemption.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json({ redemptions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load redemptions' });
  }
};

// Status callback from Africa's Talking
exports.statusCallback = async (req, res) => {
  try {
    const { requestId, status } = req.body;
    if (!requestId) return res.status(400).json({ error: 'Missing requestId' });

    const redemption = await AirtimeRedemption.findOne({ where: { atTransactionId: requestId } });
    if (redemption) {
      redemption.status = status === 'Success' ? 'successful' : 'failed';
      await redemption.save();
    }

    res.json({ status: 'received' });
  } catch (err) {
    res.status(500).json({ error: 'Callback processing failed' });
  }
};
