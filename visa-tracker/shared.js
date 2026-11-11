import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window;
export const supabaseReady = Boolean(
  config.JIT_SUPABASE_URL &&
  config.JIT_SUPABASE_PUBLISHABLE_KEY &&
  /^https:\/\/.+/.test(config.JIT_SUPABASE_URL)
);

export const supabase = supabaseReady
  ? createClient(config.JIT_SUPABASE_URL, config.JIT_SUPABASE_PUBLISHABLE_KEY)
  : null;

export const setupMessage = "The secure portal is awaiting Supabase setup. No client data is loaded or saved yet.";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

export function showMessage(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle("error", isError);
  node.hidden = false;
}

export async function requireStaff() {
  if (!supabaseReady) return null;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) {
    window.location.replace("/visa-tracker/login/");
    return null;
  }
  const { data: profile, error } = await supabase.from("profiles")
    .select("id,email,full_name,role,status")
    .eq("id", sessionData.session.user.id).maybeSingle();
  if (error) throw error;
  if (!profile || profile.status !== "active" || !["admin", "staff"].includes(profile.role)) {
    await supabase.auth.signOut();
    window.location.replace("/visa-tracker/login/");
    return null;
  }
  return profile;
}

export async function sendClientAccessLink(applicationId) {
  const { data, error } = await supabase.functions.invoke("client-access", {
    body: { applicationId },
  });
  if (error) throw new Error(data?.error || error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
