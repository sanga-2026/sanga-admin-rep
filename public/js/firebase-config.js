/*
  /js/firebase-config.js
  ------------------------------------------------------------------
  Initializes Firebase for this app and exposes the shorthand globals
  that /js/sanga-auth.js (and any other page) relies on:
    sanghaAuthSDK   -> firebase.auth()
    sanghaDb        -> firebase.firestore()
    sanghaFunctions -> firebase.functions()

  Must load, in this exact order:
    1. The four firebase-*-compat.js SDK scripts (from gstatic)
    2. THIS FILE
    3. /js/sanga-data.js
    4. /js/sanga-auth.js

  This file must exist on every deployed copy of the app. If it's ever
  missing, /js/sanga-auth.js fails silently on load (sanghaFunctions is
  not defined), which breaks login checks and buttons across the
  whole site without any obvious error on screen — check the browser
  console (F12) if that ever happens again.
------------------------------------------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyDwjUSL-lLlIdU2Rp91yXIN2sljNG1r5tI",
  authDomain: "sanga-firebase-prod.firebaseapp.com",
  projectId: "sanga-firebase-prod",
  storageBucket: "sanga-firebase-prod.firebasestorage.app",
  messagingSenderId: "342874418486",
  appId: "1:342874418486:web:814b0133a480b1004d1797",
  measurementId: "G-TMZJM4CGEE"
};

firebase.initializeApp(firebaseConfig);

const sanghaAuthSDK = firebase.auth();
const sanghaDb = firebase.firestore();
const sanghaFunctions = firebase.functions();

// Explicitly keep the sign-in session across browser restarts, not just
// across tabs/reloads. This should already be Firebase's default, but
// setting it directly removes any doubt — if a device still loses its
// session after this, the cause is outside Firebase entirely (a browser
// or OS setting clearing site storage on exit, most likely).
sanghaAuthSDK.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => {
  console.warn('Could not set auth persistence:', e);
});
