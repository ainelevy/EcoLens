const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');

// ─── UserAccount ───
const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
  password: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, allowNull: false },
  userCode: { type: DataTypes.STRING(8), unique: true },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'users' });

User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 12);
  user.userCode = 'EC' + Math.random().toString(36).substring(2, 8).toUpperCase();
});

User.prototype.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

User.prototype.toSafeJSON = function () {
  const { password, ...safe } = this.toJSON();
  return safe;
};

// ─── RewardBalance ───
const RewardBalance = sequelize.define('RewardBalance', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, unique: true },
  currentPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
  lifetimePoints: { type: DataTypes.INTEGER, defaultValue: 0 },
}, { tableName: 'reward_balances' });

// ─── DisposalSession ───
const DisposalSession = sequelize.define('DisposalSession', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  unitId: { type: DataTypes.UUID, allowNull: true },
  startedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  endedAt: { type: DataTypes.DATE },
  totalItems: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
  status: { type: DataTypes.ENUM('active', 'completed'), defaultValue: 'active' },
}, { tableName: 'disposal_sessions' });

// ─── DisposalEvent ───
const DisposalEvent = sequelize.define('DisposalEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sessionId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  unitId: { type: DataTypes.UUID, allowNull: true },
  classifiedAs: { type: DataTypes.STRING, allowNull: false },
  confidence: { type: DataTypes.FLOAT, allowNull: false },
  isPlastic: { type: DataTypes.BOOLEAN, defaultValue: false },
  pointsAwarded: { type: DataTypes.INTEGER, defaultValue: 0 },
  imagePath: { type: DataTypes.STRING },
}, { tableName: 'disposal_events' });

// ─── RewardTransaction ───
const RewardTransaction = sequelize.define('RewardTransaction', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  eventId: { type: DataTypes.UUID },
  type: { type: DataTypes.ENUM('earned', 'redeemed'), allowNull: false },
  points: { type: DataTypes.INTEGER, allowNull: false },
  description: { type: DataTypes.STRING },
}, { tableName: 'reward_transactions' });

// ─── AirtimeRedemption ───
const AirtimeRedemption = sequelize.define('AirtimeRedemption', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  pointsRedeemed: { type: DataTypes.INTEGER, allowNull: false },
  airtimeAmountUgx: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  phoneNumber: { type: DataTypes.STRING, allowNull: false },
  atTransactionId: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('pending', 'successful', 'failed'), defaultValue: 'pending' },
  errorMessage: { type: DataTypes.STRING },
}, { tableName: 'airtime_redemptions' });

// ─── SmartUnit (Kiosk) ───
const SmartUnit = sequelize.define('SmartUnit', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  unitName: { type: DataTypes.STRING, allowNull: false },
  location: { type: DataTypes.STRING, allowNull: false },
  unitCode: { type: DataTypes.STRING(12), unique: true },
  status: { type: DataTypes.ENUM('active', 'offline', 'maintenance'), defaultValue: 'active' },
  lastSeenAt: { type: DataTypes.DATE },
  currentBottleCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  capacity: { type: DataTypes.INTEGER, defaultValue: 300 },
}, { tableName: 'smart_units' });

SmartUnit.beforeCreate((unit) => {
  unit.unitCode = 'KIOSK-' + Math.random().toString(36).substring(2, 6).toUpperCase();
});

// ─── Admin ───
const Admin = sequelize.define('Admin', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
  password: { type: DataTypes.STRING, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'admins' });

Admin.beforeCreate(async (admin) => {
  admin.password = await bcrypt.hash(admin.password, 12);
});

Admin.prototype.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

Admin.prototype.toSafeJSON = function () {
  const { password, ...safe } = this.toJSON();
  return safe;
};

// ─── Associations ───
User.hasOne(RewardBalance, { foreignKey: 'userId', as: 'balance' });
RewardBalance.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(DisposalSession, { foreignKey: 'userId', as: 'sessions' });
DisposalSession.belongsTo(User, { foreignKey: 'userId' });

DisposalSession.hasMany(DisposalEvent, { foreignKey: 'sessionId', as: 'events' });
DisposalEvent.belongsTo(DisposalSession, { foreignKey: 'sessionId' });

User.hasMany(DisposalEvent, { foreignKey: 'userId', as: 'disposalEvents' });
User.hasMany(RewardTransaction, { foreignKey: 'userId', as: 'transactions' });

User.hasMany(AirtimeRedemption, { foreignKey: 'userId', as: 'redemptions' });
AirtimeRedemption.belongsTo(User, { foreignKey: 'userId', as: 'user' });   // ← added: lets admin redemptions list include the user

// ─── Kiosk Associations ───
SmartUnit.hasMany(DisposalSession, { foreignKey: 'unitId', as: 'sessions' });
DisposalSession.belongsTo(SmartUnit, { foreignKey: 'unitId', as: 'unit' });

SmartUnit.hasMany(DisposalEvent, { foreignKey: 'unitId', as: 'events' });
DisposalEvent.belongsTo(SmartUnit, { foreignKey: 'unitId', as: 'unit' });

module.exports = { User, RewardBalance, DisposalSession, DisposalEvent, RewardTransaction, AirtimeRedemption, SmartUnit, Admin };