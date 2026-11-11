import { escapeHtml, showMessage, setupMessage, supabase, supabaseReady } from "./shared.js";

const accessCard = document.querySelector("[data-access-card]");
const progressCard = document.querySelector("[data-progress]");
const emailForm = document.querySelector("[data-email-form]");
const message = document.querySelector("[data-message]");
const setup = document.querySelector("[data-setup]");
let currentClientId = null;
let loading = false;

function percentage(application, documents) {
  const required = documents.filter((document) => document.required && document.applicable);
  const docs = required.length
    ? required.filter((document) => document.status === "verified").length / required.length
    : documents.length ? 1 : 0;
  const stages = [
    application.ukvi_status === "Completed",
    application.payment_status === "Payment Confirmation Received",
    application.appointment_status === "Appointment Booked",
    application.upload_status === "Completed",
  ].filter(Boolean).length;
  if (["Visa Approved", "Visa Refused"].includes(application.final_status)) return 100;
  return Math.round((docs + stages) / 5 * 100);
}

function render(client, application, documents, timeline) {
  const progress = percentage(application, documents);
  const status = application.final_status || application.current_stage;
  const stages = [
    ["UKVI application form", application.ukvi_status],
    ["Visa payment", application.payment_status],
    ["VFS appointment", application.appointment_status],
    ["Document upload", application.upload_status],
    ["Final application status", application.final_status || "Not set"],
  ];
  progressCard.innerHTML = `
    <p class="eyebrow">Application reference</p><h1>${escapeHtml(application.reference)}</h1>
    <p>Hello ${escapeHtml(client.full_name)}</p><span class="badge">${escapeHtml(status)}</span>
    <p>Overall progress · <strong>${progress}%</strong></p><div class="progress"><span style="width:${progress}%"></span></div>
    <div class="facts">
      <div><small class="muted">Destination</small><p>${escapeHtml(application.destination)}</p></div>
      <div><small class="muted">Visa category</small><p>${escapeHtml(application.visa_category)}</p></div>
      <div><small class="muted">Registered</small><p>${new Date(`${application.registered_at}T00:00:00`).toLocaleDateString()}</p></div>
      <div><small class="muted">Last updated</small><p>${new Date(application.updated_at).toLocaleString()}</p></div>
    </div>
    <h2>Document checklist</h2>
    <div class="doc-list">${documents.length ? documents.map((document) => {
      const state = document.applicable ? document.status.replace("_", " ") : "Not applicable";
      const badge = document.status === "verified" ? "good" : document.status === "needs_correction" ? "bad" : "";
      return `<div class="doc-row"><span>${escapeHtml(document.label)}${document.required && document.applicable ? " · Required" : ""}</span><span class="badge ${badge}">${escapeHtml(state)}</span></div>`;
    }).join("") : `<p class="muted">Your checklist will appear here when it is ready.</p>`}</div>
    <h2>Application stages</h2>
    <div class="timeline">${stages.map(([label, value]) => `<div class="timeline-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("")}</div>
    <h2>Application timeline</h2>
    <div class="timeline">${timeline.length ? timeline.map((item) => `<article class="timeline-row"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description)}</p></div><small>${new Date(item.occurred_at).toLocaleString()}</small></article>`).join("") : `<p class="muted">No timeline updates yet.</p>`}</div>
    <button class="button outline" type="button" data-refresh>Refresh progress</button>
    <button class="button outline" type="button" data-sign-out>Sign out</button>`;
  progressCard.hidden = false;
  accessCard.hidden = true;
  progressCard.querySelector("[data-refresh]").addEventListener("click", () => { void loadClientData(); });
  progressCard.querySelector("[data-sign-out]").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.reload();
  });
}

async function loadClientData() {
  if (loading) return;
  loading = true;
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user?.email) {
      progressCard.hidden = true;
      accessCard.hidden = false;
      return;
    }
    const { data: clients, error: clientError } = await supabase.from("clients")
      .select("id,full_name,portal_enabled").eq("email", user.email.toLowerCase());
    if (clientError) throw clientError;
    const client = (clients || []).find((item) => item.portal_enabled);
    if (!client) {
      await supabase.auth.signOut();
      showMessage(message, "This email does not currently have an active JIT Travels application link. Contact the team if you need access.", true);
      accessCard.hidden = false;
      progressCard.hidden = true;
      return;
    }
    currentClientId = client.id;
    const [applicationResult, documentsResult, timelineResult] = await Promise.all([
      supabase.from("applications").select("*").eq("client_id", client.id).maybeSingle(),
      supabase.from("application_documents").select("id,label,required,applicable,status,sort_order")
        .eq("client_id", client.id).order("sort_order"),
      supabase.from("application_timeline").select("title,description,occurred_at")
        .eq("client_id", client.id).eq("client_visible", true)
        .order("occurred_at", { ascending: false }).limit(50),
    ]);
    if (applicationResult.error) throw applicationResult.error;
    if (documentsResult.error) throw documentsResult.error;
    if (timelineResult.error) throw timelineResult.error;
    if (!applicationResult.data) throw new Error("No application is currently associated with this client account.");
    render(client, applicationResult.data, documentsResult.data || [], timelineResult.data || []);
  } catch (error) {
    accessCard.hidden = false;
    progressCard.hidden = true;
    showMessage(message, error.message || "Application progress could not be loaded.", true);
  } finally {
    loading = false;
  }
}

emailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const button = emailForm.querySelector("button");
  button.disabled = true;
  try {
    const email = String(new FormData(emailForm).get("email")).trim().toLowerCase();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/visa-tracker/portal/`,
        shouldCreateUser: false,
      },
    });
    if (error) throw error;
    showMessage(message, "If your email is registered, a secure sign-in link will arrive shortly.");
  } catch (error) {
    showMessage(message, "The sign-in email could not be sent. Please check the address or try again later.", true);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentClientId && supabase) void loadClientData();
});

if (!supabaseReady) {
  setup.textContent = setupMessage;
  setup.hidden = false;
  emailForm.querySelectorAll("input,button").forEach((item) => { item.disabled = true; });
} else {
  void loadClientData();
}

window.setInterval(() => {
  if (currentClientId && !document.hidden) void loadClientData();
}, 60_000);
