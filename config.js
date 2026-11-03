'use strict';
/* Where the app downloads the daily price files (prices.json, history.json) from, as a base URL ending in "/",
   e.g. 'https://riftscan.vercel.app/'. The files are fetched from <DATA_BASE>data/ at most once every 24 h.
   Empty (the default): the web app reads data/ from its own origin, which is redeployed with every daily update,
   and the native app uses the copy bundled when it was built. Set this before shipping the native app. */
window.RIFTSCAN = { DATA_BASE: '' };
