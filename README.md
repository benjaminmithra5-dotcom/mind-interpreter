# Mind Interpreter

This is the source code for the website, built with React and Vite.

## Running it locally (optional, only needed if you want to preview on your own computer)

```
npm install
npm run dev
```

Then open the local address it prints (usually http://localhost:5173).

## Building for production

```
npm run build
```

This creates a `dist` folder with the final, optimized site. Hosts like Vercel
and Netlify run this command automatically, so you won't normally need to run
it yourself.

## Project structure

- `index.html` — the page shell that loads the app
- `src/main.jsx` — mounts the React app into the page
- `src/App.jsx` — the entire website (all pages, games, and styling live here)
- `src/call/` — the Talk now pages (/call and /host)
- `apps-script/Code.gs` — the Google Apps Script for Talk now bookings (see below)
- `e2e/` — automated tests for Talk now

## Talk now: booking and calls

Clients book a time on benjaminmithra.com/call. You approve it from an email,
the client gets a code, and at the time of the call they join a private,
audio-only room in the browser that you open on benjaminmithra.com/host.
There's no server of our own, no database and no cost: bookings run on a
small Google Apps Script in your own Google account (`apps-script/Code.gs`),
and the call goes directly between the two browsers.

### Setting it up

1. Open [script.google.com](https://script.google.com) while signed in as
   benjamin@benjaminmithra.com. Click **New project**. Delete the sample
   code, paste in everything from `apps-script/Code.gs`, and click **Save**.
   Near the top, edit `WORK_HOURS` (marked **EDIT ME**: the hours there are
   only placeholders).
2. In the toolbar above the code, pick **setup** in the list of functions
   and click **Run**. Google asks for permission to use your Calendar and to
   send email as you: click **Review permissions** and pick your account. If
   Google says it hasn't verified the app, click **Advanced** and then **Go
   to …** (it's your own script). Then click **Allow**. The log at the bottom
   says "Setup complete."
3. Click **Deploy**, then **New deployment**. Click the gear icon and choose
   **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click
   **Deploy** and copy the **Web app URL** (it ends in `/exec`).
4. In the GitHub repository, open **Settings**, then **Secrets and
   variables**, then **Actions**, then the **Variables** tab. Click **New
   repository variable**: name `VITE_BOOKING_URL`, value the web app URL.
   Then open **Actions**, choose **Build and Commit Output** and click **Run
   workflow**. When it has finished, the site shows the booking calendar.
5. Test it: in a second browser (or a private window), book a time on
   benjaminmithra.com/call. You'll get an email: tap **Approve**, then the
   **Approve** button on the page that opens. The client email (and your
   copy) has the code. To try a call straight away, book the earliest time
   you can, then at that time open benjaminmithra.com/host, paste the code
   and click **Open room**. In the other browser, open the join link from
   the email, type a name and click **Join**. Click **Admit** on /host.

Until `VITE_BOOKING_URL` is set, /call just says "Booking opens soon."

### Your hours, blocked times and Immediate Talk (on /host)

After the one-time admin key step (see `apps-script/README.md`, "The admin
key"), open benjaminmithra.com/host, paste the key under **Availability** and
click **Unlock**. There you can:

- switch **Taking immediate calls** on or off (off at first);
- switch **Pause all booking** on or off: while it's on, clients see
  "Booking is paused right now" and no times;
- set your **weekly hours** (India time), with more than one range a day or a
  day closed, then **Save hours**;
- add **blocked times**: a whole day, or a time range on a day, with a note
  just for you;
- check **what clients see**: the next 14 days of free times.

Anything on your Google Calendar marked "Busy" still blocks bookings
automatically; events marked "Free" don't. Changing your hours doesn't cancel
bookings already made. The other settings (session length, buffer, notice,
days ahead) are at the top of `Code.gs`; after changing them there, paste the
file over the old one and deploy a new version (see `apps-script/README.md`).

### Immediate Talk

While **Taking immediate calls** is on, /call shows "Need to talk right now?"
with a short form. You get an email "Immediate Talk: name" with the client's
details, a WhatsApp link, and Approve and Decline. On Approve, the call starts
then: it goes on your calendar as "Immediate Talk: name", the client gets
their code with "Your call is ready now", and you open the room on /host with
that code. A request you don't answer within 15 minutes is released and the
client is told politely. At most 5 immediate requests can wait at once.

### Answering requests

Each request appears on your Google Calendar as "Talk now: name (pending)"
and in your email with the client's name, email, phone (with a WhatsApp
link) and the time in India and in their time zone. The Approve and Decline
links each open a page with one button; the button, not the link, does it.
This way an email security scanner that "opens" links can't approve or
decline anything by itself. Decline also works after approving, to cancel a
call. Requests you don't answer within 48 hours are released automatically
and the client gets a polite email.

### What's stored where

- **Your Google Calendar:** each booking, with the client's name, email,
  phone and time zone in the event description. It stays there as your
  record.
- **Your Gmail:** the request emails, and copies of what clients were sent.
- **The script's own private storage** (script properties): the booking code
  and the one-time Approve/Decline links, only while they're needed. Declined
  and released requests are deleted at once; approved ones a day after the
  call. Also your weekly hours, blocked times (with your notes), the two
  switches, your ADMIN_KEY and a count of recent wrong keys.
- **Nothing else.** The website has no database. The call itself is never
  recorded, and the script never writes names, emails or phone numbers to its
  log.

### Optional: a relay for hard networks (TURN)

Most calls connect directly. On some strict office or mobile networks they
need a relay (TURN). One free-tier option is Metered.ca's TURN service: check
its current free allowance before relying on it. To use one, add a second
repository variable `VITE_ICE_SERVERS` with the list they give you, as one
line of JSON, for example
`[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:…","username":"…","credential":"…"}]`,
and run the workflow again. **Note:** this value becomes visible in the
site's code, so only use a free-tier relay account with nothing else on it.
Calls through a relay stay encrypted end to end; the relay can't listen.

### Known limits

- The calls use PeerJS's free public broker to introduce the two browsers.
  It has no uptime guarantee; if it's down, calls can't start until it's back.
- TURN is optional. Without it, a few clients on very strict networks may not
  be able to connect.
- You must keep /host open (and the screen on) during the call time. The page
  asks the device to keep the screen awake where it can. If your page closes
  during a call, the call pauses for up to 30 seconds and then ends.
- Google limits how many emails a script can send each day (a Workspace
  account allows far more than this needs, but check Google's current quotas).
- Immediate Talk only works while you watch your email: a request waits 15
  minutes for your answer.
- One guest at a time per room. Each call lasts up to 45 minutes from the
  moment it connects.

### Tests

- `node --test apps-script/test/*.test.mjs` runs the booking logic in Node
  with stand-ins for Google's services.
- `cd e2e && npm install && npx playwright test` runs the site end to end in
  Chromium (fake microphone), against a local copy of the script and a local
  PeerJS broker.
