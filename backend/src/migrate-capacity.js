require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('./config/database');
const { SmartUnit } = require('./models');

// One-time data migration: raise existing kiosks' bin capacity to the new default.
// (Schema itself is handled by sync({ alter: true }); this only fixes stored row
// values, which sync never rewrites. New kiosks already default to 300, and the
// kiosk also pushes its capacity on boot — this just makes it immediate.)
const NEW_CAPACITY = 300;

const run = async () => {
  try {
    // Keep output to just the summary — silence Sequelize's per-query logging, which
    // is otherwise on when NODE_ENV=development (as it was for the local run).
    sequelize.options.logging = false;
    await sequelize.authenticate();
    await sequelize.sync({ alter: true, logging: false }); // ensure columns exist, quietly

    const before = await SmartUnit.findAll();
    console.log(`Found ${before.length} kiosk(s).`);

    // Only bump kiosks currently below the new default (or with a null capacity);
    // never shrink a kiosk that was intentionally set larger.
    const [updated] = await SmartUnit.update(
      { capacity: NEW_CAPACITY },
      { where: { [Op.or]: [{ capacity: null }, { capacity: { [Op.lt]: NEW_CAPACITY } }] } }
    );
    console.log(`✅ Updated ${updated} kiosk(s) to capacity ${NEW_CAPACITY}.`);

    for (const k of await SmartUnit.findAll()) {
      console.log(`   • ${k.unitName} (${k.unitCode}) → capacity ${k.capacity}, bottles ${k.currentBottleCount || 0}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

run();
