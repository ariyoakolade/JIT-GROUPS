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
    const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return response(origin, { error: "Please sign in again." }, 401);

    const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData.user) return response(origin, { error: "Please sign in again." }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role,status").eq("id", userData.user.id).maybeSingle();
    if (profileError) {
      console.error("Staff inviter profile lookup failed:", profileError.message);
      return response(origin, { error: "Staff account permissions could not be checked." }, 500);
    }
    if (!profile || profile.status !== "active" || profile.role !== "admin") {
      return response(origin, { error: "Only an active administrator can invite staff." }, 403);
    }

    const body = await request.json();
    const fullName = String(body?.fullName || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    if (fullName.length < 1 || fullName.length > 120 ||
        email.length > 160 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return response(origin, { error: "Enter a valid staff name and email address." }, 400);
    }

    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, account_type: "staff" },
      redirectTo: `${appUrl}/visa-tracker/login/`,
    });
    if (inviteError || !invitation.user) {
      console.error("Staff invitation failed:", inviteError?.message || "No invited user returned.");
      return response(origin, { error: "The invitation could not be sent. Check whether this email already has an account." }, 409);
    }

    const { error: insertError } = await admin.from("profiles").insert({
      id: invitation.user.id,
      email,
      full_name: fullName,
      role: "staff",
    });
    if (insertError) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(invitation.user.id);
      if (deleteError) console.error("Failed to roll back unprofiled staff invite:", deleteError.message);
      console.error("Staff profile creation failed:", insertError.message);
      return response(origin, { error: "The staff profile could not be created. Please try the invitation again." }, 500);
    }

    return response(origin, { message: `Invitation sent to ${email}.` });
  } catch (error) {
    console.error("Staff invitation function failed:", error);
    return response(origin, { error: "The staff invitation could not be completed." }, 500);
  }
});
