// firebase-config.js — ONE place to paste your Firebase project config.
// Used by BOTH the storefront (home.html) and the admin console (admin.html):
//   · social sign-in on the storefront
// OPTIONAL — only needed for Google/Facebook/Twitter customer login. The
// database/sync uses Cloudflare D1 (worker.js) and does NOT need this.
window.PPS_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
