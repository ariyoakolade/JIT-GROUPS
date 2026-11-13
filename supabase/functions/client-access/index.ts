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

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] || character);
}

function welcomeEmail(name: string, reference: string, registeredAt: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registeredAt)) throw new Error("Invalid registration date.");
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${registeredAt}T00:00:00Z`));
  const greeting = `Dear ${name},`;
  const paragraphs = [
    "Thank you for choosing JIT Travels for your visa application and travel assistance needs.",
    "We are pleased to confirm that your application has been successfully registered in our system. Our team will be working with you throughout the process and providing the necessary guidance and assistance at every important stage.",
    "We are pleased to inform you that the processing of your application has commenced. Our team is currently reviewing and verifying the documents and information submitted to ensure that everything is in order.",
    "Should we require any additional documents, clarification or information, a member of our team will contact you directly.",
    "Please be assured that we will keep you informed of important developments as your application progresses.",
    "We appreciate your trust in JIT Travels and look forward to providing you with a smooth, transparent and professional application experience.",
    "Thank you for choosing us.",
  ];
  const text = `${greeting}\n\nWELCOME TO JIT TRAVELS!\n\n${paragraphs[0]}\n\n${paragraphs[1]}\n\nYOUR APPLICATION DETAILS\n\nApplication Reference: ${reference}\nApplication Status: Processing Commenced\nRegistration Date: ${date}\n\nWHAT HAPPENS NEXT?\n\n${paragraphs.slice(2).join("\n\n")}\n\nWarm regards,\nVisa Processing Team\nJIT Travels`;
  const html = `<div style="background:#f5f7f6;padding:24px;font-family:Arial,sans-serif;color:#17272b"><div style="max-width:600px;margin:auto;background:#fff;border-top:5px solid #c69a2b;padding:32px;line-height:1.6"><p style="color:#102b33;font-size:20px;font-weight:bold">JIT TRAVELS</p><h1 style="color:#102b33;font-size:24px">WELCOME TO JIT TRAVELS!</h1><p>${escapeHtml(greeting)}</p><p>${escapeHtml(paragraphs[0])}</p><p>${escapeHtml(paragraphs[1])}</p><h2 style="color:#102b33;font-size:18px">YOUR APPLICATION DETAILS</h2><p><strong>Application Reference:</strong> ${escapeHtml(reference)}<br><strong>Application Status:</strong> Processing Commenced<br><strong>Registration Date:</strong> ${escapeHtml(date)}</p><h2 style="color:#102b33;font-size:18px">WHAT HAPPENS NEXT?</h2>${paragraphs.slice(2).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}<p>Warm regards,<br><strong>Visa Processing Team<br>JIT Travels</strong></p></div></div>`;
  return { subject: `Welcome to JIT Travels - ${reference}`, text, html };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  const webhookSecret = Deno.env.get("WELCOME_WEBHOOK_SECRET");
  const webhook = Boolean(webhookSecret && request.headers.get("x-welcome-secret") === webhookSecret);
  if (!webhook && !allowedOrigins.includes(origin)) return new Response("Forbidden", { status: 403 });
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
    const url = requiredEnv("SUPABASE_URL");
    const admin = createClient(url, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    if (!webhook) {
      const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return response(origin, { error: "Please sign in again." }, 401);
      const auth = createClient(url, requiredEnv("SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
      const { data: user, error: authError } = await auth.auth.getUser(token);
      if (authError || !user.user) return response(origin, { error: "Please sign in again." }, 401);
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("role,status").eq("id", user.user.id).maybeSingle();
      if (profileError) throw new Error(`Could not check staff permissions: ${profileError.message}`);
      if (!profile || profile.status !== "active" || !["admin", "staff"].includes(profile.role)) {
        return response(origin, { error: "Only active staff can send welcome emails." }, 403);
      }
    }

    const body = await request.json();
    const applicationId = webhook ? body.record?.application_id : body.applicationId;
    if (webhook && (body.type !== "INSERT" || body.schema !== "public" ||
        body.table !== "email_notifications")) {
      return response(origin, { error: "Invalid welcome notification event." }, 400);
    }
    if (webhook && body.record?.kind !== "welcome") {
      return response(origin, { message: "No welcome email required." });
    }
    if (!webhook && body.action !== "welcome") return response(origin, { error: "Invalid email action." }, 400);
    if (typeof applicationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId)) {
      return response(origin, { error: "A valid application is required." }, 400);
    }
    const { data: claim, error: claimError } = await admin.rpc("claim_welcome_email", { p_application_id: applicationId });
    if (claimError) throw new Error(`Could not claim welcome email: ${claimError.message}`);
    if (claim.state === "not_found") return response(origin, { error: "No welcome email is queued for this application." }, 404);
    if (claim.state === "sent") return response(origin, { message: "Welcome email was already accepted by the email provider." });
    if (claim.state === "processing") return response(origin, { message: "The welcome email is already being processed." });
    if (claim.state === "expired") {
      return response(origin, { error: "The previous email attempt is too old for a safe retry. Check Resend before contacting an administrator." }, 409);
    }
    if (claim.state !== "claimed") throw new Error("Unexpected welcome email state.");

    let providerId: string | null = null;
    let failure: string | null = null;
    try {
      if (Deno.env.get("EMAIL_SENDING_ENABLED") !== "true") throw new Error("Welcome email sending is disabled.");
      const resendKey = requiredEnv("RESEND_API_KEY");
      if (typeof claim.details?.name !== "string" || typeof claim.details?.reference !== "string" ||
          typeof claim.details?.registered_at !== "string" || typeof claim.recipient !== "string") {
        throw new Error("The welcome email details are incomplete.");
      }
      const email = welcomeEmail(claim.details.name, claim.details.reference, claim.details.registered_at);
      const { error: startError } = await admin.rpc("start_welcome_request", { p_id: claim.id });
      if (startError) throw new Error(`Could not record email request: ${startError.message}`);
      const result = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `jit-welcome/${claim.id}`,
        },
        body: JSON.stringify({
          from: "JIT Travels <VISAAPPLICATION@jitgroupofcompanies.com>",
          to: [claim.recipient], ...email,
        }),
      });
      if (!result.ok) throw new Error(`Resend rejected the welcome email (HTTP ${result.status}).`);
      const resultBody = await result.json();
      if (typeof resultBody.id !== "string") throw new Error("Resend returned no email ID.");
      providerId = resultBody.id;
    } catch (error) {
      failure = error instanceof Error ? error.message : "The welcome email could not be sent.";
      console.error("Welcome email failed:", failure);
    }
    const { error: finishError } = await admin.rpc("finish_welcome_email", {
      p_id: claim.id, p_provider_id: providerId, p_error: failure,
    });
    if (finishError) throw new Error(`Could not record welcome email result: ${finishError.message}`);
    if (failure) return response(origin, { error: failure }, 502);
    return response(origin, { message: "Welcome email accepted by the email provider." });
  } catch (error) {
    console.error("Welcome email request failed:", error);
    return response(origin, { error: "The welcome email could not be processed. Check the function logs." }, 500);
  }
});
