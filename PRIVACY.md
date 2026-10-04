# Privacy

Multi-Column for X collects **no data**. Specifically:

- It makes **no network requests of its own**. It reads the timeline data your browser already downloads from x.com, in
  your browser, to lay it out in columns. Nothing is sent to the developer or anyone else.
- It has **no analytics, telemetry, accounts or remote code**.
- Your settings, muted words, and download history are stored **only in your browser** (`storage.local`).
- The **Download** button saves media from X's own servers (`pbs.twimg.com`, `video.twimg.com`) using your browser's
  downloads feature. If you turn on the optional aria2 hand-off, the file addresses are sent to the aria2 service **on your own
  computer** (localhost) that you configure.
- "Copy diagnostics" only copies text to your clipboard (request names and counts, no post text, names or cookies). It is never sent anywhere.

The extension needs access to x.com and twitter.com to do its job, and the `downloads` permission only for the Download button.
Source code: see the repository (it has no build step; what you read is what runs).
