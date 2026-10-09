# Samples from real X

Nobody working on this can log in to X, so the stand-in in `test/e2e/mock/` is only as right as someone's memory of X's pages. A sample
from the real thing fixes that: the tests below read every `*.json` in this folder.

**Taking one** (on x.com, columns on, the home timeline showing): a post's `...` menu, **Save sample for the developer**. A file
`multi-column-for-x-sample-<date>.json` goes to the downloads. It keeps the shape of the last timelines and conversations X sent (field
names, types, ids, kinds of entry) with every word, name and address replaced, and the markup of the buttons this extension presses with
the text removed (a short label on a button is kept: that is what a button is found by). Open it in an editor before sending it.

**Using one:** copy it here, keeping the name. `npm test` then checks that the parser still reads every timeline in it and that the
test ids of the buttons in `XMCLogic.CONTROLS` are in the markup it holds. When X changes, a new sample from the same page shows what moved.
