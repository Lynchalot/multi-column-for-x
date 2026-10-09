# Trying a build on real X

Nobody working on this can log in to X, so this is the list of what only your own x.com can tell us, in the order that finds the most. Everything is
"does it look right", except 2 and 3, which send me something.

1. **Install and wait ten seconds on the home timeline** with the columns on. Do they draw? Is the Columns pill at the bottom of the menu?
2. **Settings, Troubleshooting, "What is working on x.com".** Screenshot the table. Every "On X's page" row should say *found*. A *not found* is a button or link X has changed.
3. **A post's `...` menu, "Save sample for the developer".** A file goes to your downloads. Open it in an editor (it should hold no words of anyone's), and send it. This is the one thing that lets the tests be made from the real X.
4. **The gear in the columns' bar.** It should open the settings as a panel over the page. If it opens a tab after three seconds instead, X is refusing the frame: send Copy diagnostics. (Tried in a real Firefox against the stand-in, also under a policy that allows frames only from the page's own origin; X's own policy is what is left.)
5. **Fold the menu (press the logo).** The icons should stay in view and the columns move left. Rest the pointer on a few posts for a few seconds each (that starts comment fetches): the menu should not flash names or vanish.
6. **Vimium keys** (j, k, d, u, gg, G) right after loading, then after clicking the left menu, then after clicking the top bar. The columns should scroll each time. (Found broken in Firefox by the real-Firefox test and fixed in 0.32.2: Firefox sends no scroll event for X's page.)
7. **A video: the full-screen button.** It should stay full screen. Esc to leave.
8. **Navigation & sidebar, add Bookmarks, Likes and Lists to the menu.** Do they show their names, in line with the rest?
9. **A profile page:** open a post from it, close it, click around. The header card should stay.
10. **Translate** on a post in another language: time to the result, then "Show original". (`translateTimes` in Copy diagnostics has the numbers.)
11. **Like, Bookmark, Repost** on a post: do they work, and does the table in 2 say *Working* for them afterwards?
12. Anything odd: a post's `...` menu, "Copy diagnostics", and a short recording.

What to send back: the table (2), the sample file (3), Copy diagnostics from anything that failed (it carries a `features` block), and a recording of anything that looked wrong.
