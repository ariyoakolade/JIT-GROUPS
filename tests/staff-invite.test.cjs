const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { stripTypeScriptTypes } = require("node:module");
const vm = require("node:vm");
const test = require("node:test");

function harness(inviteError) {
  let handler;
  const env = {
    APP_BASE_URL: "https://portal.example.test",
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "staff-id" } }, error: null }),
      admin: { inviteUserByEmail: async () => ({ data: { user: null }, error: inviteError }) },
    },
    from: () => ({ select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { role: "admin", status: "active" }, error: null }; } }),
  };
  const source = readFileSync("supabase/functions/staff-invite/index.ts", "utf8")
    .replace(/^import .*;\s*/m, "");
  vm.runInNewContext(stripTypeScriptTypes(source), {
    createClient: () => client,
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    console, Response, Request,
  });
  return () => handler(new Request("https://function.example.test", {
    method: "POST",
    headers: { Origin: env.APP_BASE_URL, Authorization: "Bearer token" },
    body: JSON.stringify({ fullName: "Staff member", email: "staff@example.test" }),
  }));
}

test("duplicate Auth account returns actionable guidance", async () => {
  const response = await harness({ message: "A user with this email address has already been registered" })();
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already has an account.*password recovery/);
});

test("email delivery failures are not mislabeled as duplicate accounts", async () => {
  const response = await harness({ message: "Error sending invite email" })();
  assert.equal(response.status, 502);
  const { error } = await response.json();
  assert.match(error, /email could not be sent/);
  assert.doesNotMatch(error, /already has an account/);
});
