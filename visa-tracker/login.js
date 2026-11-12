import { setupMessage, showMessage, supabase, supabaseReady } from "./shared.js";

const form = document.querySelector("[data-login]");
const message = document.querySelector("[data-message]");
const setup = document.querySelector("[data-setup]");
const reset = document.querySelector("[data-reset]");
const changePassword = document.querySelector("[data-change-password]");
const title = document.querySelector("[data-login-title]");

if (!supabaseReady) {
  setup.textContent = setupMessage;
  setup.hidden = false;
  form.querySelectorAll("input,button").forEach((item) => { item.disabled = true; });
  reset.disabled = true;
}
const invitation = window.location.hash.includes("type=invite");
const passwordRecovery = window.location.hash.includes("type=recovery");
const reason = new URLSearchParams(window.location.search).get("reason");
if (!invitation && !passwordRecovery && reason === "staff-access") {
  showMessage(message, "This account does not have active staff access. Ask an administrator to check its staff profile in Supabase.", true);
} else if (!invitation && !passwordRecovery && reason === "session") {
  showMessage(message, "Your sign-in session could not be found or has expired. Please sign in again.", true);
}
if (supabaseReady && (invitation || passwordRecovery)) {
  form.hidden = true;
  reset.hidden = true;
  changePassword.hidden = false;
  title.textContent = invitation ? "Set your password" : "Reset your password";
  supabase.auth.getSession().catch((error) => showMessage(message, error.message, true));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const values = new FormData(form);
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(values.get("email")).trim().toLowerCase(),
      password: String(values.get("password")),
    });
    if (error) throw error;
    window.location.replace("/visa-tracker/staff/");
  } catch (error) {
    showMessage(message, error.message || "Sign-in failed.", true);
  } finally {
    button.disabled = false;
  }
});

reset.addEventListener("click", async () => {
  if (!supabase) return;
  const email = form.elements.email.value.trim().toLowerCase();
  if (!email) {
    showMessage(message, "Enter your staff email address first.", true);
    form.elements.email.focus();
    return;
  }
  reset.disabled = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/visa-tracker/login/`,
    });
    if (error) throw error;
    showMessage(message, "If an account exists for that email, password recovery instructions have been sent.");
  } catch (error) {
    showMessage(message, error.message || "Password recovery could not be requested.", true);
  } finally {
    reset.disabled = false;
  }
});

changePassword.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(changePassword);
  const password = String(values.get("password"));
  if (password !== String(values.get("confirm_password"))) {
    showMessage(message, "The passwords do not match.", true);
    return;
  }
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    await supabase.auth.signOut();
    window.location.replace("/visa-tracker/login/");
  } catch (error) {
    showMessage(message, error.message || "The password could not be changed.", true);
  }
});
