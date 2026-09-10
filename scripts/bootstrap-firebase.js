#!/usr/bin/env node

const admin = require('firebase-admin');

const required = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'FIREBASE_ADMIN_UID'
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const privateKey = String(process.env.FIREBASE_PRIVATE_KEY)
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '\r');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey
  })
});

const auth = admin.auth();
const firestore = admin.firestore();
const uid = process.env.FIREBASE_ADMIN_UID;
const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
const displayName = `${process.env.ADMIN_FIRST_NAME || 'System'} ${process.env.ADMIN_LAST_NAME || 'Administrator'}`.trim();

async function ensureAuthUser() {
  let user;
  try {
    user = await auth.getUser(uid);
    user = await auth.updateUser(uid, {
      email,
      password: process.env.ADMIN_PASSWORD,
      displayName,
      emailVerified: true,
      disabled: false
    });
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({
      uid,
      email,
      password: process.env.ADMIN_PASSWORD,
      displayName,
      emailVerified: true,
      disabled: false
    });
  }

  await auth.setCustomUserClaims(uid, {
    role: 'super_admin',
    is_admin: true,
    tcub_admin: true
  });
  return user;
}

async function bootstrap() {
  const user = await ensureAuthUser();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const adminProfile = {
    auth_uid: uid,
    user_id: null,
    user_ref: uid,
    email,
    first_name: process.env.ADMIN_FIRST_NAME || 'System',
    last_name: process.env.ADMIN_LAST_NAME || 'Administrator',
    phone: process.env.ADMIN_PHONE || '',
    role: 'super_admin',
    active: true,
    is_super_admin: true,
    updated_at: now,
    created_at: now,
    provisioned_by: 'scripts/bootstrap-firebase.js'
  };
  const userProfile = {
    auth_uid: uid,
    email,
    first_name: process.env.ADMIN_FIRST_NAME || 'System',
    last_name: process.env.ADMIN_LAST_NAME || 'Administrator',
    phone: process.env.ADMIN_PHONE || '',
    role: 'super_admin',
    is_admin: 1,
    is_verified: 1,
    is_frozen: 0,
    created_at: now,
    updated_at: now
  };

  await Promise.all([
    firestore.collection('admins').doc(uid).set(adminProfile, { merge: true }),
    firestore.collection('users').doc(uid).set(userProfile, { merge: true })
  ]);

  console.log(`Firebase admin ready: ${user.email} (${user.uid})`);
  console.log('Firestore documents written: admins/' + uid + ' and users/' + uid);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
