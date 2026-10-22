# Talk now: Google Apps Script

`Code.gs` is the booking "backend" for Talk now. It runs in your own Google
account and is pasted into script.google.com by hand; it isn't deployed from
this repository. Setup steps, how to change your hours, what's stored where
and the known limits are in the main [README](../README.md#talk-now-booking-and-calls).

## After changing Code.gs

1. Copy everything from the new `apps-script/Code.gs`.
2. On script.google.com, open the project, select all the old code, and
   paste the new code over it. Click **Save**. (Copy your own `WORK_HOURS`
   and other settings across first if you've changed them.)
3. Click **Deploy**, then **Manage deployments**, then **Edit** (the pencil),
   set **Version** to **New version**, and click **Deploy**.

The web app URL stays the same, so nothing needs to change on the website.

## Tests

`test/` runs the same `Code.gs` in Node with stand-ins for Google's services:

```
node --test apps-script/test/code.test.mjs
```
