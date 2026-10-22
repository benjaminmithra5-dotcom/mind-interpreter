import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, openHost, joinAsGuest } from "./helpers.js";
import { PORTS } from "./env.js";

const PEERJS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/peerjs/dist/peerjs.min.js");

// Watches a page's PeerJS broker sockets: how many it opened, and how many
// data-connection offers it sent (each one is a connection to the host).
async function watchBroker(page) {
  const seen = { sockets: [], dataOffers: 0 };
  await page.routeWebSocket(new RegExp(`:${PORTS.peer}/`), (ws) => {
    const server = ws.connectToServer();
    seen.sockets.push(ws);
    ws.onMessage((m) => {
      try {
        const msg = JSON.parse(m);
        if (msg.type === "OFFER" && msg.payload && msg.payload.type === "data") seen.dataOffers += 1;
      } catch { /* not JSON */ }
      server.send(m);
    });
  });
  return seen;
}

async function admitAndConnect(host, guest) {
  await host.getByTestId("admit").click();
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(host.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
}

test("host opens first, then the guest joins: waiting room, admit, call", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const host = await openHost(open, code);
  const guest = await open(`/call?room=${code}`);
  await joinAsGuest(guest, code, "Asha");
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await expect(host.getByTestId("guest-name")).toHaveText("Asha is waiting.");
  await admitAndConnect(host, guest);
});

test("host first; the guest's link to the broker drops and comes back (open fires again): still the same guest", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const host = await openHost(open, code);
  const guest = await open("/call");
  const seen = await watchBroker(guest);
  await guest.goto(`/call?room=${code}`);
  await joinAsGuest(guest, code, "Asha");
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await expect(host.getByTestId("guest-waiting")).toBeVisible();
  expect(seen.dataOffers).toBe(1);

  seen.sockets.at(-1).close(); // the broker link drops; PeerJS reconnects and fires "open" again
  await expect.poll(() => seen.sockets.length, { timeout: 15_000 }).toBeGreaterThan(1);
  await guest.waitForTimeout(3000);
  // No second connection to the host, so nothing for it to call "busy".
  expect(seen.dataOffers).toBe(1);
  await expect(guest.getByTestId("join-message")).toHaveCount(0);
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await expect(host.getByTestId("guest-name")).toHaveText("Asha is waiting.");
  await admitAndConnect(host, guest);

  // And during the call too.
  seen.sockets.at(-1).close();
  await guest.waitForTimeout(3000);
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
});

test("host first; Join pressed twice: one guest, no busy", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const host = await openHost(open, code);
  const guest = await open("/call");
  const seen = await watchBroker(guest);
  await guest.goto(`/call?room=${code}`);
  await guest.getByTestId("join-name").fill("Asha");
  await guest.evaluate(() => {
    const form = document.querySelector('[data-testid="join-form"]');
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await guest.waitForTimeout(3000);
  // One join: one connection to the broker, one connection to the host.
  expect(seen.sockets.length).toBe(1);
  expect(seen.dataOffers).toBe(1);
  await expect(guest.getByTestId("join-message")).toHaveCount(0);
  await expect(host.getByTestId("guest-name")).toHaveText("Asha is waiting.");
  await admitAndConnect(host, guest);
});

test("the host swaps in a fresh connection from the same join, but a different second guest hears busy", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const host = await openHost(open, code);
  // A bare PeerJS client stands in for a guest's page.
  const raw = await open("/call");
  await raw.addScriptTag({ path: PEERJS });
  const replies = await raw.evaluate(async ({ code, port }) => {
    const peer = new window.peerjs.Peer({ host: "localhost", port, path: "/", secure: false, config: { iceServers: [] } });
    await new Promise((r) => peer.on("open", r));
    const ask = (meta) => new Promise((resolve) => {
      const conn = peer.connect(`mi-${code}`, { serialization: "json", metadata: meta });
      conn.on("data", (m) => resolve(m.t));
      setTimeout(() => resolve("silence"), 5000);
    });
    const first = await ask({ name: "Asha", joinId: "join-a" });
    const again = await ask({ name: "Asha", joinId: "join-a" }); // same page, fresh connection
    const other = await ask({ name: "Someone", joinId: "join-b" }); // a genuinely different guest
    return { first, again, other };
  }, { code, port: PORTS.peer });
  expect(replies).toEqual({ first: "wait", again: "wait", other: "busy" });
  await expect(host.getByTestId("guest-name")).toHaveText("Asha is waiting.");
});

test("a different second guest still hears busy while the first one waits", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const host = await openHost(open, code);
  const first = await open(`/call?room=${code}`);
  await joinAsGuest(first, code, "Asha");
  await expect(first.getByTestId("waiting")).toBeVisible();
  const second = await open(`/call?room=${code}`);
  await joinAsGuest(second, code, "Someone");
  await expect(second.getByTestId("join-message")).toHaveText("Benjamin is in another call right now. Please try again in a few minutes.");
  await expect(first.getByTestId("waiting")).toBeVisible();
  await expect(host.getByTestId("guest-name")).toHaveText("Asha is waiting.");
});
