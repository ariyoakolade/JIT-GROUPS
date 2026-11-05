# JIT Travels Visa Tracker setup

The public website is static, so the tracker runs as a Google Apps Script web app. The app uses the existing spreadsheet ID `1ajYcC7D9lZkkK_emXn0BrbzqQ3r2-zxV1ZSJ0AUfjys`. The setup function only checks the existing `Clients`, `Documents`, and `ActivityLog` tabs; it does not create, rename, clear, or delete spreadsheets or tabs.

Client, checklist, and workflow data are stored in the `Clients` tab. Passport scans and other documents are not uploaded or stored. The `Documents` and `ActivityLog` tabs are preserved and are not currently read or written by this version.

## Copy the files into Apps Script

1. Sign in to the Google account that owns or can edit the existing spreadsheet.
2. Open that spreadsheet and choose **Extensions → Apps Script** to open its existing bound Apps Script project. If it has no script project yet, this creates one bound to the existing spreadsheet.
3. Replace the project's `Code.gs` with [`apps-script/Code.gs`](./apps-script/Code.gs).
4. In the same Apps Script project, create an HTML file named exactly `VisaTracker` and paste in [`apps-script/VisaTracker.html`](./apps-script/VisaTracker.html).
5. Save the project. Select `setupTracker_` and click **Run** once. Review and grant the requested spreadsheet permission.
6. Confirm the execution log reports the existing spreadsheet URL and that setup completes without a heading error. The `Clients` header row must exactly match:

   `Client ID, Reference, Full Name, Email, Phone Number, Destination, Visa Category, Date Registered, Documents JSON, Workflow JSON, Created At, Updated At`

Setup checks the required tabs and the `Clients` headings only. It does not modify sheet contents.

## Restrict access to staff and deploy

The backend checks `Session.getActiveUser().getEmail()` on every data read and write and fails closed if Google does not provide an email. It compares the signed-in address against a server-side allowlist. **Do not deploy this version as "Execute as me":** in that mode, Google may return a blank active-user email, so this backend deliberately denies the request.

1. In Apps Script **Project Settings → Script Properties**, add `JIT_VISA_TRACKER_ALLOWED_EMAILS` with this value (comma or newline separated):

   `Jeglobalconsult@gmail.com, Nifemigold599@gmail.com, Lollahaluko@gmail.com`

   If the property is absent, the backend uses these three addresses as defaults. If you set the property, it replaces the defaults; keep all authorized addresses in the value.
2. Share the existing spreadsheet with those same accounts as **Editors**. Do not enable public/link sharing. With "Execute as user accessing the web app", each staff member needs their own Google account's sheet access to read and update records.
3. In Apps Script, choose **Deploy → Manage deployments**, edit the existing web-app deployment, and select a **new version** containing the updated code. Set **Execute as** to **User accessing the web app**. Set **Who has access** to **Anyone with Google account** (or a narrower Workspace option only if all staff use accounts in that Workspace).
4. Deploy the updated version. The `/exec` URL normally stays the same when you edit an existing deployment. If Apps Script gives you a different URL, update `TRACKER_APP_URL` in [`visa-tracker.html`](./visa-tracker.html) and publish the site.
5. Test as each authorized account. Also test using a different Google account: the page may load, but tracker data calls must return **Access denied**. If Google cannot provide an email, data calls must also fail closed.

To authorize another team member later, add their Google account to `JIT_VISA_TRACKER_ALLOWED_EMAILS` **and** share the spreadsheet with them as an Editor. Script Property changes take effect without deploying a new version. Remove a departing team member from both the property and the spreadsheet sharing list.

The website's static entry page is not the security boundary. The server-side allowlist and the spreadsheet's per-user sharing permissions are enforced independently. Authorized editors can also open and edit the spreadsheet directly, so only share it with trusted staff. Do not share the script project as an editor with tracker users.

After changing Apps Script source code, you must deploy a new version to the existing deployment (or create a new deployment). Changing Script Properties or spreadsheet sharing does not require redeployment.

## Using the tracker

- Add clients from the tracker home page and search by name.
- The initial checklist is configured for **UK Standard Visitor Visa** only. Other categories are recorded, but cannot proceed until a matching checklist is configured.
- Requirements marked optional or not applicable do not block progression. A required item must be both received and verified.
- Payment confirmation requires a date and a positive amount; a booked appointment requires its date, time and VFS centre.
- The final status is locked until all four application sections are complete.
- The app refreshes the client list periodically; use **Refresh** to get the latest updates immediately.
- Document and workflow JSON cells for existing clients are read as-is. Blank JSON cells use the default UK checklist and workflow; the defaults are saved the next time a staff member updates that client.
