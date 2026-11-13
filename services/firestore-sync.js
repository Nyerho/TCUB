// Firebase Admin/Firestore is intentionally not used in the current Netlify adapter.
// Local SQLite is the authoritative store; these functions preserve
// the route module contract while allowing old sync hooks to remain harmless.
const { db } = require('../database');
const disabled = () => false;
const skipped = async () => ({ synced: false, skipped: true, reason: 'local-sqlite-authoritative' });
const empty = async () => null;
const zero = async () => 0;

module.exports = {
  isFirestoreEnabled: disabled,
  syncUserToFirestore: skipped,
  syncAccountToFirestore: skipped,
  syncTransactionToFirestore: skipped,
  syncAllUserTransactionsToFirestore: skipped,
  syncUserBundleToFirestore: skipped,
  syncConfiguredAdminToFirestore: skipped,
  hydrateUserFromFirestoreByEmail: empty,
  provisionAuthUserToFirestore: empty,
  hydrateUserFromFirestoreById: empty,
  hydrateAccountsForUser: zero,
  hydrateTransactionsForUser: zero,
  hydrateRecentCustomersFromFirestore: async () => [],
  firestoreUserExistsByEmail: async () => false,
  getFirestoreDashboardCustomerStats: async () => null,
  backfillLocalUsersToFirestore: zero,
  syncKycSubmissionToFirestore: skipped,
  syncUserKycReviewToFirestore: skipped,
  hydrateKycForUserFromFirestore: zero,
  hydratePendingKycFromFirestore: zero,
};
