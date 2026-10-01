// Sanga admin — static server for Cloud Run.
// Serves ONLY the public/ folder. Nothing else in this project (this file, package.json, the
// Dockerfile, main-repo-changes/) is ever reachable from a browser. There is no API key here:
// the admin site talks straight to Firebase (same project as the Sanga app).
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.listen(PORT, () => console.log(`Sanga admin listening on port ${PORT}`));
