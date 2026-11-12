import {
  requireStaff, sendClientAccessLink, showMessage, setupMessage,
  supabase, supabaseReady, escapeHtml
} from "./shared.js";

const $ = (selector, root = document) => root.querySelector(selector);
const state = { profile: null, clients: [], applications: [], documents: [], selectedId: null };
const message = $("[data-message]");
const list = $("[data-list]");
const detail = $("[data-detail]");
const isDetailPage = Boolean(detail);
if (isDetailPage) state.selectedId = new URLSearchParams(window.location.search).get("id");
const dialog = $("[data-dialog]");

function toast(text, error = false) {
  const target = (detail && $("[data-detail-message]", detail)) || message;
  if (!target) throw new Error("The portal status message area is unavailable.");
  showMessage(target, text, error);
  window.setTimeout(() => { target.hidden = true; }, 7000);
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
  if (isDetailPage) renderDetail();
  else {
    renderList();
    renderReports();
  }
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
      <td data-label="Client"><a class="text-button" href="/visa-tracker/staff/application/?id=${encodeURIComponent(application.id)}">${escapeHtml(client.full_name)}</a></td>
      <td data-label="Reference">${escapeHtml(application.reference)}</td>
      <td data-label="Destination">${escapeHtml(application.destination)}</td>
      <td data-label="Status"><span class="badge ${className}">${escapeHtml(status)}</span></td>
      <td data-label="Progress"><div class="progress"><span style="width:${percent}%"></span></div><small>${percent}%</small></td>
    </tr>`;
  }).join("")}</tbody></table></div>`;
}

function options(current, values) {
  return values.map((value) => `<option value="${escapeHtml(value)}"${current === value ? " selected" : ""}>${escapeHtml(value || "(Not set)")}</option>`).join("");
}

function statusOptions(current) {
  const prompt = current === "needs_correction"
    ? `<option value="" selected disabled>Needs correction — choose status</option>` : "";
  return prompt + [["pending", "Not submitted"], ["received", "Submitted"], ["verified", "Verified"]]
    .map(([value, label]) => `<option value="${value}"${current === value ? " selected" : ""}>${label}</option>`).join("");
}

function renderDetail() {
  const application = getApplication(state.selectedId);
  if (!application) {
    detail.innerHTML = `<p class="notice error">Application not found or you do not have access. Return to the application list and try again.</p>`;
    return;
  }
  const client = getClient(application.client_id);
  if (!client) {
    detail.innerHTML = `<p class="notice error">The client record could not be found. Return to the application list and try again.</p>`;
    return;
  }
  const documents = getDocuments(application.id);
  const required = documents.filter((document) => document.required && document.applicable);
  const canProceed = documents.length > 0 && required.every((document) => document.status === "verified");
  const percent = progressValue(application);
  const draft = {};
  const previousForm = $("[data-workflow]", detail);
  const previousNoteForm = $("[data-note-form]", detail);
  const noteDraft = previousNoteForm && detail.dataset.applicationId === application.id
    ? Object.fromEntries(new FormData(previousNoteForm)) : {};
  if (previousForm && detail.dataset.applicationId === application.id) {
    for (const [key, value] of new FormData(previousForm)) draft[key] = value;
  }
  detail.dataset.applicationId = application.id;
  detail.innerHTML = `
    <div class="detail-header"><div><p class="eyebrow">Client application · ${escapeHtml(application.reference)}</p><h1 id="detail-title">${escapeHtml(client.full_name)}</h1><p class="muted">${escapeHtml(application.destination)} · ${escapeHtml(application.visa_category)}</p></div><span class="badge application-status">${escapeHtml(applicationStatus(application))}</span></div>
    <p class="notice" data-detail-message role="status" aria-live="polite" hidden></p>
    <div class="facts application-facts">
      <div><small class="muted">Client email</small><p>${escapeHtml(client.email)}</p></div>
      <div><small class="muted">Phone number</small><p>${escapeHtml(client.phone)}</p></div>
      <div><small class="muted">Client portal</small><p><span class="badge ${client.portal_enabled ? "good" : "warn"}">${client.portal_enabled ? "Access enabled" : "Access disabled"}</span></p></div>
    </div>
    <div class="detail-progress"><p><span>Overall progress</span><strong>${percent}%</strong></p><div class="progress" role="progressbar" aria-label="Overall application progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div></div>
    <div class="section-heading checklist-heading"><div><p class="eyebrow">Step 1</p><h3>Document checklist</h3><p class="muted">Choose a status for each item. Only required, applicable documents block the next step.</p></div><div class="checklist-counts" role="group" aria-label="Checklist progress"><span class="badge">${documents.filter((doc) => doc.applicable && ["received", "verified"].includes(doc.status)).length}/${documents.filter((doc) => doc.applicable).length} submitted</span><span class="badge">${required.filter((doc) => doc.status === "verified").length}/${required.length} required verified</span></div></div>
    <aside class="checklist-guidance"><p class="small muted">A passport valid for the whole stay and the details for the online application are needed. Other evidence depends on the visit and the applicant's circumstances; mark applicable items required for this case. Non-English or Welsh documents need a certified translation. The JIT form is our own requirement, not a UKVI document. <a href="https://www.gov.uk/standard-visitor/apply-standard-visitor-visa" target="_blank" rel="noopener noreferrer">UK application requirements</a> · <a href="https://www.gov.uk/government/publications/visitor-visa-guide-to-supporting-documents/guide-to-supporting-documents-visiting-the-uk" target="_blank" rel="noopener noreferrer">UKVI supporting documents</a></p></aside>
    <div class="doc-list">${documents.length ? documents.map((document) => `
      <div class="doc-row">
        <div class="doc-info"><strong>${escapeHtml(document.label)}</strong><small class="muted">${document.required && document.applicable ? "Required" : document.applicable ? "As applicable" : "Not applicable"}${document.status === "needs_correction" ? " · Needs correction" : ""}</small>
          <details class="doc-settings"><summary>Change requirement</summary><select data-doc-rule="${escapeHtml(document.id)}" data-old="${!document.applicable ? "not_applicable" : document.required ? "required" : "optional"}" aria-label="Requirement for ${escapeHtml(document.label)}">
            <option value="required"${document.required && document.applicable ? " selected" : ""}>Required</option><option value="optional"${!document.required && document.applicable ? " selected" : ""}>As applicable</option><option value="not_applicable"${!document.applicable ? " selected" : ""}>Not applicable</option>
          </select></details>
        </div>
        <select class="doc-status ${document.status === "verified" ? "is-verified" : ""}" data-doc-status="${escapeHtml(document.id)}" data-old="${escapeHtml(document.status)}" aria-label="Status for ${escapeHtml(document.label)}">
          ${statusOptions(document.status)}
        </select>
      </div>`).join("") : `<p class="notice">No checklist is configured for this application type.</p>`}</div>
    <form class="add-document" data-add-document><label>Additional document<input name="label" maxlength="180" placeholder="Enter a document name" required></label><label>Requirement<select name="required"><option value="false">As applicable</option><option value="true">Required</option></select></label><button class="button outline" type="submit">Add document</button></form>
    <div class="detail-actions">
      <button class="button gold" data-proceed${!canProceed || application.application_started ? " disabled" : ""}>${application.application_started ? "Application stage unlocked" : "Proceed to visa application"}</button>
      <button class="button outline" data-client-link>${client.portal_enabled ? "Email / resend client access link" : "Enable access and email link"}</button>
      ${client.portal_enabled ? `<button class="button outline" data-revoke-link>Revoke client access</button>` : ""}
    </div>
    ${application.application_started ? `<section class="workflow-panel"><div class="section-heading" id="application-progress"><div><p class="eyebrow">Step 2</p><h3>Application progress</h3><p class="muted">Update the stages below and save your changes.</p></div></div>
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
    </form></section>` : ""}
    <section class="staff-notes" aria-labelledby="staff-notes-title"><h3 id="staff-notes-title">Private staff notes</h3>
    <form class="note-form" data-note-form>
      <select name="document_id" aria-label="Attach note to a document"><option value="">General application note</option>${documents.map((document) => `<option value="${escapeHtml(document.id)}">${escapeHtml(document.label)}</option>`).join("")}</select>
      <input name="note" maxlength="3000" placeholder="Private staff note" required><button class="button outline">Add note</button>
    </form>
    <div data-notes></div></section>`;

  for (const [key, value] of Object.entries(draft)) {
    const field = $("[data-workflow]", detail).elements.namedItem(key);
    if (field) field.value = value;
  }
  for (const [key, value] of Object.entries(noteDraft)) {
    const field = $("[data-note-form]", detail).elements.namedItem(key);
    if (field) field.value = value;
  }
  detail.querySelectorAll("[data-doc-status]").forEach((control) => {
    control.addEventListener("change", async () => {
      try {
        const { error } = await supabase.from("application_documents")
          .update({ status: control.value, updated_by: state.profile.id }).eq("id", control.dataset.docStatus);
        if (error) throw error;
        await loadData();
        toast("Document status saved.");
      } catch (error) {
        control.value = control.dataset.old === "needs_correction" ? "" : control.dataset.old;
        toast(error.message, true);
      }
    });
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
  $("[data-add-document]", detail).addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const label = String(values.get("label")).trim();
      if (!label) {
        toast("Enter a document name.", true);
        return;
      }
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        const { error } = await supabase.from("application_documents").insert({
          client_id: client.id,
          application_id: application.id,
          label,
          required: values.get("required") === "true",
          sort_order: Math.min(32767, Math.max(0, ...documents.map((item) => item.sort_order)) + 1),
          updated_by: state.profile.id,
        });
        if (error) throw error;
        await loadData();
        toast("Additional document added.");
      } catch (error) { toast(error.message, true); }
      finally { button.disabled = false; }
  });
  $("[data-proceed]", detail).addEventListener("click", async () => {
    try {
      const { error } = await supabase.from("applications")
        .update({ application_started: true, current_stage: "Application in progress" }).eq("id", application.id);
      if (error) throw error;
      await loadData();
      toast("Visa application stage unlocked.");
      $("[id=application-progress]", detail)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  $("[data-workflow]", detail)?.addEventListener("submit", async (event) => {
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
  void renderNotes(application.id).catch((error) => {
    const notes = $("[data-notes]", detail);
    if (notes && state.selectedId === application.id) notes.textContent = error.message;
  });
}

async function renderNotes(applicationId) {
  const { data, error } = await supabase.from("internal_notes")
    .select("note,document_id,created_at,profiles(full_name,email)").eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (state.selectedId !== applicationId || !$("[data-notes]", detail)) return;
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

$("[data-search]")?.addEventListener("input", renderList);
$("[data-refresh]")?.addEventListener("click", () => { void loadData().catch((error) => toast(error.message, true)); });
$("[data-add]")?.addEventListener("click", () => {
  $("[data-client-form]").elements.registered_at.value = new Date().toISOString().slice(0, 10);
  dialog.showModal();
});
$("[data-close]")?.addEventListener("click", () => dialog.close());
$("[data-sign-out]").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.replace("/visa-tracker/login/");
});
$("[data-client-form]")?.addEventListener("submit", async (event) => {
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
    (list || detail).textContent = "Supabase is not configured. No records are displayed.";
    document.querySelectorAll("main button, main input").forEach((item) => { item.disabled = true; });
    $("[data-sign-out]").disabled = true;
    return;
  }
  try {
    state.profile = await requireStaff();
    if (!state.profile) return;
    if (!isDetailPage) {
      $("[data-staff-name]").textContent = state.profile.full_name || state.profile.email;
      if (state.profile.role !== "admin") $('[data-tab="staff"]').hidden = true;
    }
    await loadData();
  } catch (error) {
    setup.textContent = `The portal could not load: ${error.message}`;
    setup.hidden = false;
    (list || detail).textContent = "Application data is unavailable.";
  }
}

void initialize();
window.setInterval(() => {
  if (supabaseReady && !document.hidden && !isDetailPage && state.profile) {
    void loadData().catch((error) => toast(`Automatic refresh failed: ${error.message}`, true));
  }
}, 60_000);
