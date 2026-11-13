const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { stripTypeScriptTypes } = require("node:module");
const vm = require("node:vm");
const test = require("node:test");

const appId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function harness() {
  const state = { status: "pending", sent: [], fail: false };
  const env = {
    APP_BASE_URL: "https://portal.example.test",
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    RESEND_API_KEY: "resend",
    EMAIL_SENDING_ENABLED: "true",
    WELCOME_WEBHOOK_SECRET: "secret",
  };
  const client = {
    auth: { getUser: async token => ({ data: { user: token === "staff-token" ? { id: "staff" } : null } }) },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { role: "staff", status: "active" }, error: null }; },
      };
    },
    async rpc(name, args) {
      if (name === "claim_welcome_email") {
        if (state.status === "sent") return { data: { state: "sent" }, error: null };
        if (state.status === "processing") return { data: { state: "processing" }, error: null };
        state.status = "processing";
        return { data: {
          state: "claimed", id: "email-1", recipient: "client@example.test",
          details: { name: "Client <Test>", reference: "JIT-123", registered_at: "2026-11-13" },
        }, error: null };
      }
      if (name === "start_welcome_request") return { error: null };
      if (name === "finish_welcome_email") {
        state.status = args.p_error ? "failed" : "sent";
        return { error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  let handler;
  const source = readFileSync("supabase/functions/client-access/index.ts", "utf8")
    .replace(/^import .*;\s*/m, "");
  const context = {
    createClient: () => client,
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    console, Response, Request, Headers, Intl,
    fetch: async (_url, init) => {
      state.sent.push({ payload: JSON.parse(init.body), key: init.headers["Idempotency-Key"] });
      if (state.fail) return new Response("error", { status: 503 });
      return Response.json({ id: "provider-id" });
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(source), context);
  const staff = (token = "staff-token") => handler(new Request("https://function.example.test", {
    method: "POST",
    headers: { Origin: env.APP_BASE_URL, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "welcome", applicationId: appId }),
  }));
  const webhook = (secret, kind = "welcome") => handler(new Request("https://function.example.test", {
    method: "POST", headers: { "x-welcome-secret": secret },
    body: JSON.stringify({ type: "INSERT", schema: "public", table: "email_notifications", record: { kind, application_id: appId } }),
  }));
  return { state, staff, webhook };
}

test("sends the approved welcome content without a portal link, and does not send twice", async () => {
  const h = harness();
  assert.equal((await h.staff()).status, 200);
  assert.equal((await h.webhook("secret")).status, 200);
  assert.equal(h.state.sent.length, 1);
  const { payload } = h.state.sent[0];
  assert.equal(payload.from, "JIT Travels <VISAAPPLICATION@jitgroupofcompanies.com>");
  assert.equal(payload.text, `Dear Client <Test>,

WELCOME TO JIT TRAVELS!

Thank you for choosing JIT Travels for your visa application and travel assistance needs.

We are pleased to confirm that your application has been successfully registered in our system. Our team will be working with you throughout the process and providing the necessary guidance and assistance at every important stage.

YOUR APPLICATION DETAILS

Application Reference: JIT-123
Application Status: Processing Commenced
Registration Date: 13 November 2026

WHAT HAPPENS NEXT?

We are pleased to inform you that the processing of your application has commenced. Our team is currently reviewing and verifying the documents and information submitted to ensure that everything is in order.

Should we require any additional documents, clarification or information, a member of our team will contact you directly.

Please be assured that we will keep you informed of important developments as your application progresses.

We appreciate your trust in JIT Travels and look forward to providing you with a smooth, transparent and professional application experience.

Thank you for choosing us.

Warm regards,
Visa Processing Team
JIT Travels`);
  assert.match(payload.html, /Client &lt;Test&gt;/);
  assert.doesNotMatch(payload.text + payload.html, /https?:\/\/|portal|login|sign.in/i);
});

test("failed sends may be retried with the identical message and idempotency key", async () => {
  const h = harness();
  h.state.fail = true;
  assert.equal((await h.staff()).status, 502);
  assert.equal(h.state.status, "failed");
  h.state.fail = false;
  assert.equal((await h.staff()).status, 200);
  assert.equal(h.state.sent.length, 2);
  assert.equal(h.state.sent[0].key, h.state.sent[1].key);
  assert.deepEqual(h.state.sent[0].payload, h.state.sent[1].payload);
});

test("rejects unauthorized requests and ignores unrelated notifications", async () => {
  const h = harness();
  assert.equal((await h.staff("invalid")).status, 401);
  assert.equal((await h.webhook("invalid")).status, 403);
  assert.equal((await h.webhook("secret", "milestone")).status, 200);
  assert.equal(h.state.sent.length, 0);
});
