#!/usr/bin/env node
/**
 * End-to-end smoke test for the rapid-mode / live-total backend endpoints:
 *   POST /api/disposal/sessions/start
 *   POST /api/disposal/events/batch
 *   GET  /api/disposal/sessions/:id        (live totals — what the phone polls)
 *   POST /api/disposal/sessions/end
 * plus a balance check via GET /api/auth/profile.
 *
 * Registers a throwaway user each run, so it's safe to run repeatedly.
 *
 * Usage (Node 18+, no npm deps — uses global fetch):
 *   node scripts/test-batch.js
 *   node scripts/test-batch.js https://eco-lens-production.up.railway.app
 *   BASE_URL=http://localhost:3000 node scripts/test-batch.js
 */

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const N_PLASTIC = 7; // accepted bottles to simulate
const N_REJECT = 3;  // rejected items to simulate

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, data };
}

function check(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log('  ✓ ' + msg);
}

(async () => {
  console.log('Testing against ' + BASE + '\n');

  // 1) Register a throwaway user → JWT + userCode
  const email = 'batchtest_' + Date.now() + '@example.com';
  const reg = await req('POST', '/api/auth/register', {
    name: 'Batch Test', email, password: 'secret123', phone: '+256755123456',
  });
  check(reg.status === 201, 'register user (' + reg.status + ')');
  const token = reg.data.token;
  const userCode = reg.data.user.userCode;
  check(!!token && !!userCode, 'got token + userCode ' + userCode);

  // 2) Start a session (unitId not needed for this test)
  const start = await req('POST', '/api/disposal/sessions/start', { userCode });
  check([200, 201].includes(start.status), 'start session (' + start.status + ')');
  const sessionId = start.data.session.id;
  check(!!sessionId, 'got sessionId ' + sessionId);

  // 3) Batch-post a mix of accepted + rejected events (as the kiosk would flush)
  const events = [];
  for (let i = 0; i < N_PLASTIC; i++) events.push({ classifiedAs: 'PET_bottle', confidence: 0.95, isPlastic: true });
  for (let i = 0; i < N_REJECT; i++) events.push({ classifiedAs: 'metal_can', confidence: 0.80, isPlastic: false });
  const batch = await req('POST', '/api/disposal/events/batch', { sessionId, events });
  check(batch.status === 201, 'batch post ' + events.length + ' events (' + batch.status + ')');
  check(batch.data.received === events.length, 'received ' + batch.data.received);
  check(batch.data.accepted === N_PLASTIC, 'accepted ' + batch.data.accepted + ' (expected ' + N_PLASTIC + ')');

  // 4) Live session totals (this is exactly what the mobile app polls)
  const live = await req('GET', '/api/disposal/sessions/' + sessionId, null, token);
  check(live.status === 200, 'get session totals (' + live.status + ')');
  check(live.data.totalItems === events.length, 'session totalItems ' + live.data.totalItems);
  check(live.data.acceptedItems === N_PLASTIC, 'session acceptedItems ' + live.data.acceptedItems);
  console.log('    → totalPoints for the session: ' + live.data.totalPoints);

  // 5) Owner check: another user must NOT be able to read this session
  const reg2 = await req('POST', '/api/auth/register', {
    name: 'Other', email: 'other_' + Date.now() + '@example.com', password: 'secret123', phone: '+256755000000',
  });
  const foreign = await req('GET', '/api/disposal/sessions/' + sessionId, null, reg2.data.token);
  check(foreign.status === 403, 'other user is blocked from this session (' + foreign.status + ')');

  // 6) Balance reflects the earned points
  const profile = await req('GET', '/api/auth/profile', null, token);
  check(profile.status === 200, 'get profile (' + profile.status + ')');
  check(profile.data.balance.currentPoints === live.data.totalPoints,
    'balance matches session points (' + profile.data.balance.currentPoints + ')');

  // 7) End the session, then confirm it reads "completed"
  const end = await req('POST', '/api/disposal/sessions/end', { sessionId });
  check(end.status === 200, 'end session (' + end.status + ')');
  const after = await req('GET', '/api/disposal/sessions/' + sessionId, null, token);
  check(after.data.status === 'completed', 'session reads completed after end');

  console.log('\n✅ All checks passed.');
})().catch((e) => {
  console.error('\n❌ Test failed: ' + e.message);
  process.exit(1);
});
