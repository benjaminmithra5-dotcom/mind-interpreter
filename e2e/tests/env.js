// Ports and fast timings for the tests. Nothing here is a real secret.
export const PORTS = { gas: 8810, peer: 9010, site: 4180 };
export const GAS = `http://localhost:${PORTS.gas}`;
export const SITE = `http://localhost:${PORTS.site}`;
// One "second" of call time lasts TICK_MS; a call lasts CALL_LIMIT of them
// (130 = just over the 2-minute warning, so 26 real seconds).
export const TICK_MS = 200;
export const CALL_LIMIT = 130;
