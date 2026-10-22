// End-to-end tests for Talk now. Run with `npm test` in this folder.
// The site is built with its booking address pointing at a local copy of
// the Apps Script (servers.mjs) and its PeerJS broker at a local one.
import { defineConfig } from "@playwright/test";
import { PORTS, GAS, SITE, TICK_MS, CALL_LIMIT } from "./tests/env.js";

export default defineConfig({
  testDir: "./tests",
  // One shared Apps Script and broker: run the tests one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    baseURL: SITE,
    timezoneId: "Asia/Kolkata",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        // Plain local addresses, so two browser tabs can reach each other
        // without mDNS in a container.
        "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
    },
  },
  webServer: [
    {
      command: "node servers.mjs",
      url: `${GAS}/exec?action=slots`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `cd .. && npx vite build --outDir e2e/.site --emptyOutDir --logLevel warn && npx vite preview --outDir e2e/.site --port ${PORTS.site} --strictPort`,
      url: SITE,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        VITE_BOOKING_URL: `${GAS}/exec`,
        VITE_ICE_SERVERS: "[]",
        VITE_PEER_HOST: "localhost",
        VITE_PEER_PORT: String(PORTS.peer),
        VITE_PEER_PATH: "/",
        VITE_PEER_SECURE: "false",
        VITE_TICK_MS: String(TICK_MS),
        VITE_CALL_LIMIT_SECONDS: String(CALL_LIMIT),
      },
    },
  ],
});
