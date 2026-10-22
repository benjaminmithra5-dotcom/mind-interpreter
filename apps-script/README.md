# Talk now: Google Apps Script

`Code.gs` is the booking "backend" for Talk now. It runs in your own Google
account and is pasted into script.google.com by hand; it isn't deployed from
this repository. Setup steps, how to change your hours, what's stored where
and the known limits are in the main [README](../README.md#talk-now-booking-and-calls).

## After changing Code.gs

1. Copy everything from the new `apps-script/Code.gs`.
2. On script.google.com, open the project, select all the old code, and
   paste the new code over it. Click **Save**. (If you changed any settings
   at the top of the old file, such as `OWNER_EMAIL`, copy them across first.
   Your weekly hours, blocked times and switches are saved separately, on
   /host, and are kept.)
3. Click **Deploy**, then **Manage deployments**, then **Edit** (the pencil),
   set **Version** to **New version**, and click **Deploy**.

The web app URL stays the same, so nothing needs to change on the website.

## The admin key (ADMIN_KEY), once

The Availability section on benjaminmithra.com/host (switches, weekly hours,
blocked times) only works with a secret key that you keep in the script.
It never goes in this repository.

1. Make a long random key: use your password manager's "generate password"
   (letters and numbers, 32 characters or more), or on a Mac or Linux
   terminal run `openssl rand -hex 24`. Keep a copy in your password manager.
2. On script.google.com, open the project and click **Project Settings** (the
   gear on the left). Scroll to **Script properties**, click **Add script
   property**, set **Property** to `ADMIN_KEY` and **Value** to your key, and
   click **Save script properties**.
3. Deploy a new version (step 3 above). The web app URL stays the same.
4. On benjaminmithra.com/host, paste the key under **Availability** and click
   **Unlock**. It's remembered in that browser tab only.

Without ADMIN_KEY, every Availability change is refused. After 5 wrong keys in
15 minutes, changes are refused until those 15 minutes have passed.

## Tests

`test/` runs the same `Code.gs` in Node with stand-ins for Google's services:

```
node --test apps-script/test/*.test.mjs
```
