// Chrome runs the background as a service worker, which lists no scripts in the manifest: it loads them itself.
importScripts('src/settings.js', 'background.js');
