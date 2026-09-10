import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-analytics.js";

// Firebase configuration is intentionally supplied at deployment time for Think Union Credit Bank.
const firebaseConfig = window.__FIREBASE_CONFIG__;
if (firebaseConfig && firebaseConfig.projectId) {
  try {
    const app = initializeApp(firebaseConfig);
    isSupported()
      .then((supported) => {
        if (supported) getAnalytics(app);
      })
      .catch(() => {});
  } catch (error) {
    console.warn('Firebase analytics failed to initialise.', error);
  }
}
