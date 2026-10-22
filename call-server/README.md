# Talk now call server

This small program runs the "Talk now" calls on benjaminmithra.com. It
handles:

- the **status** that visitors see: Available, On a call or Away,
- the **ringing** on your admin page, with the caller's name and email,
- the **call timer** (45 minutes, counted by the server, not the browsers),
- the **introductions** between the two browsers, so they can connect.

The call itself goes straight from the visitor's browser to yours (WebRTC),
audio only. Nothing is recorded and nothing is saved: there is no database.
The caller's name and email are shown to you while the call rings and are
never written down or logged.

The website stays on Vercel. Vercel can't keep live connections open, so this
server needs its own small host that is always on. Render and Fly.io both
work. The steps for each are below.

## How the status works

- On your admin page there is an **Available / Away** switch. Only you can
  change it. It starts on **Away**, and it goes back to Away if the server
  restarts. It never turns to Available by itself.
- Visitors see **Available** only while the switch is on Available **and**
  your admin page is open and connected on at least one device.
- If the admin page closes, the phone goes to sleep or the internet drops,
  the server notices within a few seconds and visitors see **Away**. When
  the page connects again with the switch still on Available, they see
  **Available** again.
- During a call, visitors see **On a call**. After it ends, the status goes
  back to Available if the switch is still on Available and the page is open.

---

## 1. What you need before you start

1. A Render account (render.com) or a Fly.io account (fly.io). Either one
   needs a payment card for a server that stays on all the time.
2. A TURN service account (see section 4). This helps calls connect when
   someone is on a strict office or mobile network.
3. Access to your domain's DNS settings, to add `call.benjaminmithra.com`
   (section 5).

---

## 2. The settings (environment variables)

You type these into Render or Fly. They never go into the repository.

| Name | What it is | Example |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Your password for the /admin page. At least 12 characters. Use a long, unique one. | `river-lamp-quiet-49-orchard` |
| `SESSION_SECRET` | A long random text that signs your login cookie. At least 32 characters. Render can make it for you. | `9f2c…` (64 random characters) |
| `ALLOWED_ORIGINS` | The website addresses allowed to use the server, separated by commas. | `https://benjaminmithra.com,https://www.benjaminmithra.com` |
| `NODE_ENV` | Must be `production` on the real server. This turns on the HTTPS-only rules. | `production` |
| `ICE_SERVERS` | Your STUN and TURN servers, written as JSON (section 4). | `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:443?transport=tcp","username":"…","credential":"…"}]` |
| `PORT` | The port the server listens on. Render and Fly set this for you. | `8080` |

These are optional. The defaults are right for normal use:

| Name | Default | What it does |
| --- | --- | --- |
| `CALL_LIMIT_SECONDS` | `2700` | The longest a call can last, in seconds (2700 = 45 minutes), counted from when both sides are connected. |
| `HEARTBEAT_SECONDS` | `3` | How often the server checks each page is still there. A silent admin page counts as Away after about two checks. |
| `CALL_MAX_PRESSES` / `CALL_WINDOW_MINUTES` | `5` / `10` | How many times one internet address may press Call in that many minutes. |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCKOUT_MINUTES` | `5` / `15` | Wrong admin passwords allowed from one address before a 15-minute lockout. |
| `TRUST_PROXY` | `1` in production | Reads the visitor's real address from the host's proxy, for the limits above. |
| `COOKIE_SAMESITE` | `lax` | Leave as `lax` when the server is on `call.benjaminmithra.com`. |
| `TICK_MS` | `1000` | Only for the automated tests. Never change this on the real server. |

The ring time (45 seconds), the 2-minute warning and the 30-second wait
after a dropped connection are fixed.

---

## 3a. Put it on Render (step by step)

The file `render.yaml` at the top of the repository already describes the
server.

1. Sign in at render.com and connect your GitHub account.
2. Click **New** and then **Blueprint**. Pick the `mind-interpreter`
   repository. Render reads `render.yaml` and shows a service called
   `mind-interpreter-calls`.
3. Render asks for the values marked "sync: false": `ADMIN_PASSWORD` and
   `ICE_SERVERS`. Paste them in. `SESSION_SECRET` is generated for you, and
   `ALLOWED_ORIGINS` is already filled in.
4. Click **Apply**. The first build takes a few minutes.
5. When it shows **Live**, open `https://<your-service>.onrender.com/healthz`.
   It should say `{"ok":true}`.
6. In the service's **Settings**, under **Custom Domains**, add
   `call.benjaminmithra.com`. Render shows a CNAME record. Add it at your
   DNS provider (section 5) and wait until Render shows the certificate as
   issued.

Render's free instance type goes to sleep when nobody uses it, which would
drop your admin page's connection. Use a paid "always on" type (the Blueprint
asks for `starter`). Check the current price on render.com. Keep it to **one
instance**.

## 3b. Or put it on Fly.io (step by step)

1. Install the Fly command-line tool (see fly.io/docs/flyctl/install) and
   run `fly auth login`.
2. In a terminal, go to the `call-server` folder of the repository.
3. Run `fly launch --no-deploy --copy-config`. When it asks for an app name,
   pick one (for example `mind-interpreter-calls`). It updates `fly.toml`.
   `primary_region = "bom"` is Mumbai; change it to the region closest to you.
4. Add the secrets, one line at a time. Type your own values:

   ```
   fly secrets set ADMIN_PASSWORD='your-long-password'
   fly secrets set SESSION_SECRET="$(openssl rand -hex 32)"
   fly secrets set ALLOWED_ORIGINS='https://benjaminmithra.com,https://www.benjaminmithra.com'
   fly secrets set ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"}, … ]'
   ```

5. Run `fly deploy`. Then open `https://<app-name>.fly.dev/healthz`. It
   should say `{"ok":true}`.
6. Add your domain: `fly certs add call.benjaminmithra.com`. Fly shows the
   DNS records to add (section 5).

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

Some networks block direct connections: strict office Wi-Fi, some mobile
carriers, some VPNs. Then the audio has to go through a **TURN** server,
which relays it. TURN uses real bandwidth, so providers charge for it beyond
a free allowance. Audio calls use far less than video.

One option with a free tier is **Metered.ca** (its TURN server plans, also
known as "Open Relay"). Free-tier limits change, so check the current monthly
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

## 5. Connect the website to the server

**a. Give the server its own address on your domain.** Add a DNS record for
`call.benjaminmithra.com`, as Render or Fly showed you (usually a CNAME).
This matters: your admin login cookie only works when the server sits on
your own domain. Browsers block login cookies from unrelated domains such as
`onrender.com`.

**b. Tell the website where the server is: `VITE_CALL_SERVER_URL`.** The
value is the server's address with no slash at the end:
`https://call.benjaminmithra.com`.

This setting is read when the website is **built**, so it has to go where
the build happens. For this site, the build runs in GitHub Actions and
Vercel only serves the finished files from `deploy-output/`. So:

1. On GitHub, open the repository, then **Settings**, then **Secrets and
   variables**, then **Actions**, then the **Variables** tab.
2. Click **New repository variable**. Name: `VITE_CALL_SERVER_URL`. Value:
   `https://call.benjaminmithra.com`.
3. Rebuild the site: open **Actions**, pick **Build and Commit Output**, and
   click **Run workflow** (or push any change to `main`). Vercel then
   publishes the new files as usual.

**About Vercel:** you can also add `VITE_CALL_SERVER_URL` in Vercel (your
project, then **Settings**, then **Environment Variables**, for
"Production"), but it only takes effect if Vercel runs the build itself. To
check, open **Settings**, then **Build and Deployment**: if the build command
is `npm run build`, Vercel builds the site and the Vercel variable is the one
that counts (then redeploy). If Vercel just serves `deploy-output`, the
GitHub variable above is the one that counts. Setting both to the same value
is harmless.

Until this is set, the /call page shows "Away" and the /admin page says the
server address isn't set yet.

---

## 6. Put /admin on your phone

The admin page can sit on your phone's home screen like an app.

- **iPhone:** open `https://benjaminmithra.com/admin` in Safari. Tap
  **Share**, then **Add to Home Screen**, then **Add**.
- **Android:** open `/admin` in Chrome, tap the menu (⋮), then **Install app**
  (or **Add to Home screen**).
- **Computer:** keep `/admin` open in a browser tab, or install it from the
  install icon in the address bar.

Open it, sign in, and switch to **Available**. Then:

- **Keep the page open and on screen** to receive calls. There are no push
  notifications: if the page is closed, visitors see "Away".
- While you're Available, the page asks the phone to keep the screen awake,
  where the phone supports it. Plug the phone in if you'll be available for
  a long time.
- If the phone locks, goes to sleep or switches to another app, the
  connection can drop. Visitors then see "Away" within a few seconds. When
  you open the page again it reconnects, and if you left it on Available,
  visitors see "Available" again.
- Browsers only allow sound after a tap. Tapping **Available** does it; if
  **Turn on the ring sound** appears, tap that.
- If the page is open on your computer and your phone, both ring. The first
  to tap **Accept** takes the call and the other stops ringing.

---

## 7. Good to know

- **One server only.** Live calls are kept in the server's memory, so run a
  single instance. A restart ends any call in progress and sets the switch
  back to Away.
- **Not an emergency service.** The /call page says so, with the 988 example.

## 8. For developers: running the tests

```
cd call-server
npm install
npx playwright test
```

The tests start this server on port 8787 with a fast clock (`TICK_MS=200`,
`CALL_LIMIT_SECONDS=130`), build the site with `VITE_CALL_SERVER_URL`
pointing at it, and drive Chromium with a fake microphone. They need
Chromium for Playwright (`npx playwright install chromium` if it isn't
already on the machine) and the site's own `npm install` in the repository
root.
