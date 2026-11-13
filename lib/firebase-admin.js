const DEFAULT_PROJECT_ID = 'tcub-b96a6';
function getResolvedProjectId() { return String(process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID); }
function getFirestoreAdminDiagnostics() {
  return { runtime: process.env.NETLIFY ? 'netlify' : 'serverless', isServerless: true, projectIdResolved: getResolvedProjectId(), projectIdSet: Boolean(process.env.FIREBASE_PROJECT_ID), hasAdminCredentials: false, clientEmailSet: false, clientEmailLooksValid: false, privateKeySet: false, privateKeyRawLength: 0, normalizedPrivateKeyLength: 0, privateKeyValid: false, privateKeyReason: 'Firebase Admin SDK is disabled in this deployment; local SQLite is authoritative for the current adapter.', initError: null };
}
function logFirestoreDiagnostics() {}
function hasAdminCredentials() { return false; }
function normalizePrivateKey(value) { return String(value || '').replace(/\\n/g, '\n'); }
function getFirebaseAdminApp() { return null; }
function getFirestore() { return null; }
function getFirebaseAuth() { return null; }
function isFirebaseUserNotFound() { return false; }
async function syncLocalUserToFirebaseAuth() { return { synced: false, skipped: true, reason: 'firebase-admin-disabled-in-worker' }; }
const admin = null;
module.exports = { admin, hasAdminCredentials, normalizePrivateKey, getFirebaseAdminApp, getFirestore, getFirebaseAuth, syncLocalUserToFirebaseAuth, getFirestoreAdminDiagnostics, logFirestoreDiagnostics, getResolvedProjectId, isFirebaseUserNotFound };
