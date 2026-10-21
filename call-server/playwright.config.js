// End-to-end tests: the call server plus a test build of the site, driven
// by Chromium with a fake microphone and camera. Run with `npm test`.
import { defineConfig } from "@playwright/test";
import { SERVER, SITE, PORTS, ADMIN_PASSWORD, TICK_MS } from "./tests/env.js";

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
      command: "rm -rf .test-data && node src/server.js",
      url: `${SERVER}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: "test",
        PORT: String(PORTS.server),
        DATA_DIR: ".test-data",
        ADMIN_PASSWORD,
        SESSION_SECRET: "test-session-secret-that-is-long-enough-123",
        ALLOWED_ORIGINS: SITE,
        ICE_SERVERS: "[]",
        TRUST_PROXY: "true",
        // One "second" of call time lasts TICK_MS, so the tests run quickly.
        TICK_MS: String(TICK_MS),
        ADMIN_AWAY_GRACE_SECONDS: "5",
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
