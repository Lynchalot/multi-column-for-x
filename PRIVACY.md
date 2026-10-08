# Privacy

Multi-Column for X collects **no data**. Specifically:

- It makes **no network requests of its own**. It reads the timeline data your browser already downloads from x.com, in
  your browser, to lay it out in columns. Nothing is sent to the developer or anyone else.
- It has **no analytics, telemetry, accounts or remote code**.
- Your settings, muted words, and download history are stored **only in your browser** (`storage.local`).
- If you turn on **Posts I’ve already read** (off by default), the numbers of the last few thousand posts you have looked at are kept in the same place, so they can be hidden or faded next time. Nothing else about them is kept. Turning the setting off stops it, and **Forget which posts I’ve read** on the settings page deletes the list.
- The **Download** button saves media from X's own servers (`pbs.twimg.com`, `video.twimg.com`) using your browser's
  downloads feature.
- Two small markers are kept in x.com's own page storage (`localStorage`): the address of the page the columns last showed on (so X's own page can be kept out of sight while the columns start) and whether **Skip X's age check** is on. They hold no account or post information.
- **Skip X's age check on sensitive media** (on by default) switches off one of X's own feature flags in your browser, the one that makes X ask for age verification. Nothing is requested from X differently, and nothing is sent anywhere.
- **Translate** presses X's own translate button on X's own page and shows the result inside the extension. Nothing is sent to any other service.
- "Copy diagnostics" only copies text to your clipboard (request names and counts, a short log of what the extension did with post numbers, and the page's colours). When a step fails (a translation, loading more comments, a profile popup) it also keeps a few short snippets of what X's page showed at that moment, about 50 characters each: the first words of the post, the labels of its buttons (which can include the author's name), the last few lines of a conversation, the words of a popup. It also has an outline of one of X's menu links (tag names and the word of its name, such as "Explore"). No cookies, tokens or account details. It is only copied when you press the button, and it is never sent anywhere. Read it before you paste it.

The extension needs access to x.com and twitter.com to do its job, and the `downloads` permission only for the Download button.
Source code: see the repository (it has no build step; what you read is what runs).
