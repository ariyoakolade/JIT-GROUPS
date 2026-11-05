const TRACKER_SHEET_NAME = 'Clients';
const TRACKER_SPREADSHEET_ID = '1ajYcC7D9lZkkK_emXn0BrbzqQ3r2-zxV1ZSJ0AUfjys';
const TRACKER_REQUIRED_TABS = ['Clients', 'Documents', 'ActivityLog'];
const TRACKER_ALLOWED_EMAILS_PROPERTY = 'JIT_VISA_TRACKER_ALLOWED_EMAILS';
const TRACKER_DEFAULT_ALLOWED_EMAILS = [
  'jeglobalconsult@gmail.com',
  'nifemigold599@gmail.com',
  'lollahaluko@gmail.com'
];
const TRACKER_HEADERS = [
  'Client ID',
  'Reference',
  'Full Name',
  'Email',
  'Phone Number',
  'Destination',
  'Visa Category',
  'Date Registered',
  'Documents JSON',
  'Workflow JSON',
  'Created At',
  'Updated At'
];

const UK_VISITOR_DOCUMENTS = [
  { id: 'passport', name: 'International passport biodata page', required: true },
  { id: 'photo', name: 'Passport photograph', required: true },
  { id: 'client_form', name: 'Completed client information form', required: true },
  { id: 'bank_statement', name: 'Personal bank statement', required: true },
  { id: 'employment_evidence', name: 'Employment or business evidence', required: true },
  { id: 'employment_letter', name: 'Introduction or employment letter (where applicable)', required: false },
  { id: 'income_evidence', name: 'Evidence of income', required: true },
  { id: 'itinerary', name: 'Travel itinerary', required: true },
  { id: 'hotel', name: 'Hotel reservation', required: true },
  { id: 'invitation', name: 'Invitation letter (where applicable)', required: false },
  { id: 'home_ties', name: 'Evidence of ties to home country', required: true },
  { id: 'travel_history', name: 'Previous travel history (where applicable)', required: false },
  { id: 'other', name: 'Other supporting documents', required: false }
];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('VisaTracker')
    .setTitle('JIT Travels | Visa Application Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupTracker_() {
  const spreadsheet = SpreadsheetApp.openById(TRACKER_SPREADSHEET_ID);
  const missingTabs = TRACKER_REQUIRED_TABS.filter(function (name) {
    return !spreadsheet.getSheetByName(name);
  });
  if (missingTabs.length) {
    throw new Error('The existing spreadsheet is missing these expected tabs: ' + missingTabs.join(', ') + '. No tabs were created or changed.');
  }
  const sheet = spreadsheet.getSheetByName(TRACKER_SHEET_NAME);
  validateClientHeaders_(sheet);
  Logger.log('Tracker spreadsheet: ' + spreadsheet.getUrl());
  return spreadsheet.getUrl();
}

function getClients() {
  return withTrackerSheet_(function (sheet) {
    return getClientRows_(sheet).map(summarizeClient_);
  });
}

function addClient(input) {
  return withTrackerSheet_(function (sheet) {
    const client = validateNewClient_(input);
    const now = new Date();
    const year = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy');
    const nextNumber = getNextReferenceNumber_(sheet, year);
    const record = {
      id: Utilities.getUuid(),
      reference: 'JIT-VISA-' + year + '-' + String(nextNumber).padStart(4, '0'),
      fullName: client.fullName,
      phone: client.phone,
      email: client.email,
      destination: client.destination,
      category: client.category,
      registeredDate: client.registeredDate,
      documents: createChecklist_(client.destination, client.category),
      workflow: createWorkflow_(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    sheet.appendRow(toRow_(record));
    return summarizeClient_(record);
  }, true);
}

function updateDocument(clientId, patch) {
  return withTrackerSheet_(function (sheet) {
    const located = findClientRow_(sheet, clientId);
    const documents = located.client.documents;
    const document = documents.find(function (item) {
      return item.id === patch.documentId;
    });

    if (!document) {
      throw new Error('That document requirement was not found.');
    }

    if (patch.applicability !== undefined) {
      if (['required', 'optional', 'not_applicable'].indexOf(patch.applicability) === -1) {
        throw new Error('Choose a valid document requirement setting.');
      }
      document.applicability = patch.applicability;
      if (patch.applicability === 'not_applicable') {
        document.received = false;
        document.verified = false;
      }
    }

    if (patch.received !== undefined) {
      document.received = patch.received === true;
      if (!document.received) document.verified = false;
    }

    if (patch.verified !== undefined) {
      if (patch.verified === true && document.received !== true) {
        throw new Error('A document must be marked received before it can be verified.');
      }
      document.verified = patch.verified === true;
    }

    if (patch.comment !== undefined) {
      document.comment = validateText_(patch.comment, 'Document comment', 300);
    }

    located.client.documents = documents;
    located.client.updatedAt = new Date().toISOString();
    writeClient_(sheet, located.row, located.client);
    return summarizeClient_(located.client);
  }, true);
}

function proceedToApplication(clientId) {
  return withTrackerSheet_(function (sheet) {
    const located = findClientRow_(sheet, clientId);
    if (!allRequiredDocumentsComplete_(located.client.documents)) {
      throw new Error('Receive and verify every required document before proceeding.');
    }

    located.client.workflow.applicationStarted = true;
    located.client.updatedAt = new Date().toISOString();
    writeClient_(sheet, located.row, located.client);
    return summarizeClient_(located.client);
  }, true);
}

function saveSection(clientId, sectionName, input) {
  return withTrackerSheet_(function (sheet) {
    const located = findClientRow_(sheet, clientId);
    if (!located.client.workflow.applicationStarted) {
      throw new Error('Complete the document checklist and proceed to the visa application first.');
    }

    const allowed = ['ukvi', 'payment', 'appointment', 'upload'];
    if (allowed.indexOf(sectionName) === -1) {
      throw new Error('That application section is not supported.');
    }

    const section = validateSection_(sectionName, input);
    located.client.workflow[sectionName] = section;
    located.client.updatedAt = new Date().toISOString();
    writeClient_(sheet, located.row, located.client);
    return summarizeClient_(located.client);
  }, true);
}

function saveFinalStatus(clientId, input) {
  return withTrackerSheet_(function (sheet) {
    const located = findClientRow_(sheet, clientId);
    if (!located.client.workflow.applicationStarted || !allApplicationSectionsComplete_(located.client.workflow)) {
      throw new Error('Complete all four visa application sections before updating the final status.');
    }

    const validStatuses = [
      'Awaiting Biometrics',
      'Biometrics Completed',
      'Awaiting Visa Decision',
      'Visa Approved',
      'Visa Refused'
    ];
    if (!input || validStatuses.indexOf(input.status) === -1) {
      throw new Error('Choose a valid final application status.');
    }

    located.client.workflow.final = {
      status: input.status,
      comments: validateText_(input.comments, 'Final status comment', 1000)
    };
    located.client.updatedAt = new Date().toISOString();
    writeClient_(sheet, located.row, located.client);
    return summarizeClient_(located.client);
  }, true);
}

function withTrackerSheet_(callback, needsLock) {
  const lock = needsLock ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(20000);
  try {
    requireAuthorizedUser_();
    const spreadsheet = SpreadsheetApp.openById(TRACKER_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(TRACKER_SHEET_NAME);
    if (!sheet) {
      throw new Error('The Clients sheet is missing from the configured spreadsheet. No replacement sheet was created.');
    }
    validateClientHeaders_(sheet);
    return callback(sheet);
  } finally {
    if (lock) lock.releaseLock();
  }
}

function requireAuthorizedUser_() {
  const email = Session.getActiveUser().getEmail().trim().toLowerCase();
  if (!email) {
    throw new Error('Google did not provide your signed-in email. Deploy the web app as "User accessing the web app", then sign in again.');
  }

  const configured = PropertiesService.getScriptProperties()
    .getProperty(TRACKER_ALLOWED_EMAILS_PROPERTY);
  const allowedEmails = configured === null
    ? TRACKER_DEFAULT_ALLOWED_EMAILS
    : configured.split(/[,\s;]+/).filter(function (value) { return value; })
      .map(function (value) { return value.trim().toLowerCase(); });

  if (allowedEmails.indexOf(email) === -1) {
    throw new Error('Access denied for ' + email + '. Ask the tracker owner to authorize your Google account.');
  }
}

function validateClientHeaders_(sheet) {
  const actual = sheet.getRange(1, 1, 1, TRACKER_HEADERS.length).getDisplayValues()[0];
  const mismatches = TRACKER_HEADERS.map(function (expected, index) {
    return actual[index] === expected ? '' : 'Column ' + (index + 1) + ' must be "' + expected + '"';
  }).filter(function (message) { return message; });
  if (mismatches.length) {
    throw new Error('The Clients headings do not match the tracker. ' + mismatches.join('; ') + '. No spreadsheet data was changed.');
  }
}

function getClientRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, TRACKER_HEADERS.length).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) {
      return fromRow_(row);
    });
}

function findClientRow_(sheet, clientId) {
  if (typeof clientId !== 'string' || !clientId) throw new Error('A client ID is required.');
  const clients = getClientRows_(sheet);
  const index = clients.findIndex(function (client) { return client.id === clientId; });
  if (index === -1) throw new Error('That client could not be found. Refresh the page and try again.');
  return { row: index + 2, client: clients[index] };
}

function fromRow_(row) {
  const destination = String(row[5]);
  const category = String(row[6]);
  const storedDocuments = parseJson_(row[8], null);
  if (storedDocuments !== null && !Array.isArray(storedDocuments)) {
    throw new Error('Stored document checklist is invalid. Check the Documents JSON cell in the Clients sheet.');
  }
  const documents = storedDocuments && storedDocuments.length
    ? storedDocuments
    : createChecklist_(destination, category);

  return {
    id: String(row[0]),
    reference: String(row[1]),
    fullName: String(row[2]),
    email: String(row[3]),
    phone: String(row[4]),
    destination: destination,
    category: category,
    registeredDate: formatDateCell_(row[7]),
    documents: documents,
    workflow: normalizeWorkflow_(parseJson_(row[9], null)),
    createdAt: String(row[10]),
    updatedAt: String(row[11])
  };
}

function toRow_(client) {
  return [
    client.id,
    client.reference,
    sheetText_(client.fullName),
    sheetText_(client.email),
    sheetText_(client.phone),
    sheetText_(client.destination),
    sheetText_(client.category),
    client.registeredDate,
    JSON.stringify(client.documents),
    JSON.stringify(client.workflow),
    client.createdAt,
    client.updatedAt
  ];
}

function sheetText_(value) {
  const text = String(value == null ? '' : value);
  return text.charAt(0) === '=' ? "'" + text : text;
}

function writeClient_(sheet, row, client) {
  sheet.getRange(row, 1, 1, TRACKER_HEADERS.length).setValues([toRow_(client)]);
}

function parseJson_(value, fallback) {
  if (!value) return fallback;
  const parsed = JSON.parse(String(value));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Stored tracker data is invalid. Ask the owner to check the Clients sheet.');
  }
  return parsed;
}

function normalizeWorkflow_(stored) {
  const defaults = createWorkflow_();
  if (stored === null) return defaults;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('Stored application workflow is invalid. Check the Workflow JSON cell in the Clients sheet.');
  }
  return {
    applicationStarted: stored.applicationStarted === true,
    ukvi: Object.assign({}, defaults.ukvi, stored.ukvi || {}),
    payment: Object.assign({}, defaults.payment, stored.payment || {}),
    appointment: Object.assign({}, defaults.appointment, stored.appointment || {}),
    upload: Object.assign({}, defaults.upload, stored.upload || {}),
    final: Object.assign({}, defaults.final, stored.final || {})
  };
}

function formatDateCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value == null ? '' : value);
}

function validateNewClient_(input) {
  if (!input || typeof input !== 'object') throw new Error('Enter the client information.');
  const client = {
    fullName: validateText_(input.fullName, 'Full name', 120),
    phone: validateText_(input.phone, 'Phone number', 40),
    email: validateText_(input.email, 'Email address', 160),
    destination: validateText_(input.destination, 'Destination country', 80),
    category: validateText_(input.category, 'Visa category', 100),
    registeredDate: validateDate_(input.registeredDate)
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) {
    throw new Error('Enter a valid email address.');
  }
  return client;
}

function validateText_(value, label, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > maxLength) throw new Error(label + ' must be ' + maxLength + ' characters or fewer.');
  return text;
}

function validateDate_(value) {
  const date = String(value || '');
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Enter a valid registration date.');
  }
  return date;
}

function createChecklist_(destination, category) {
  if (!['uk', 'united kingdom'].includes(destination.trim().toLowerCase()) ||
      category.trim().toLowerCase() !== 'uk standard visitor visa') {
    return [];
  }
  return UK_VISITOR_DOCUMENTS.map(function (item) {
    return {
      id: item.id,
      name: item.name,
      applicability: item.required ? 'required' : 'optional',
      received: false,
      verified: false,
      comment: ''
    };
  });
}

function createWorkflow_() {
  return {
    applicationStarted: false,
    ukvi: { status: 'Not Started', comments: '' },
    payment: { status: 'Awaiting Payment', date: '', amount: '', comments: '' },
    appointment: { status: 'Not Started', date: '', time: '', centre: '', comments: '' },
    upload: { status: 'Not Started', comments: '' },
    final: { status: 'Awaiting Biometrics', comments: '' }
  };
}

function validateSection_(name, input) {
  if (!input || typeof input !== 'object') throw new Error('Enter the section details.');

  if (name === 'ukvi') {
    if (['Not Started', 'In Progress', 'Completed'].indexOf(input.status) === -1) {
      throw new Error('Choose a valid UKVI form status.');
    }
    return { status: input.status, comments: validateText_(input.comments, 'UKVI comment', 1000) };
  }

  if (name === 'payment') {
    if (['Awaiting Payment', 'Payment Made', 'Payment Confirmation Received'].indexOf(input.status) === -1) {
      throw new Error('Choose a valid payment status.');
    }
    const date = input.date ? validateDate_(input.date) : '';
    const amountText = String(input.amount == null ? '' : input.amount).trim();
    const amount = amountText === '' ? '' : Number(amountText);
    if (amount !== '' && (!isFinite(amount) || amount < 0)) throw new Error('Enter a valid payment amount.');
    if (input.status === 'Payment Confirmation Received' && (!date || !(amount > 0))) {
      throw new Error('Record a payment date and amount before confirming payment.');
    }
    return {
      status: input.status,
      date: date,
      amount: amount,
      comments: validateText_(input.comments, 'Payment comment', 1000)
    };
  }

  if (name === 'appointment') {
    if (['Not Started', 'In Progress', 'Appointment Booked'].indexOf(input.status) === -1) {
      throw new Error('Choose a valid appointment status.');
    }
    const date = input.date ? validateDate_(input.date) : '';
    const time = validateText_(input.time, 'Appointment time', 30);
    const centre = validateText_(input.centre, 'VFS centre', 120);
    if (input.status === 'Appointment Booked' && (!date || !time || !centre)) {
      throw new Error('Enter the appointment date, time and VFS centre before booking.');
    }
    return {
      status: input.status,
      date: date,
      time: time,
      centre: centre,
      comments: validateText_(input.comments, 'Appointment comment', 1000)
    };
  }

  if (['Not Started', 'In Progress', 'Completed'].indexOf(input.status) === -1) {
    throw new Error('Choose a valid document upload status.');
  }
  return { status: input.status, comments: validateText_(input.comments, 'Upload comment', 1000) };
}

function allRequiredDocumentsComplete_(documents) {
  const required = documents.filter(function (document) {
    return document.applicability === 'required';
  });
  return documents.length > 0 && required.every(function (document) {
    return document.received === true && document.verified === true;
  });
}

function allApplicationSectionsComplete_(workflow) {
  return workflow.ukvi.status === 'Completed' &&
    workflow.payment.status === 'Payment Confirmation Received' &&
    workflow.appointment.status === 'Appointment Booked' &&
    workflow.upload.status === 'Completed';
}

function summarizeClient_(client) {
  const documents = client.documents || [];
  const required = documents.filter(function (document) {
    return document.applicability === 'required';
  });
  const received = documents.filter(function (document) { return document.received; }).length;
  const verified = documents.filter(function (document) { return document.verified; }).length;
  const documentProgress = required.length
    ? required.reduce(function (total, document) {
      return total + (document.received ? 0.5 : 0) + (document.verified ? 0.5 : 0);
    }, 0) / required.length
    : documents.length ? 1 : 0;
  const workflow = client.workflow || createWorkflow_();
  const sections = ['ukvi', 'payment', 'appointment', 'upload'];
  const sectionProgress = sections.reduce(function (total, section) {
    return total + (isSectionComplete_(section, workflow[section]) ? 1 : 0);
  }, 0) / sections.length;
  const finalProgress = {
    'Awaiting Biometrics': 0,
    'Biometrics Completed': 0.33,
    'Awaiting Visa Decision': 0.66,
    'Visa Approved': 1,
    'Visa Refused': 1
  }[workflow.final.status] || 0;
  const progress = Math.round(documentProgress * 40 + sectionProgress * 40 + finalProgress * 20);
  const documentsComplete = allRequiredDocumentsComplete_(documents);
  const allSectionsComplete = allApplicationSectionsComplete_(workflow);
  let status = documents.length ? 'Documents Pending' : 'Checklist not configured';
  let stage = 'Document Collection';

  if (documents.length && documentsComplete && !workflow.applicationStarted) {
    status = 'Ready for Application';
    stage = 'Document Collection';
  } else if (workflow.applicationStarted && !allSectionsComplete) {
    stage = nextIncompleteSection_(workflow);
    if (!isSectionComplete_('ukvi', workflow.ukvi)) status = 'Application in Progress';
    else if (!isSectionComplete_('payment', workflow.payment)) status = 'Payment Pending';
    else if (!isSectionComplete_('appointment', workflow.appointment)) status = 'Awaiting Appointment';
    else status = 'Document Upload in Progress';
  } else if (allSectionsComplete) {
    status = workflow.final.status;
    stage = workflow.final.status === 'Visa Approved' || workflow.final.status === 'Visa Refused'
      ? 'Visa Decision'
      : 'Biometrics and Visa Decision';
  } else if (documents.length && required.length && required.every(function (document) { return document.received; })) {
    status = 'Documents Under Review';
  }

  return {
    id: client.id,
    reference: client.reference,
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
    destination: client.destination,
    category: client.category,
    registeredDate: client.registeredDate,
    updatedAt: client.updatedAt,
    documents: documents,
    workflow: workflow,
    receivedCount: received,
    verifiedCount: verified,
    documentCount: documents.length,
    requiredCount: required.length,
    documentsComplete: documentsComplete,
    applicationStarted: workflow.applicationStarted === true,
    allSectionsComplete: allSectionsComplete,
    progress: progress,
    status: status,
    stage: stage
  };
}

function isSectionComplete_(name, section) {
  if (!section) return false;
  if (name === 'ukvi') return section.status === 'Completed';
  if (name === 'payment') {
    return section.status === 'Payment Confirmation Received' && Boolean(section.date) && Number(section.amount) > 0;
  }
  if (name === 'appointment') {
    return section.status === 'Appointment Booked' && Boolean(section.date) && Boolean(section.time) && Boolean(section.centre);
  }
  return section.status === 'Completed';
}

function nextIncompleteSection_(workflow) {
  if (!isSectionComplete_('ukvi', workflow.ukvi)) return 'UKVI Application Form';
  if (!isSectionComplete_('payment', workflow.payment)) return 'Visa Payment';
  if (!isSectionComplete_('appointment', workflow.appointment)) return 'VFS Appointment Booking';
  if (!isSectionComplete_('upload', workflow.upload)) return 'Document Upload';
  return 'Biometrics and Visa Decision';
}

function getNextReferenceNumber_(sheet, year) {
  const prefix = 'JIT-VISA-' + year + '-';
  const references = getClientRows_(sheet).map(function (client) { return client.reference; });
  const numbers = references.filter(function (reference) {
    return reference.indexOf(prefix) === 0;
  }).map(function (reference) {
    return Number(reference.slice(prefix.length));
  }).filter(function (number) { return isFinite(number); });
  return numbers.length ? Math.max.apply(null, numbers) + 1 : 1;
}
