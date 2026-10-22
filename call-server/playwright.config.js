// End-to-end tests: the call server plus a test build of the site, driven
// by Chromium with a fake microphone and camera. Run with `npm test`.
import { defineConfig } from "@playwright/test";
import { SERVER, SITE, PORTS, ADMIN_PASSWORD, TICK_MS, CALL_LIMIT, HEARTBEAT_SECONDS, CALL_MAX_PRESSES } from "./tests/env.js";

export default defineConfig({
  testDir: "./tests",
  // One server, one call at a time: run the tests one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    browserName: "chromium",
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
      command: "node src/server.js",
      url: `${SERVER}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: "test",
        PORT: String(PORTS.server),
        ADMIN_PASSWORD,
        SESSION_SECRET: "test-session-secret-that-is-long-enough-123",
        ALLOWED_ORIGINS: SITE,
        ICE_SERVERS: "[]",
        TRUST_PROXY: "true",
        // One "second" of call time lasts TICK_MS, so the 45-second ring and
        // the 30-second reconnect wait run quickly. CALL_LIMIT_SECONDS is
        // counted the same way: 130 "seconds" last 26 real seconds.
        TICK_MS: String(TICK_MS),
        CALL_LIMIT_SECONDS: String(CALL_LIMIT),
        HEARTBEAT_SECONDS: String(HEARTBEAT_SECONDS),
        // Many test calls come from one address; the limit test uses its own.
        CALL_MAX_PRESSES: String(CALL_MAX_PRESSES),
      },
    },
    {
      command: `cd .. && npx vite build --outDir call-server/.test-site --emptyOutDir --logLevel warn && npx vite preview --outDir call-server/.test-site --port ${PORTS.site} --strictPort`,
      url: SITE,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_CALL_SERVER_URL: SERVER },
    },
  ],
});
