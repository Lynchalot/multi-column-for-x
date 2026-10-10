# Privacy

Multi-Column for X collects **no data**. Specifically:

- It makes **no network requests of its own**. It reads the timeline data your browser already downloads from x.com, in
  your browser, to lay it out in columns. Nothing is sent to the developer or anyone else.
- It has **no analytics, telemetry, accounts or remote code**.
- Your settings, muted words, and download history are stored **only in your browser** (`storage.local`).
- If you turn on **Posts I’ve already read** (off by default), the numbers of the last few thousand posts you have looked at are kept in the same place, so they can be hidden or faded next time. Nothing else about them is kept. Turning the setting off stops it, and **Forget which posts I’ve read** on the settings page deletes the list.
- The **Download** button saves media from X's own servers (`pbs.twimg.com`, `video.twimg.com`) using your browser's
  downloads feature.
- Three small markers are kept in x.com's own page storage (`localStorage`): the address of the page the columns last showed on (so X's own page can be kept out of sight while the columns start), whether **Skip X's age check** is on, and whether the **Enabled** switch is off (so that nothing is touched before X has started). They hold no account or post information.
- The comment box's **picture** button hands the file you choose to X's own reply box, which uploads it, as if you had chosen it there; nothing goes anywhere else. The **GIF** button opens X's own reply box in a new tab (an address on x.com with the post's number and the words you have written so far in it). The **emoji** picker keeps the last sixteen emoji you used in x.com's page storage (`xmc.emoji`), nothing else.
- **Skip X's age check on sensitive media** (on by default) switches off one of X's own feature flags in your browser, the one that makes X ask for age verification. Nothing is requested from X differently, and nothing is sent anywhere.
- **Translate** presses X's own translate button on X's own page and shows the result inside the extension. Nothing is sent to any other service.
- "Copy diagnostics" only copies text to your clipboard (request names and counts, a short log of what the extension did with post numbers, and the page's colours). When a step fails (a translation, loading more comments, a profile popup) it also keeps a few short snippets of what X's page showed at that moment, about 50 characters each: the first words of the post, the labels of its buttons (which can include the author's name), the last few lines of a conversation, the words of a popup. It also has an outline of one of X's menu links (tag names and the word of its name, such as "Explore"). No cookies, tokens or account details. It is only copied when you press the button, and it is never sent anywhere. Read it before you paste it.
- A small **report of what worked** (which of the extension's features worked or failed, with a reason such as "button not found", what it found on x.com's page, and counts of posts read) is kept in the same place, for the settings page to show. No post text. **Save sample** writes a file to your downloads with the shape of what X sent and the markup of some buttons, with the words, names and addresses removed; nothing is sent anywhere, and you choose whether to send it.
- A short **event log** (about the last 300 events: what kind of event, when, and the numbers of the posts involved; no post text and no addresses, only what kind of page you were on) is kept in the same place, so that Copy diagnostics can show what happened before a reload. It is on by default, never sent anywhere, and **Keep a short log for Copy diagnostics** under Troubleshooting in the settings turns it off and deletes it.

The extension needs access to x.com and twitter.com to do its job, and the `downloads` permission only for the Download button.
Source code: see the repository (it has no build step; what you read is what runs).
