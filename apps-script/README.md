# Talk now: Google Apps Script

`Code.gs` is the booking "backend" for Talk now. It runs in your own Google
account and is pasted into script.google.com by hand; it isn't deployed from
this repository. Setup steps, how to change your hours, what's stored where
and the known limits are in the main [README](../README.md#talk-now-booking-and-calls).

`test/` runs the same `Code.gs` in Node with stand-ins for Google's services:

```
node --test apps-script/test/code.test.mjs
```
