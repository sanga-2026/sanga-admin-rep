# Sanga Admin

The employee-only website for Sanga. It is a **separate site** from the Sanga app, but it uses the **same Firebase project**: the same Firestore database and the same phone + PIN accounts.

## What is in this folder
```
public/                 the website (the only folder the server exposes)
  index.html            opens the review queue
  login.html            the SAME phone + PIN login as the app (shared from the app)
  admin_review.html     review queue: approve / reject, filtered by each admin's limits
  admin_settings.html   main admin only: promote people, set each admin's limits
  event_detail_view.html  an event as a reviewer sees it (no Book, no messaging)
  host_profile_view.html  a host's profile as a reviewer sees it
  js/                   firebase-config.js + sanga-auth.js (shared from the app), admin-session.js (new)
server.js · Dockerfile · package.json     the Cloud Run server (serves public/ only; no API key needed)
main-repo-changes/      three files that belong in the MAIN sanga repo (see step 1)
```

## What is real and what is still sample
- **Real:** login, the "is this person an admin?" check, and Admin Settings (the people list, promoting, limits, removing). These use Firestore.
- **Still sample:** the events in the review queue, the approve/reject decisions (saved in each browser only) and the host profiles. They become real when events move into Firestore. Until then, an admin's limits are applied in the page only; add rules that enforce them on the server when events are in Firestore.

## One-time setup
1. **Update the main sanga repo** (this is shared project-wide). Copy these three files over the files of the same name in the main repo: `main-repo-changes/firestore.rules`, `main-repo-changes/functions/index.js` and `main-repo-changes/public/profile/user_profile_view.html`. Then in Cloud Shell, from a copy of the main repo:
   `firebase deploy --only functions,firestore:rules`
   Afterwards open Cloud Run, find the `adminListUsers` and `getPublicProfile` services (they may appear in lowercase) and turn on **Security → Allow public access** for each, as for the other functions.
2. **GitHub:** create a private repository named `sanga-admin` and upload everything in this zip.
3. **Cloud Run:** Create service → deploy from the `sanga-admin` repository with Cloud Build (branch `^main$`, Build Type **Dockerfile**, source `/Dockerfile`). Name it `sanga-admin`, region `us-central1`, **Allow public access**. No API key or variables are needed.
4. **Firebase → Authentication → Settings → Authorized domains:** add the new `sanga-admin-…run.app` address (without `https://`).
5. **Create the first main admin.** Open the admin site and log in with your phone + PIN. You will see "This account isn't an admin" with an **account ID**. In Firebase → Firestore Database, create a collection named `admins`, add a document whose **Document ID is that account ID**, with fields `role` (string) = `main` and `name` (string) = your name. Reload the admin site.
6. Promote everyone else from **Admin Settings**.

## Good to know
- "Allow public access" only lets people open the website. Every admin page stays hidden until the sign-in check passes, and the database rules, not the pages, protect the data. Rules allow only a main admin to create or change admin records.
- The admin site never reads user records directly: they hold each person's PIN hash. Names and phone numbers come from the `adminListUsers` function. In the same way, the app's profile view of other people asks the `getPublicProfile` function, which applies each person's privacy settings on the server and never returns a phone number or PIN data.
- A custom address such as `admin.yourdomain.com`: Cloud Run → Domain mappings, then add it to the authorized domains in step 4.
