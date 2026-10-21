# Talk now call server

This small program runs the "Talk now" calls on benjaminmithra.com. It
handles:

- the **minute codes** (how much time each person has left),
- the **status board** (Available, On a call, Away),
- the **ringing** on your admin page and phone,
- the **call timer**, which takes minutes off the code second by second,
- the **introductions** between the two browsers, so they can connect.

The call itself goes straight from the visitor's browser to yours (WebRTC).
Nothing is recorded. The server keeps only the start time, end time and
minutes used for each call.

The website stays on Vercel. Vercel can't keep live connections open, so this
server needs its own small host that is always on. Render and Fly.io both
work. The steps for each are below.

---

## 1. What you need before you start

1. A Render account (render.com) or a Fly.io account (fly.io). Either one needs
   a payment card for an always-on server with a disk.
2. A TURN service account (see section 4). This helps calls connect when
   someone is on a strict office or mobile network.
3. Ten minutes on your computer with Node.js installed (nodejs.org). You only
   need it once, to make the phone notification keys (section 5).
4. Access to your domain's DNS settings, to add `call.benjaminmithra.com`
   (section 6).

---

## 2. The settings (environment variables)

You type these into Render or Fly. They never go into the repository.

| Name | What it is | Example |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Your password for the /admin page. At least 12 characters. Use a long, unique one. | `river-lamp-quiet-49-orchard` |
| `SESSION_SECRET` | A long random text that signs your login cookie. At least 32 characters. Render can make it for you. | `9f2c…` (64 random characters) |
| `ALLOWED_ORIGINS` | The website addresses allowed to use the server, separated by commas. | `https://benjaminmithra.com,https://www.benjaminmithra.com` |
| `DATA_DIR` | The folder on the persistent disk where the database lives. | `/data` |
| `NODE_ENV` | Must be `production` on the real server. This turns on the HTTPS-only rules. | `production` |
| `ICE_SERVERS` | Your STUN and TURN servers, written as JSON (section 4). | `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:443?transport=tcp","username":"…","credential":"…"}]` |
| `VAPID_PUBLIC_KEY` | Phone notifications, public key (section 5). | `BNx…` |
| `VAPID_PRIVATE_KEY` | Phone notifications, private key (section 5). Keep it secret. | `q3P…` |
| `VAPID_SUBJECT` | A contact address for the notification services. | `mailto:you@example.com` |
| `PORT` | The port the server listens on. Render and Fly set this. | `8080` |

These are optional. The defaults are right for normal use:

| Name | Default | What it does |
| --- | --- | --- |
| `TRUST_PROXY` | `1` in production | Reads the visitor's real address from the host's proxy, for the rate limits. |
| `COOKIE_SAMESITE` | `lax` | Leave as `lax` when the server is on `call.benjaminmithra.com`. |
| `RING_TIMEOUT_SECONDS` | `45` | How long a call rings before it counts as "no answer". |
| `WARNING_SECONDS` | `120` | When the "About 2 minutes left" banner shows. |
| `WRAPUP_SECONDS` | `60` | The free wrap-up time at zero, never taken from the code. |
| `RECONNECT_GRACE_SECONDS` | `30` | How long a dropped call waits for the person to come back. |
| `CONNECT_TIMEOUT_SECONDS` | `30` | How long the two browsers get to connect after you accept. |
| `ADMIN_AWAY_GRACE_SECONDS` | `60` | After your last admin page closes, how long before the status shows "Away". This gives your phone time to ring from a notification. |
| `CODE_MAX_FAILURES` / `CODE_LOCKOUT_MINUTES` | `5` / `15` | Wrong codes allowed from one address before a 15-minute lockout. |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCKOUT_MINUTES` | `5` / `15` | The same, for admin password attempts. |
| `TICK_MS` | `1000` | Only for the automated tests. Never change this on the real server. |

---

## 3a. Put it on Render (step by step)

The file `render.yaml` at the top of the repository already describes the
server.

1. Sign in at render.com and connect your GitHub account.
2. Click **New** and then **Blueprint**. Pick the `mind-interpreter`
   repository. Render reads `render.yaml` and shows a service called
   `mind-interpreter-calls` with a 1 GB disk.
3. Render asks for the values marked "sync: false": `ADMIN_PASSWORD`,
   `ICE_SERVERS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
   `VAPID_SUBJECT`. Paste them in. `SESSION_SECRET` is generated for you.
4. Click **Apply**. The first build takes a few minutes.
5. When it shows **Live**, open `https://<your-service>.onrender.com/healthz`.
   It should say `{"ok":true}`.
6. In the service's **Settings**, under **Custom Domains**, add
   `call.benjaminmithra.com`. Render shows a CNAME record. Add it at your
   DNS provider (section 6) and wait until Render shows the certificate as
   issued.

An always-on service with a disk is a paid instance type on Render. Check the
current price on render.com before you apply. Keep it to **one instance**,
because the server keeps live calls in memory.

## 3b. Or put it on Fly.io (step by step)

1. Install the Fly command-line tool (see fly.io/docs/flyctl/install) and
   run `fly auth login`.
2. In a terminal, go to the `call-server` folder of the repository.
3. Run `fly launch --no-deploy --copy-config`. When it asks for an app name,
   pick one (for example `mind-interpreter-calls`). It updates `fly.toml`.
4. Make the disk: `fly volumes create call_data --size 1 --region bom`.
   `bom` is Mumbai. Pick the region closest to you; it must match
   `primary_region` in `fly.toml`.
5. Add the secrets, one line at a time. Type your own values:

   ```
   fly secrets set ADMIN_PASSWORD='your-long-password'
   fly secrets set SESSION_SECRET="$(openssl rand -hex 32)"
   fly secrets set ALLOWED_ORIGINS='https://benjaminmithra.com,https://www.benjaminmithra.com'
   fly secrets set ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"}, … ]'
   fly secrets set VAPID_PUBLIC_KEY='…' VAPID_PRIVATE_KEY='…' VAPID_SUBJECT='mailto:you@example.com'
   ```

6. Run `fly deploy`. Then open `https://<app-name>.fly.dev/healthz`. It
   should say `{"ok":true}`.
7. Add your domain: `fly certs add call.benjaminmithra.com`. Fly shows the
   DNS records to add (section 6).

`fly.toml` already keeps one machine running all the time
(`min_machines_running = 1`, `auto_stop_machines = "off"`). Don't scale it
past one machine.

---

## 4. STUN and TURN (helping calls connect)

Most calls connect straight between the two browsers. To do that, each
browser first asks a **STUN** server for its own public address. STUN is
free and light. Google's public one is fine:

```
{"urls":"stun:stun.l.google.com:19302"}
```

Some networks block direct connections, such as strict office Wi-Fi, some
mobile carriers and some VPNs. Then the audio has to go through a **TURN**
server, which relays it. TURN uses real bandwidth, so providers charge for
it beyond a free allowance.

One option with a free tier is **Metered.ca** (its "Open Relay" / TURN
server plans). Free-tier limits change, so check the current monthly
allowance on their pricing page before relying on it. Cloudflare and Twilio
also sell TURN.

Steps with Metered (other providers are similar):

1. Create an account and a TURN app in their dashboard.
2. Copy the list of servers with your username and credential. They give it
   to you as JSON.
3. Put the whole list, with Google's STUN in front, into `ICE_SERVERS` as one
   line, for example:

   ```
   [{"urls":"stun:stun.l.google.com:19302"},
    {"urls":"turn:global.relay.metered.ca:80","username":"YOUR-USERNAME","credential":"YOUR-CREDENTIAL"},
    {"urls":"turn:global.relay.metered.ca:443?transport=tcp","username":"YOUR-USERNAME","credential":"YOUR-CREDENTIAL"}]
   ```

   Put it on one line when you paste it into Render or Fly.

The server hands this list to the two browsers only when a call is accepted.
It never appears on the public website. If `ICE_SERVERS` is empty, calls
still work on most home networks, but some will fail to connect.

---

## 5. Phone notifications (VAPID keys)

These keys let the server wake your phone or computer when someone calls or
asks for a time.

1. On your computer, open a terminal in the `call-server` folder.
2. Run `npm install` once, then `npm run vapid-keys`.
3. It prints three lines: `VAPID_PUBLIC_KEY=…`, `VAPID_PRIVATE_KEY=…` and
   `VAPID_SUBJECT=…`. Copy them into Render or Fly. Change the subject to
   your own email, written as `mailto:you@example.com`.
4. Make the keys once and keep them. If you change them later, every device
   has to turn notifications on again.

**Install the admin app on your phone:**

- **iPhone (iOS 16.4 or later):** open `https://benjaminmithra.com/admin`
  in Safari. Tap **Share**, then **Add to Home Screen**. Open it from the
  home screen, sign in and tap **Turn on call notifications on this device**. iPhones only allow
  web notifications for apps added to the Home Screen this way.
- **Android:** open `/admin` in Chrome, tap the menu, then **Install app**
  (or **Add to Home screen**). Sign in and tap **Turn on call notifications on this device**.
- **Computer:** keep `/admin` open in a tab, or install it from the address
  bar's install icon. Click **Turn on the ring sound** if it appears.

Use **Send a test** to check it works. When a call comes in,
every device rings. The first one to tap **Accept** takes the call, and the
others stop ringing.

---

## 6. Connect the website to the server

**a. Give the server its own address on your domain.** Add a DNS record for
`call.benjaminmithra.com`, as Render or Fly showed you (usually a CNAME).
This matters: your admin login cookie only works when the server sits on
your own domain. Browsers block login cookies from unrelated domains such as
`onrender.com`.

**b. Tell the website where the server is.** The website is built by GitHub
Actions, not by Vercel, so the address goes into GitHub:

1. On GitHub, open the repository, then **Settings**, then **Secrets and
   variables**, then **Actions**, then the **Variables** tab.
2. Click **New repository variable**. Name: `VITE_CALL_SERVER_URL`. Value:
   `https://call.benjaminmithra.com` (no slash at the end).
3. Rebuild the site: open **Actions**, pick **Build and Commit Output**, and
   click **Run workflow**. Or push any change to `main`.

Until this variable is set, the /call page shows "Away" and the /admin page
says the server address isn't set yet.

---

## 7. Create the first code

1. Open `https://benjaminmithra.com/admin` and sign in with `ADMIN_PASSWORD`.
2. Click **Available** so visitors can call.
3. Under **Create a code**, leave 45 minutes and **Audio only** (or choose
   **Audio and video** if you agreed to video beforehand). Add an expiry date
   if you want one, and a note so you know who it's for. Click **Create
   code**.
4. Send the 10-character code to the person. They go to
   `benjaminmithra.com/call`, type it in, test their sound and press **Call
   Benjamin**.

Unused minutes stay on the code, so the same code works for several calls
until it reaches zero or expires. You can add minutes or disable a code from
the list.

---

## 8. Good to know

- **One server only.** Live calls are kept in the server's memory, so run a
  single instance. A restart ends any call in progress; the minutes already
  used stay deducted and the rest stays on the code.
- **The database** is one file, `calls.db`, in `DATA_DIR`. To back it up,
  copy that file (Render: Shell tab; Fly: `fly ssh console`).
- **Away by default.** If no admin page is open on any of your devices, the
  public status shows "Away" after about a minute.
- **Not an emergency service.** The /call page says so, with the 988 example.

## 9. For developers: running the tests

```
cd call-server
npm install
npx playwright test
```

The tests start this server on port 8787 with a fast clock (`TICK_MS=200`)
and a temporary database, build the site with `VITE_CALL_SERVER_URL` pointing
at it, and drive Chromium with a fake microphone and camera. They need
Chromium for Playwright (`npx playwright install chromium` if it isn't
already on the machine) and the site's own `npm install` in the repository
root.
