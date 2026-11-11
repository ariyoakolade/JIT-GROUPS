import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const appUrl = (Deno.env.get("APP_BASE_URL") || "").replace(/\/$/, "");
const allowedOrigins = [appUrl, "http://localhost:8000", "http://127.0.0.1:8000"].filter(Boolean);

function response(origin: string, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigins.includes(origin)) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  if (request.method !== "POST") return response(origin, { error: "Method not allowed." }, 405);

  try {
    if (!appUrl) return response(origin, { error: "The application URL is not configured." }, 503);
    const url = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return response(origin, { error: "Please sign in again." }, 401);

    const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData.user) return response(origin, { error: "Please sign in again." }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,role,status").eq("id", userData.user.id).maybeSingle();
    if (profileError || !profile || profile.status !== "active" || !["admin", "staff"].includes(profile.role)) {
      return response(origin, { error: "You are not authorized to send client emails." }, 403);
    }

    const body = await request.json();
    const action = String(body.action || "create");
    const applicationId = String(body.applicationId || "");
    if (!/^[0-9a-f-]{36}$/i.test(applicationId) || !["create", "milestone"].includes(action)) {
      return response(origin, { error: "A valid application email request is required." }, 400);
    }

    const { data: application, error: applicationError } = await admin.from("applications")
      .select("id,reference,current_stage,final_status,ukvi_status,payment_status,appointment_status,upload_status,clients!inner(id,full_name,email,portal_enabled)")
      .eq("id", applicationId).maybeSingle();
    if (applicationError || !application) return response(origin, { error: "Application not found." }, 404);
    const client = Array.isArray(application.clients) ? application.clients[0] : application.clients;
    if (!client.portal_enabled) return response(origin, { error: "Client portal access is disabled. Enable it before sending an email." }, 403);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("EMAIL_FROM") || "JIT Travels <VISAAPPLICATION@jitgroupofcompanies.com>";
    if (Deno.env.get("EMAIL_SENDING_ENABLED") !== "true" || !resendKey) {
      return response(origin, { error: "Email sending is disabled until Resend and the sender domain are configured." }, 503);
    }

    let subject: string;
    let text: string;
    let html: string;
    if (action === "create") {
      let createError = null;
      const { error } = await admin.auth.admin.createUser({
        email: client.email,
        email_confirm: true,
        user_metadata: { full_name: client.full_name, account_type: "client" },
      });
      createError = error;
      if (createError && !/already (been )?registered|already exists/i.test(createError.message)) {
        throw new Error("The client portal account could not be prepared.");
      }

      const { data: magicLink, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: client.email,
        options: { redirectTo: `${appUrl}/visa-tracker/portal/` },
      });
      if (linkError || !magicLink.properties?.action_link) throw new Error("A secure sign-in link could not be created.");
      const safeName = escapeHtml(client.full_name);
      const safeReference = escapeHtml(application.reference);
      const safeLink = escapeHtml(magicLink.properties.action_link);
      subject = `Your JIT Travels application progress · ${application.reference}`;
      text = `Hello ${client.full_name}, your application ${application.reference} is ready to view. Open this one-time sign-in link: ${magicLink.properties.action_link}`;
      html = `<p>Hello ${safeName},</p><p>Your JIT Travels application <strong>${safeReference}</strong> is ready to view.</p><p><a href="${safeLink}">Open your secure progress page</a></p><p>This sign-in link is private and can be used once. If it expires, contact JIT Travels to request another.</p>`;
    } else {
      const milestone = application.final_status === "Visa Approved" || application.final_status === "Visa Refused"
        ? application.final_status
        : application.final_status === "Awaiting Visa Decision" ? application.final_status
        : application.current_stage;
      subject = `JIT Travels application update · ${application.reference}`;
      text = `Hello ${client.full_name}, your application ${application.reference} has been updated. Current stage: ${milestone}. Sign in at ${appUrl}/visa-tracker/portal/ to view progress.`;
      html = `<p>Hello ${escapeHtml(client.full_name)},</p><p>Your application <strong>${escapeHtml(application.reference)}</strong> has been updated.</p><p>Current stage: <strong>${escapeHtml(milestone)}</strong>.</p><p>Sign in at <a href="${escapeHtml(`${appUrl}/visa-tracker/portal/`)}">your JIT Travels progress page</a> to see the latest details.</p>`;
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [client.email], subject, text, html }),
    });
    const emailResult = await emailResponse.json().catch(() => ({}));
    const { error: logError } = await admin.from("email_notifications").insert({
      application_id: application.id,
      recipient: client.email,
      kind: action === "create" ? "client_access" : "milestone",
      status: emailResponse.ok ? "sent" : "failed",
      provider_id: emailResult.id || null,
      created_by: userData.user.id,
    });
    if (logError) console.error("Email log write failed:", logError.message);
    if (!emailResponse.ok) return response(origin, { error: "The email service could not send this message." }, 502);
    return response(origin, { message: action === "create" ? "Secure client access link emailed." : "Application update emailed." });
  } catch (error) {
    console.error("Client email function failed:", error);
    return response(origin, { error: "The email request could not be completed. Check the Supabase function logs." }, 500);
  }
});
