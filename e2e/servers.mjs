// Local stand-ins for the two outside services, for the tests only:
//
// 1. The Google Apps Script web app: the real apps-script/Code.gs, run in
//    Node with fake Google services (see apps-script/test/gas-mock.mjs).
//    Like Google, it answers each request with a 302 redirect to a second
//    address that returns the result, so the site's redirect handling is
//    tested too. Test-only helpers live under /__test/.
// 2. A PeerJS broker (the "peer" npm package), instead of PeerJS's cloud.
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { ExpressPeerServer } from "peer";
import { createGas } from "../apps-script/test/gas-mock.mjs";
import { PORTS } from "./tests/env.js";

const BASE = `http://localhost:${PORTS.gas}`;
let gas = createGas({ url: `${BASE}/exec` });
const results = new Map(); // redirect key -> { type, body }

const cors = { "Access-Control-Allow-Origin": "*" };
const send = (res, status, type, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...cors, ...headers });
  res.end(body);
};
const readBody = (req) => new Promise((resolve) => {
  let data = "";
  req.on("data", (c) => { data += c; });
  req.on("end", () => resolve(data));
});

// google.script.run, for the approve/decline pages: calls the named
// function of Code.gs through /__run.
const SHIM = `<script>window.google={script:{run:(function(){function r(ok,fail){return new Proxy({},{get:function(_,k){
if(k==="withSuccessHandler")return function(f){return r(f,fail)};if(k==="withFailureHandler")return function(f){return r(ok,f)};
return function(){var args=[].slice.call(arguments);fetch("/__run",{method:"POST",body:JSON.stringify({fn:k,args:args})})
.then(function(x){return x.json()}).then(function(v){ok&&ok(v.result)}).catch(function(e){fail&&fail(e)})}}})}return r()})()}};</script>`;

function output(out) {
  if (out.kind === "html") return { type: "text/html; charset=utf-8", body: out.html.replace("<head>", `<head>${SHIM}`) };
  return { type: "application/json; charset=utf-8", body: out.content };
}

// The tests make bookings with a code directly (to test any time window).
function testBooking({ startsInMinutes = 5, status = "approved", name = "Test Guest", email = "guest@example.com" }) {
  const start = new Date(Math.round((Date.now() + startsInMinutes * 60000) / 1000) * 1000);
  const end = new Date(start.getTime() + 45 * 60000);
  const all = gas.bookings();
  const b = {
    id: crypto.randomUUID(), code: gas.context.newCode_(all), approveToken: gas.context.newToken_(), declineToken: gas.context.newToken_(),
    status, start: start.toISOString(), end: end.toISOString(), createdAt: new Date().toISOString(),
    name, email, phone: "+91 98765 43210", timezone: "Asia/Kolkata", eventId: null,
  };
  gas.context.saveBooking_(b);
  return { id: b.id, code: b.code, start: b.start };
}

const gasServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  try {
    if (req.method === "OPTIONS") return send(res, 204, "text/plain", "", { "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "*" });
    if (url.pathname === "/exec") {
      const params = Object.fromEntries(url.searchParams);
      const out = req.method === "POST"
        ? gas.context.doPost({ parameter: params, postData: { contents: await readBody(req), type: req.headers["content-type"] || "" } })
        : gas.context.doGet({ parameter: params });
      const key = crypto.randomUUID();
      results.set(key, output(out));
      setTimeout(() => results.delete(key), 60000);
      return send(res, 302, "text/plain", "", { Location: `${BASE}/echo?key=${key}` });
    }
    if (url.pathname === "/echo") {
      const r = results.get(url.searchParams.get("key"));
      return r ? send(res, 200, r.type, r.body) : send(res, 404, "text/plain", "gone");
    }
    if (url.pathname === "/__run" && req.method === "POST") {
      const { fn, args } = JSON.parse(await readBody(req));
      if (fn !== "ownerAction") return send(res, 400, "application/json", "{}");
      return send(res, 200, "application/json", JSON.stringify({ result: gas.context.ownerAction(...args) }));
    }
    // ---- test helpers ----
    if (url.pathname === "/__test/reset") { gas = createGas({ url: `${BASE}/exec` }); return send(res, 200, "application/json", "{}"); }
    if (url.pathname === "/__test/mails") return send(res, 200, "application/json", JSON.stringify(gas.mails));
    if (url.pathname === "/__test/bookings") return send(res, 200, "application/json", JSON.stringify(gas.bookings()));
    if (url.pathname === "/__test/events") return send(res, 200, "application/json", JSON.stringify(gas.events.map((e) => ({ title: e.title, start: e.start, end: e.end }))));
    if (url.pathname === "/__test/booking" && req.method === "POST") return send(res, 200, "application/json", JSON.stringify(testBooking(JSON.parse((await readBody(req)) || "{}"))));
    if (url.pathname === "/__test/property" && req.method === "POST") {
      const { key, value } = JSON.parse(await readBody(req));
      if (value == null) gas.props.delete(key); else gas.props.set(key, String(value));
      return send(res, 200, "application/json", "{}");
    }
    if (url.pathname === "/__test/busy" && req.method === "POST") {
      const { start, end } = JSON.parse(await readBody(req));
      gas.addBusy(start, end);
      return send(res, 200, "application/json", "{}");
    }
    send(res, 404, "text/plain", "not found");
  } catch (err) {
    send(res, 500, "text/plain", String(err && err.message));
  }
});
// Keep idle connections open longer than the test client does, so it never
// reuses one the server has just closed.
gasServer.keepAliveTimeout = 120_000;
gasServer.headersTimeout = 121_000;
gasServer.listen(PORTS.gas, "0.0.0.0", () => console.log(`Fake Apps Script on ${BASE}/exec`));

const broker = express();
const brokerServer = broker.listen(PORTS.peer, "0.0.0.0", () => console.log(`PeerJS broker on port ${PORTS.peer}`));
broker.use("/", ExpressPeerServer(brokerServer, { path: "/" }));
