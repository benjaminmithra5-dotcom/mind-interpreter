// Shared settings for the tests. Nothing here is a real password.
export const PORTS = { server: 8787, site: 4173 };
export const SERVER = `http://localhost:${PORTS.server}`;
export const SITE = `http://localhost:${PORTS.site}`;
export const ADMIN_PASSWORD = "test-password-not-real";
export const TICK_MS = 200;
export const CALL_LIMIT = 130; // just over the 2-minute warning
export const HEARTBEAT_SECONDS = 2;
export const CALL_MAX_PRESSES = 40;
