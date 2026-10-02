# Sanga Admin

The employee-only website for Sanga. It is a **separate site** from the Sanga app, but it uses the **same Firebase project**: the same Firestore database and the same phone + PIN accounts.

## What is in this folder
```
public/                 the website (the only folder the server exposes)
  index.html            opens the review queue
  login.html            the SAME phone + PIN login as the app (shared from the app)
  admin_review.html     review queue: approve / reject, filtered by each admin's limits
  admin_settings.html   main admin only: promote people, set each admin's limits
  event_detail_view.html  an event as a reviewer sees it. IDENTICAL to the app's page of the same name (see "Shared files")
  host_profile_view.html  the FULL profile of a person: opens for MAIN admins only (everything they wrote, with what they hid from others marked)
  user_profile_view.html  the privacy-filtered profile, the same view the app shows: this is what a normal admin gets
  js/                   firebase-config.js + sanga-auth.js (shared from the app), admin-session.js (new)
server.js · Dockerfile · package.json     the Cloud Run server (serves public/ only; no API key needed)
main-repo-changes/      three files that belong in the MAIN sanga repo (see step 1)
```

## What is real and what is still sample
- **Real:** login, the "is this person an admin?" check, and Admin Settings (the people list, promoting, limits, removing). These use Firestore.
- **Still sample:** the events in the review queue, and the approve/reject decisions (saved in each browser only). Hosts on sample events have no account ID yet, so their profile pages show just the name; use **View profile** in Admin Settings to open a real profile. All of this becomes real when events move into Firestore. Until then, an admin's limits are applied in the page only; add rules that enforce them on the server when events are in Firestore.

## One-time setup
1. **Update the main sanga repo** (this is shared project-wide). Copy these three files over the files of the same name in the main repo: `main-repo-changes/firestore.rules`, `main-repo-changes/functions/index.js` and `main-repo-changes/public/profile/user_profile_view.html`. Then in Cloud Shell, from a copy of the main repo:
   `firebase deploy --only functions,firestore:rules`
   Afterwards open Cloud Run, find the `adminListUsers`, `getPublicProfile` and `adminGetProfile` services (they may appear in lowercase) and turn on **Security → Allow public access** for each, as for the other functions.
2. **GitHub:** create a private repository named `sanga-admin` and upload everything in this zip.
3. **Cloud Run:** Create service → deploy from the `sanga-admin` repository with Cloud Build (branch `^main$`, Build Type **Dockerfile**, source `/Dockerfile`). Name it `sanga-admin`, region `us-central1`, **Allow public access**. No API key or variables are needed.
4. **Firebase → Authentication → Settings → Authorized domains:** add the new `sanga-admin-…run.app` address (without `https://`).
5. **Create the first main admin.** Open the admin site and log in with your phone + PIN. You will see "This account isn't an admin" with an **account ID**. In Firebase → Firestore Database, create a collection named `admins`, add a document whose **Document ID is that account ID**, with fields `role` (string) = `main` and `name` (string) = your name. Reload the admin site.
6. Promote everyone else from **Admin Settings**.

## Good to know
- "Allow public access" only lets people open the website. Every admin page stays hidden until the sign-in check passes, and the database rules, not the pages, protect the data. Rules allow only a main admin to create or change admin records.
- The admin site never reads user records directly: they hold each person's PIN hash. Names and phone numbers come from the `adminListUsers` function. In the same way, the app's profile view of other people asks the `getPublicProfile` function, which applies each person's privacy settings on the server and never returns a phone number or PIN data.
- A custom address such as `admin.yourdomain.com`: Cloud Run → Domain mappings, then add it to the authorized domains in step 4.
- **Profiles.** When a main admin opens a host, they get the full profile (`host_profile_view.html`, through the `adminGetProfile` function), including what the person chose to hide from other people. A normal admin gets the privacy-filtered profile (`user_profile_view.html`, through `getPublicProfile`). Neither page ever receives a phone number or PIN data. Every full look is recorded in the Firestore collection `adminAccessLog` (who looked, at whom, when); only the function can write it and browsers cannot read it. Tell your users, in your privacy policy, that staff can see profile content for moderation.

## Shared files (keep them in step with the app repo)
Identical in the app repo and here, so each is maintained once. When you change one, copy it to the other repo:
- `event_detail_view.html` (in the app it lives at `public/events/`, here at `public/`; the content is the same)
- `js/firebase-config.js`
- `js/sanga-auth.js`

Same file name, DIFFERENT content on purpose (never copy these across):
- `js/sanga-nav.js`: the app draws Home + Profile icons; here it also runs the admin check and sends host links to the right profile page.
- `js/sanga-data.js`: the app's real data layer; empty here.
- `login.html`: sends admins to the review queue.
- **Switching pages.** A full-access (main) admin sees a small round icon at the top right of the review queue (to Admin Settings) and of Admin Settings (back to the review queue). Normal admins never see it.
- **Asking for admin access.** Anyone who logs in to the admin site with a normal Sanga account and is not an admin is asked for access automatically. They see "Your request for admin access is under review. It might take up to 24 hours for approval. Once your request is approved, you will be able to log in." Their request appears at the top of Admin Settings for a main admin, who approves or rejects it. Approving makes them an admin with no limits yet (set limits afterwards). No message is sent: the person logs in again once approved. The first main admin is still created by hand (see step 5).
