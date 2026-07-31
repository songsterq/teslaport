# In-car verification checklist

Nothing in the automated suite proves the real Tesla browser works. Run this
once after the first deploy, and again after any change to `src/shared` or
`src/client`.

1. **Load `/debug` on the car screen.** Every round-trip row — localStorage,
   crypto, and WebSocket — must read `ok`.
   Record the user agent string here the first time: `________`.
   If `crypto.subtle` is MISSING, the page is not on HTTPS — stop and fix that.
   If the WebSocket round-trip fails, nothing else will work; stop here.
2. **Load `/r`.** A QR code renders and the status dot is green.
3. **Scan the QR with a phone.** The phone opens `/s` already paired and shows
   "Car connected".
4. **Send a link.** It appears on the car screen and the phone shows "Sent ✓".
5. **Tap the link on the car screen.** It opens the page **in the same tab**.
   Use the browser's back control to return to `/r`; the pairing and history
   must still be there. If you want links to open in a new tab instead, verify
   `target="_blank"` actually works in this browser build first — the design
   deliberately does not assume it.
6. **Bookmark the `/r#…` URL**, then clear the car browser's data, then open
   the bookmark. The same code must reappear — not a new one.
7. **Put the car to sleep for ten minutes, then wake it.** The status dot
   returns to green without a manual reload.
8. **Check the clock.** On `/debug`, "Clock delta vs last sender" should be
   within a few seconds. A delta over 5 minutes will silently reject every
   message.
9. **Burn the code.** The old phone must fall back to "Car not connected".
