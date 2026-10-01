/*
  Sangha Cloud Functions — phone/device lookup + PIN set/verify
  ------------------------------------------------------------------
  The 6-digit PIN is the second factor after SMS OTP (same pattern as
  Flagship). It's hashed here, server-side, with bcrypt — never stored
  or checked in Firestore-readable client code, and never sent back.

  Device tracking: each account keeps a list of up to MAX_KNOWN_DEVICES
  device IDs that have successfully completed OTP + PIN before. This is
  informational only (powers the "logged in from more than 5 devices"
  alert) — it does NOT gate whether OTP is required. A device can only
  skip OTP if the browser itself already holds a live Firebase session
  from a previous sign-in; there's no way to bypass Firebase's own
  phone-auth flow with just a device ID. See sangha-auth.js /
  login.html for how the two pieces fit together.

  Simple lockout: 5 wrong PIN attempts -> locked for 15 minutes.

  IMPORTANT: written using the firebase-functions v2 "onCall" syntax
  on purpose. These functions deploy as 2nd-gen (confirmed in every
  deploy log so far), and the older v1-style syntax
  (functions.https.onCall((data, context) => ...)) has a known,
  documented compatibility gap when deployed as 2nd-gen: the auth
  info silently isn't attached to the request the way v1 code expects
  (context.auth stays undefined even for genuinely signed-in callers).
  This was the real cause of the persistent "Must be signed in" /
  401 error — not a permissions setting, not the frontend's token
  timing. The v2 syntax below (request.auth instead of context.auth)
  is the officially correct, fully-supported way to write a 2nd-gen
  callable function, and avoids this mismatch entirely.
------------------------------------------------------------------ */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');

admin.initializeApp();
const db = admin.firestore();

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_KNOWN_DEVICES = 5;

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  return request.auth.uid;
}

function assertSixDigits(pin) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'PIN must be exactly 6 digits.');
  }
}

// Adds/refreshes a device in the known-devices list, evicting the oldest
// (least-recently-used) entry if that would push the list past the cap.
// Returns the updated list.
function recordDevice(knownDevices, deviceId) {
  let list = Array.isArray(knownDevices) ? knownDevices.slice() : [];
  const now = admin.firestore.Timestamp.now();
  if (!deviceId) return list;
  const idx = list.findIndex((d) => d.deviceId === deviceId);
  if (idx >= 0) {
    list[idx] = { deviceId, lastUsed: now };
  } else {
    list.push({ deviceId, lastUsed: now });
  }
  list.sort((a, b) => a.lastUsed.toMillis() - b.lastUsed.toMillis());
  while (list.length > MAX_KNOWN_DEVICES) {
    list.shift();
  }
  return list;
}

// Called right after the person enters their phone number, before OTP is
// ever sent. Looks up whether an account exists for that number at all,
// and how many devices it's known from — purely so the login screen can
// show the "more than 5 devices" alert when relevant. Does not require
// the caller to be signed in (they can't be yet at this point) and only
// ever returns non-sensitive routing info — never the PIN hash itself.
exports.checkPhoneDevice = onCall(async (request) => {
  const phone = request.data.phone;
  if (typeof phone !== 'string' || !phone) {
    throw new HttpsError('invalid-argument', 'A phone number is required.');
  }

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByPhoneNumber(phone);
  } catch (e) {
    return { accountExists: false, deviceCount: 0 };
  }

  const doc = await db.collection('users').doc(userRecord.uid).get();
  const data = doc.exists ? doc.data() : {};
  const knownDevices = Array.isArray(data.knownDevices) ? data.knownDevices : [];

  return {
    accountExists: true,
    pinSet: !!data.pinSet,
    deviceCount: knownDevices.length,
  };
});

exports.setUserPin = onCall(async (request) => {
  const uid = requireAuth(request);
  const pin = request.data.pin;
  const deviceId = request.data.deviceId;
  assertSixDigits(pin);

  const hash = await bcrypt.hash(pin, 10);
  await db.collection('users').doc(uid).set({
    pinHash: hash,
    pinSet: true,
    pinAttempts: 0,
    pinLockedUntil: null,
    knownDevices: recordDevice([], deviceId),
  }, { merge: true });

  return { success: true };
});

exports.verifyUserPin = onCall(async (request) => {
  const uid = requireAuth(request);
  const pin = request.data.pin;
  const deviceId = request.data.deviceId;
  assertSixDigits(pin);

  const ref = db.collection('users').doc(uid);
  const doc = await ref.get();
  if (!doc.exists || !doc.data().pinHash) {
    throw new HttpsError('failed-precondition', 'No PIN set for this account yet.');
  }
  const user = doc.data();

  if (user.pinLockedUntil && user.pinLockedUntil.toMillis() > Date.now()) {
    const minsLeft = Math.ceil((user.pinLockedUntil.toMillis() - Date.now()) / 60000);
    throw new HttpsError('resource-exhausted', `Too many attempts. Try again in ${minsLeft} min.`);
  }

  const ok = await bcrypt.compare(pin, user.pinHash);

  if (!ok) {
    const attempts = (user.pinAttempts || 0) + 1;
    const patch = { pinAttempts: attempts };
    if (attempts >= MAX_ATTEMPTS) {
      patch.pinLockedUntil = admin.firestore.Timestamp.fromMillis(Date.now() + LOCK_MS);
      patch.pinAttempts = 0;
    }
    await ref.update(patch);
    return { success: false, attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts) };
  }

  const updatedDevices = recordDevice(user.knownDevices, deviceId);
  await ref.update({ pinAttempts: 0, pinLockedUntil: null, knownDevices: updatedDevices });
  return { success: true, deviceCount: updatedDevices.length };
});

/* ------------------------------------------------------------------
  adminListUsers — used by the Sanga ADMIN site's "Admin Settings" page.

  Returns everyone who has an account as { id, name, phone } so a main admin can pick people to
  promote. It returns ONLY those three fields — never the PIN hash, lock-out counters or devices
  that sit on the same user record — and only for a caller who is a MAIN admin
  (admins/<uid>.role == 'main'). It must have "Allow public access" in Cloud Run like the other
  callable functions; the check happens inside.
  (Lists the first 1,000 accounts; add paging when there are more.)
------------------------------------------------------------------ */
exports.adminListUsers = onCall(async (request) => {
  requireAuth(request);
  const me = await db.collection('admins').doc(request.auth.uid).get();
  if (!me.exists || me.data().role !== 'main') {
    throw new HttpsError('permission-denied', 'Main admins only.');
  }
  const list = await admin.auth().listUsers(1000);
  const refs = list.users.map((u) => db.collection('users').doc(u.uid));
  const docs = refs.length ? await db.getAll(...refs) : [];
  const names = {};
  docs.forEach((d) => { if (d.exists) names[d.id] = (d.data().name || ''); });
  return { users: list.users.map((u) => ({ id: u.uid, phone: u.phoneNumber || '', name: names[u.uid] || '' })) };
});

/* ------------------------------------------------------------------
  getPublicProfile — used by the app's "view someone's profile" page.

  Reads one person's PRIVATE record here on the server, applies THEIR privacy settings, and returns
  only what they allow other people to see: name, photo, bio, today's intention, interests,
  "Love to learn", and the city only if they show it. The phone number, PIN hash, lock-out counters
  and device list never leave the server. Only logged-in people can call it (to let visitors who are
  not logged in view profiles, remove the requireAuth line). A private profile (showProfile off)
  returns only the name and that fact.
  Like the other callable functions it needs "Allow public access" in Cloud Run; the check
  happens inside.
------------------------------------------------------------------ */
const cleanStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const cleanList = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, maxItems).map((x) => x.slice(0, maxLen)) : []);

exports.getPublicProfile = onCall(async (request) => {
  requireAuth(request);
  const id = request.data && request.data.id;
  if (typeof id !== 'string' || !id.trim() || id.length > 128 || id.includes('/')) {
    throw new HttpsError('invalid-argument', 'A profile id is required.');
  }
  const snap = await db.collection('users').doc(id.trim()).get();
  if (!snap.exists) return { exists: false };

  const d = snap.data() || {};
  const p = (d.privacy && typeof d.privacy === 'object') ? d.privacy : {};
  const privacy = {};
  ['showProfile', 'showCity', 'allowMessages', 'showReservations'].forEach((k) => {
    if (typeof p[k] === 'boolean') privacy[k] = p[k];
  });
  const name = cleanStr(d.name, 120);

  if (privacy.showProfile === false) {
    return { exists: true, name, privacy: { showProfile: false } };
  }

  const out = {
    exists: true,
    name,
    privacy,
    bio: cleanStr(d.bio, 2000),
    intentionLabel: cleanStr(d.intentionLabel, 80),
    intentionText: cleanStr(d.intentionText, 500),
    interests: cleanList(d.interests, 50, 60),
    practices: cleanList(d.practices, 50, 60),
  };
  if (typeof d.avatarDataUrl === 'string' && d.avatarDataUrl.startsWith('data:image/') && d.avatarDataUrl.length < 400000) {
    out.avatarDataUrl = d.avatarDataUrl;
  }
  if (privacy.showCity !== false && d.location && typeof d.location === 'object') {
    out.location = {
      city: cleanStr(d.location.city, 80),
      state: cleanStr(d.location.state, 80),
      country: cleanStr(d.location.country, 80),
    };
  }
  return out;
});
