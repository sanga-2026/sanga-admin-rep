# Sanga Admin
- Plain HTML, CSS and JavaScript. No framework. `public/` is the website; `server.js` serves only that folder.
- Same Firebase project as the Sanga app (same Firestore, same phone + PIN accounts). `public/login.html`, `public/js/firebase-config.js` and `public/js/sanga-auth.js` are copies of the app's files: keep them in step with the main sanga repo.
- Every admin page is hidden until `public/js/admin-session.js` confirms the person is logged in and has a record in the Firestore `admins` collection. Keep that pattern for any new page: lock snippet in `<head>`, then the Firebase scripts, `sanga-auth.js`, `admin-session.js`.
- Admin records are created only by a main admin (Firestore rules). Never read the `users` collection from the browser: it holds PIN hashes. Use a Cloud Function.
- `firestore.rules` and the Cloud Functions live in the MAIN sanga repo; `main-repo-changes/` holds the versions this site needs.
- The review queue's events and decisions are still sample data until events move into Firestore.
- Never put API keys or secrets in any file. Work on a branch and open a pull request; never push to main.
- `public/event_detail_view.html`, `js/firebase-config.js` and `js/sanga-auth.js` must stay IDENTICAL to the app repo's copies. `js/sanga-nav.js`, `js/sanga-data.js` and `login.html` share names with app files but are different on purpose: never overwrite them with the app's versions.
