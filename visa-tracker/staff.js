import {
  requireStaff, sendClientAccessLink, showMessage, setupMessage,
  supabase, supabaseReady, escapeHtml
} from "./shared.js";

const $ = (selector, root = document) => root.querySelector(selector);
const state = { profile: null, clients: [], applications: [], documents: [], selectedId: null };
const message = $("[data-message]");
const list = $("[data-list]");
const detail = $("[data-detail]");
const dialog = $("[data-dialog]");

function toast(text, error = false) {
  showMessage(message, text, error);
  window.setTimeout(() => { message.hidden = true; }, 7000);
}

function getClient(clientId) {
  return state.clients.find((client) => client.id === clientId);
}

function getApplication(applicationId) {
  return state.applications.find((application) => application.id === applicationId);
}

function getDocuments(applicationId) {
  return state.documents.filter((document) => document.application_id === applicationId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function applicationStatus(application) {
  if (application.final_status) return application.final_status;
  if (!application.application_started) {
    const docs = getDocuments(application.id);
    if (!docs.length) return "Checklist Not Configured";
    const required = docs.filter((document) => document.required && document.applicable);
    return required.every((document) => document.status === "verified")
      ? "Documents Complete" : "Documents In Progress";
  }
  if (application.appointment_status !== "Appointment Booked") return "Awaiting Appointment";
  return application.current_stage;
}

function progressValue(application) {
  const docs = getDocuments(application.id);
  const mandatory = docs.filter((doc) => doc.required && doc.applicable);
  const docPart = mandatory.length
    ? mandatory.filter((doc) => doc.status === "verified").length / mandatory.length
    : docs.length ? 1 : 0;
  const completed = [
    application.ukvi_status === "Completed",
    application.payment_status === "Payment Confirmation Received",
    application.appointment_status === "Appointment Booked",
    application.upload_status === "Completed",
  ].filter(Boolean).length;
  if (["Visa Approved", "Visa Refused"].includes(application.final_status)) return 100;
  return Math.round((docPart + completed) / 5 * 100);
}

async function loadData() {
  const [clientsResult, applicationsResult, documentsResult] = await Promise.all([
    supabase.from("clients").select("id,full_name,email,phone,portal_enabled,created_at").order("created_at", { ascending: false }),
    supabase.from("applications").select("*").order("updated_at", { ascending: false }),
    supabase.from("application_documents").select("*").order("sort_order"),
  ]);
  if (clientsResult.error) throw clientsResult.error;
  if (applicationsResult.error) throw applicationsResult.error;
  if (documentsResult.error) throw documentsResult.error;
  state.clients = clientsResult.data || [];
  state.applications = applicationsResult.data || [];
  state.documents = documentsResult.data || [];
  const { data: privateDetails, error: detailsError } = await supabase.from("staff_application_details").select("*");
  if (detailsError) throw detailsError;
  state.privateDetails = privateDetails || [];
  for (const application of state.applications) {
    application.staffDetails = state.privateDetails.find((item) => item.application_id === application.id) || null;
  }
  renderList();
  renderDetail();
  renderReports();
}

function renderList() {
  const search = $("[data-search]").value.trim().toLowerCase();
  const rows = state.applications.filter((application) => {
    const client = getClient(application.client_id);
    return client && [client.full_name, client.email, application.reference]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
  if (!rows.length) {
    list.innerHTML = `<p class="muted">${state.applications.length ? "No applications match your search." : "No clients have been registered yet."}</p>`;
    return;
  }
  list.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Reference</th><th>Destination</th><th>Status</th><th>Progress</th></tr></thead><tbody>${rows.map((application) => {
    const client = getClient(application.client_id);
    const percent = progressValue(application);
    const status = applicationStatus(application);
    const className = status === "Visa Approved" ? "good" : status === "Visa Refused" ? "bad" : "";
    return `<tr>
      <td data-label="Client"><button class="text-button" data-open="${escapeHtml(application.id)}">${escapeHtml(client.full_name)}</button></td>
      <td data-label="Reference">${escapeHtml(application.reference)}</td>
      <td data-label="Destination">${escapeHtml(application.destination)}</td>
      <td data-label="Status"><span class="badge ${className}">${escapeHtml(status)}</span></td>
      <td data-label="Progress"><div class="progress"><span style="width:${percent}%"></span></div><small>${percent}%</small></td>
    </tr>`;
  }).join("")}</tbody></table></div>`;
  list.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.open;
      renderDetail();
      detail.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function options(current, values) {
  return values.map((value) => `<option value="${escapeHtml(value)}"${current === value ? " selected" : ""}>${escapeHtml(value || "(Not set)")}</option>`).join("");
}

function renderDetail() {
  const application = getApplication(state.selectedId);
  if (!application) {
    detail.hidden = true;
    detail.innerHTML = "";
    return;
  }
  const client = getClient(application.client_id);
  const documents = getDocuments(application.id);
  const required = documents.filter((document) => document.required && document.applicable);
  const canProceed = documents.length > 0 && required.every((document) => document.status === "verified");
  const percent = progressValue(application);
  const allStagesComplete = application.ukvi_status === "Completed" &&
    application.payment_status === "Payment Confirmation Received" &&
    application.appointment_status === "Appointment Booked" &&
    application.upload_status === "Completed";

  detail.hidden = false;
  detail.innerHTML = `
    <div class="card-heading"><div><p class="eyebrow">${escapeHtml(application.reference)}</p><h2>${escapeHtml(client.full_name)}</h2></div><button class="button outline" data-close-detail>Back</button></div>
    <div class="facts">
      <div><small class="muted">Email</small><p>${escapeHtml(client.email)}</p></div>
      <div><small class="muted">Phone</small><p>${escapeHtml(client.phone)}</p></div>
      <div><small class="muted">Destination / visa</small><p>${escapeHtml(application.destination)} · ${escapeHtml(application.visa_category)}</p></div>
    </div>
    <p>Overall progress · <strong>${percent}%</strong></p><div class="progress"><span style="width:${percent}%"></span></div>
    <div class="card-heading"><h3>Document checklist</h3><span class="badge">${required.filter((doc) => doc.status === "verified").length}/${required.length} mandatory verified</span></div>
    <div class="doc-list">${documents.length ? documents.map((document) => `
      <div class="doc-row">
        <div><strong>${escapeHtml(document.label)}</strong><small class="muted"> · ${document.required ? "Mandatory" : "Optional"}${document.applicable ? "" : " · Not applicable"}</small></div>
        <select data-doc-rule="${escapeHtml(document.id)}" data-old="${document.required && document.applicable ? "required" : document.required ? "not_applicable" : "optional"}" aria-label="Requirement for ${escapeHtml(document.label)}">
          ${options(document.required && document.applicable ? "required" : document.required ? "not_applicable" : "optional", ["required", "optional", "not_applicable"])}
        </select>
        <select data-doc-status="${escapeHtml(document.id)}" data-old="${escapeHtml(document.status)}" aria-label="Status for ${escapeHtml(document.label)}">
          ${options(document.status, ["pending", "received", "verified", "needs_correction"])}
        </select>
      </div>`).join("") : `<p class="notice">No checklist is configured for this application type.</p>`}</div>
    <div class="heading-row">
      <button class="button gold" data-proceed${!canProceed || application.application_started ? " disabled" : ""}>${application.application_started ? "Application stage unlocked" : "Proceed to visa application"}</button>
      <button class="button outline" data-client-link>${client.portal_enabled ? "Email / resend client access link" : "Enable access and email link"}</button>
      ${client.portal_enabled ? `<button class="button outline" data-revoke-link>Revoke client access</button>` : ""}
    </div>
    <h3>Application progress</h3>
    <form data-workflow>
      <div class="form-grid">
        <label>Current stage<select name="current_stage">${options(application.current_stage, ["Document collection", "Documents complete", "Application in progress", "Awaiting appointment", "Awaiting visa decision"])}</select></label>
        <label>UKVI application form<select name="ukvi_status">${options(application.ukvi_status, ["Not Started", "In Progress", "Completed"])}</select></label>
        <label>Visa payment<select name="payment_status">${options(application.payment_status, ["Awaiting Payment", "Payment Made", "Payment Confirmation Received"])}</select></label>
        <label>Payment date<input name="payment_date" type="date" value="${escapeHtml(application.payment_date || "")}"></label>
        <label>Payment amount (staff only)<input name="payment_amount" type="number" min="0" step="0.01" value="${escapeHtml(application.staffDetails?.payment_amount ?? "")}"></label>
        <label>VFS appointment<select name="appointment_status">${options(application.appointment_status, ["Not Started", "In Progress", "Appointment Booked"])}</select></label>
        <label>Appointment date<input name="appointment_date" type="date" value="${escapeHtml(application.appointment_date || "")}"></label>
        <label>Appointment time<input name="appointment_time" value="${escapeHtml(application.appointment_time || "")}"></label>
        <label>VFS centre<input name="vfs_centre" value="${escapeHtml(application.vfs_centre || "")}"></label>
        <label>Document upload<select name="upload_status">${options(application.upload_status, ["Not Started", "In Progress", "Completed"])}</select></label>
        <label>Final application status<select name="final_status">${options(application.final_status, ["", "Awaiting Biometrics", "Biometrics Completed", "Awaiting Visa Decision", "Visa Approved", "Visa Refused"])}</select></label>
      </div>
      <button class="button primary" type="submit">Save progress</button>
    </form>
    <h3>Internal staff notes</h3>
    <form class="toolbar" data-note-form>
      <select name="document_id" aria-label="Attach note to a document"><option value="">General application note</option>${documents.map((document) => `<option value="${escapeHtml(document.id)}">${escapeHtml(document.label)}</option>`).join("")}</select>
      <input name="note" maxlength="3000" placeholder="Private staff note" required><button class="button outline">Add note</button>
    </form>
    <div data-notes></div>`;

  $("[data-close-detail]", detail).addEventListener("click", () => { state.selectedId = null; renderDetail(); });
  detail.querySelectorAll("[data-doc-status]").forEach((control) => {
    control.addEventListener("change", async () => {
      try {
        const { error } = await supabase.from("application_documents")
          .update({ status: control.value, updated_by: state.profile.id }).eq("id", control.dataset.docStatus);
        if (error) throw error;
        await loadData();
        toast("Document status saved.");
      } catch (error) {
        control.value = control.dataset.old;
        toast(error.message, true);
      }
    });
    detail.querySelectorAll("[data-doc-rule]").forEach((control) => {
      control.addEventListener("change", async () => {
        try {
          const { error } = await supabase.from("application_documents").update({
            required: control.value !== "optional",
            applicable: control.value !== "not_applicable",
          }).eq("id", control.dataset.docRule);
          if (error) throw error;
          await loadData();
          toast("Document requirement saved.");
        } catch (error) {
          control.value = control.dataset.old;
          toast(error.message, true);
        }
      });
    });
  });
  $("[data-proceed]", detail).addEventListener("click", async () => {
    try {
      const { error } = await supabase.from("applications")
        .update({ application_started: true, current_stage: "Application in progress" }).eq("id", application.id);
      if (error) throw error;
      await loadData();
      toast("Visa application stage unlocked.");
    } catch (error) { toast(error.message, true); }
  });
  $("[data-client-link]", detail).addEventListener("click", async () => {
    try {
      if (!client.portal_enabled) {
        const { error } = await supabase.from("clients").update({ portal_enabled: true }).eq("id", client.id);
        if (error) throw error;
      }
      const result = await sendClientAccessLink(application.id);
      await loadData();
      toast(result.message);
    } catch (error) { toast(error.message, true); }
  });
  $("[data-revoke-link]", detail)?.addEventListener("click", async () => {
    try {
      const { error } = await supabase.from("clients").update({ portal_enabled: false }).eq("id", client.id);
      if (error) throw error;
      await loadData();
      toast("Client portal access revoked.");
    } catch (error) { toast(error.message, true); }
  });
  $("[data-workflow]", detail).addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const changes = {
      current_stage: values.get("current_stage"),
      ukvi_status: values.get("ukvi_status"),
      payment_status: values.get("payment_status"),
      payment_date: values.get("payment_date") || null,
      appointment_status: values.get("appointment_status"),
      appointment_date: values.get("appointment_date") || null,
      appointment_time: values.get("appointment_time"),
      vfs_centre: values.get("vfs_centre"),
      upload_status: values.get("upload_status"),
      final_status: values.get("final_status"),
    };
    const milestoneChanged = ["current_stage", "ukvi_status", "payment_status", "appointment_status", "upload_status", "final_status"]
      .some((key) => changes[key] !== application[key]);
    try {
        const amount = values.get("payment_amount");
        const { error: detailError } = await supabase.from("staff_application_details").upsert({
          application_id: application.id,
          payment_amount: amount === "" ? null : Number(amount),
        });
        if (detailError) throw detailError;
        const { error } = await supabase.from("applications").update(changes).eq("id", application.id);
        if (error) throw error;
      await loadData();
      toast("Progress saved.");
      if (milestoneChanged) {
        const { error: emailError } = await supabase.functions.invoke("client-access", {
          body: { action: "milestone", applicationId: application.id },
        });
        if (emailError) toast(`Progress saved, but update email failed: ${emailError.message}`, true);
      }
    } catch (error) { toast(error.message, true); }
  });
  $("[data-note-form]", detail).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const { error } = await supabase.from("internal_notes").insert({
        application_id: application.id,
        document_id: values.get("document_id") || null,
        author_id: state.profile.id,
        note: String(values.get("note")).trim(),
      });
      if (error) throw error;
      form.reset();
      await renderNotes(application.id);
      toast("Private note saved.");
    } catch (error) { toast(error.message, true); }
  });
  void renderNotes(application.id).catch((error) => { $("[data-notes]", detail).textContent = error.message; });
}

async function renderNotes(applicationId) {
  const { data, error } = await supabase.from("internal_notes")
    .select("note,document_id,created_at,profiles(full_name,email)").eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  $("[data-notes]", detail).innerHTML = (data || []).map((item) => {
    const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
    const document = state.documents.find((entry) => entry.id === item.document_id);
    return `<p>${document ? `<strong>${escapeHtml(document.label)}:</strong> ` : ""}${escapeHtml(item.note)}<br><small class="muted">${escapeHtml(profile?.full_name || profile?.email || "Staff")} · ${new Date(item.created_at).toLocaleString()}</small></p>`;
  }).join("") || `<p class="muted">No internal notes yet.</p>`;
}

function renderReports() {
  const counts = {
    applications: state.applications.length,
    incomplete: state.applications.filter((app) => ["Documents In Progress", "Checklist Not Configured"].includes(applicationStatus(app))).length,
    appointments: state.applications.filter((app) => app.appointment_status !== "Appointment Booked" && app.application_started).length,
    awaitingDecision: state.applications.filter((app) => app.final_status === "Awaiting Visa Decision").length,
    approved: state.applications.filter((app) => app.final_status === "Visa Approved").length,
    refused: state.applications.filter((app) => app.final_status === "Visa Refused").length,
  };
  $("[data-reports]").innerHTML = `<h2>Application summary</h2><div class="facts">${Object.entries(counts).map(([label, count]) => `<div class="card"><small>${escapeHtml(label)}</small><p><strong>${count}</strong></p></div>`).join("")}</div>`;
}

async function renderTimeline() {
  const { data, error } = await supabase.from("application_timeline")
    .select("title,description,occurred_at,applications(reference,clients(full_name))")
    .order("occurred_at", { ascending: false }).limit(100);
  if (error) throw error;
  $("[data-timeline]").innerHTML = `<h2>Application timeline</h2><div class="timeline">${(data || []).map((item) => {
    const app = Array.isArray(item.applications) ? item.applications[0] : item.applications;
    const client = Array.isArray(app?.clients) ? app.clients[0] : app?.clients;
    return `<article class="timeline-row"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(client?.full_name || "")} · ${escapeHtml(app?.reference || "")}</p><small>${escapeHtml(item.description || "")}</small></div><small>${new Date(item.occurred_at).toLocaleString()}</small></article>`;
  }).join("") || `<p class="muted">No updates yet.</p>`}</div>`;
}

async function renderStaff() {
  const { data, error } = await supabase.from("profiles")
    .select("full_name,email,role,status").order("created_at");
  if (error) throw error;
  $("[data-staff]").innerHTML = `<h2>Staff accounts</h2>
    <p class="muted">Invite staff to create their own secure JIT account. Public registration is disabled.</p>
    <form class="form-grid" data-staff-invite>
      <label>Full name<input name="full_name" maxlength="120" required></label>
      <label>Email address<input name="email" type="email" maxlength="160" required></label>
      <div><button class="button primary" type="submit">Send staff invitation</button></div>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>${(data || []).map((item) => `<tr><td>${escapeHtml(item.full_name)}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.status)}</td></tr>`).join("")}</tbody></table></div>`;
  $("[data-staff-invite]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    button.disabled = true;
    try {
      const { data: result, error: inviteError } = await supabase.functions.invoke("staff-invite", {
        body: {
          fullName: String(values.get("full_name")).trim(),
          email: String(values.get("email")).trim().toLowerCase(),
        },
      });
      if (inviteError) throw new Error(result?.error || inviteError.message);
      if (result?.error) throw new Error(result.error);
      toast(result.message);
      await renderStaff();
    } catch (inviteError) {
      toast(inviteError.message || "The staff invitation could not be sent.", true);
    } finally {
      button.disabled = false;
    }
  });
}

async function renderActivity() {
  const { data, error } = await supabase.from("activity_logs")
    .select("action,entity,created_at,profiles(full_name,email)")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  $("[data-activity]").innerHTML = `<h2>Recent activity</h2><div class="table-wrap"><table><thead><tr><th>Time</th><th>Staff</th><th>Action</th><th>Record type</th></tr></thead><tbody>${(data || []).map((item) => {
    const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
    return `<tr><td>${new Date(item.created_at).toLocaleString()}</td><td>${escapeHtml(profile?.full_name || profile?.email || "System")}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.entity)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", async () => {
    document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== button.dataset.tab; });
    try {
      if (button.dataset.tab === "timeline") await renderTimeline();
      if (button.dataset.tab === "reports") renderReports();
      if (button.dataset.tab === "staff" && state.profile.role === "admin") await renderStaff();
      if (button.dataset.tab === "activity") await renderActivity();
    } catch (error) { toast(error.message, true); }
  });
});

$("[data-search]").addEventListener("input", renderList);
$("[data-refresh]").addEventListener("click", () => { void loadData().catch((error) => toast(error.message, true)); });
$("[data-add]").addEventListener("click", () => {
  $("[data-client-form]").elements.registered_at.value = new Date().toISOString().slice(0, 10);
  dialog.showModal();
});
$("[data-close]").addEventListener("click", () => dialog.close());
$("[data-sign-out]").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.replace("/visa-tracker/login/");
});
$("[data-client-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { data: applicationId, error } = await supabase.rpc("create_application", {
      client_info: {
        fullName: values.get("full_name"),
        email: String(values.get("email")).trim().toLowerCase(),
        phone: values.get("phone"),
      },
      application_info: {
        destination: values.get("destination"),
        visaCategory: values.get("visa_category"),
        registeredAt: values.get("registered_at"),
      },
    });
    if (error) throw error;
    const { error: accessError } = await supabase.functions.invoke("client-access", {
      body: { action: "create", applicationId },
    });
    form.reset();
    dialog.close();
    state.selectedId = applicationId;
    await loadData();
    if (accessError) toast(`Application saved, but client email failed: ${accessError.message}`, true);
    else toast("Application registered. A secure progress link has been emailed to the client.");
  } catch (error) {
    showMessage($("[data-form-message]"), error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function initialize() {
  const setup = $("[data-setup]");
  if (!supabaseReady) {
    setup.textContent = setupMessage;
    setup.hidden = false;
    list.textContent = "Supabase is not configured. No records are displayed.";
    document.querySelectorAll("main button, main input").forEach((item) => { item.disabled = true; });
    $("[data-sign-out]").disabled = true;
    return;
  }
  try {
    state.profile = await requireStaff();
    if (!state.profile) return;
    $("[data-staff-name]").textContent = state.profile.full_name || state.profile.email;
    if (state.profile.role !== "admin") $('[data-tab="staff"]').hidden = true;
    await loadData();
  } catch (error) {
    setup.textContent = `The portal could not load: ${error.message}`;
    setup.hidden = false;
    list.textContent = "Application data is unavailable.";
  }
}

void initialize();
window.setInterval(() => {
  if (supabaseReady && !document.hidden) {
    void loadData().catch((error) => toast(`Automatic refresh failed: ${error.message}`, true));
  }
}, 60_000);
