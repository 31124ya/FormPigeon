// ══════════════════════════════════════════════════════════════════════
//  🕊️  FormPigeon — Google Forms → Discord notifications
//  Built on Discord's Components V2 message system (flag 1 << 15).
// ──────────────────────────────────────────────────────────────────────
//  QUICK START (full guide in README.md):
//    1. Open your Google Form  →  Extensions  →  Apps Script
//    2. Replace the editor contents with this file, then fill in
//       CONFIG.WEBHOOK_URLS below.
//    3. Save, then run `menuSendTestMessage` once from the editor to
//       authorize the script and send a preview card to Discord.
//    4. Reload the form editor tab, open the new  🕊️ Discord  menu and
//       choose "Install notification trigger". Done!
// ══════════════════════════════════════════════════════════════════════

const CONFIG = {
  // ── Required ──────────────────────────────────────────────────────
  // One or more Discord webhook URLs (multiple webhooks all get a copy).
  // Create them in:  Server Settings → Integrations → Webhooks → New Webhook
  WEBHOOK_URLS: [
    'https://discord.com/api/webhooks/REPLACE_ME/REPLACE_ME',
  ],

  // ── Appearance ────────────────────────────────────────────────────
  BOT_NAME: '🕊️ FormPigeon',   // username shown in Discord ('' = webhook default)
  AVATAR_URL: '',               // avatar image URL ('' = webhook default)
  ACCENT_COLOR: 0x5865F2,       // card accent color (left stripe) — Discord blurple
  HEADER_ICON_URL: 'https://ssl.gstatic.com/images/branding/product/1x/forms_48dp.png',
                                // small icon next to the card header ('' = hide)

  // ── Mentions ──────────────────────────────────────────────────────
  // Prepend a ping to every notification. Examples:
  //   ''                     no ping
  //   '<@&123456789012>'     role ping   (enable Developer Mode in Discord,
  //                                      right-click the role → Copy Role ID)
  //   '<@123456789012>'      user ping
  //   '@here'  '@everyone'   room-wide ping
  MENTION: '',

  // ── Posting target (optional) ─────────────────────────────────────
  THREAD_ID: '',                // post into a thread / forum post instead of
                                // the channel root (copy the thread ID the
                                // same way you copy role IDs)

  // ── Behavior ──────────────────────────────────────────────────────
  MARK_EDITED: true,            // detect re-submitted (edited) responses and
                                // label them "edited" — uses a rolling memory
                                // of the last 120 response IDs
  SHOW_UNANSWERED: true,        // list questions the respondent left empty
  NUMBER_QUESTIONS: true,       // prefix answers with 1. 2. 3. …
  SHOW_RESPONDENT_EMAIL: true,  // show the respondent's email when the form
                                // collects it
  ESCAPE_MARKDOWN: true,        // neutralize markdown typed by respondents
                                // (**bold**, ||spoiler||, @everyone, <@id> …)
  SHOW_EDIT_LINK: true,         // footer link that opens the response in edit
                                // mode — anyone holding the link can edit the
                                // response, so only post it in private channels
  SHOW_FORM_LINK: true,         // footer link to the form's editor dashboard

  // ── File uploads ──────────────────────────────────────────────────
  RESOLVE_FILE_NAMES: true,     // look up real file names in Drive (asks for a
                                // read-only Drive permission on first auth)
  FILE_THUMBNAILS: false,       // show uploads as an image gallery. Only works
                                // if the uploaded files are shared publicly
                                // ("Anyone with the link") — otherwise Discord
                                // cannot fetch them and you get broken tiles.

  // ── Limits / pagination ───────────────────────────────────────────
  MAX_ANSWER_LENGTH: 800,       // answers longer than this are truncated
  MAX_TEXT_PER_MESSAGE: 3600,   // Discord allows 4000 characters of Text
                                // Display content per message — long forms are
                                // automatically split across several cards
  MAX_COMPONENTS: 34,           // Discord allows 40 components per message
                                // (nested ones count) — keep headroom

  // ── Failure handling ──────────────────────────────────────────────
  EMAIL_ON_ERROR: true,         // email the script owner when a Discord post
                                // fails (quota, deleted webhook, 429 twice…)
  TIMEZONE: '',                 // '' = the script's timezone (⚙️ Project
                                // Settings), or an IANA name like 'Europe/Berlin'
};

// ─── Discord Components V2 constants ──────────────────────────────────

const COMPONENT = {
  SECTION: 9,        // text block with an optional side accessory
  TEXT_DISPLAY: 10,  // markdown text
  THUMBNAIL: 11,     // small image used as a Section accessory
  MEDIA_GALLERY: 12, // grid of up to 10 images
  SEPARATOR: 14,     // divider line / padding
  CONTAINER: 17,     // rounded card with an accent stripe (embed replacement)
};

const FLAG_IS_COMPONENTS_V2 = 32768; // 1 << 15

const SEEN_IDS_KEY = 'formpigeon_seen_response_ids';
const SEEN_IDS_MAX = 120; // Script Properties value limit is ~9 KB

// Items that can never carry an answer (skipped when listing unanswered ones).
const NON_ANSWERABLE = new Set(['PAGE_BREAK', 'SECTION_HEADER', 'IMAGE', 'VIDEO']);

// Rough character/component budget reserved for header, footer and mention.
const RESERVED_TEXT_CHARS = 650;
const RESERVED_COMPONENTS = 8;

// ══════════════════════════════════════════════════════════════════════
//  Event handling
// ══════════════════════════════════════════════════════════════════════

/**
 * Apps Script entry point — fired by the "On form submit" trigger.
 * @param {Object} e The form-submission event object.
 */
function onFormSubmit(e) {
  try {
    if (!e || !e.response) {
      console.error('FormPigeon: trigger fired without a response payload. Did you install it through the Discord menu?', e);
      return;
    }
    const form = e.source || FormApp.getActiveForm();
    const edited = CONFIG.MARK_EDITED && isReSubmission_(e.response.getId());
    const data = collectSubmissionData_(form, e.response, edited);
    const payloads = buildPayloadParts(data);
    const sent = deliver_(payloads);
    console.log(`FormPigeon: delivered "${data.formTitle}" — ${sent} webhook post(s), edited=${edited}, parts=${payloads.length}`);
  } catch (err) {
    handleFailure_(err);
  }
}

/**
 * Records a response ID and reports whether it has been seen before
 * (i.e. the respondent edited and re-submitted their answer).
 */
function isReSubmission_(responseId) {
  if (!responseId) return false;
  try {
    const store = PropertiesService.getScriptProperties();
    const seen = JSON.parse(store.getProperty(SEEN_IDS_KEY) || '{}');
    const wasSeen = Object.prototype.hasOwnProperty.call(seen, responseId);
    seen[responseId] = new Date().toISOString();
    store.setProperty(SEEN_KEY_NAME(), JSON.stringify(pruneSeenIds_(seen)));
    return wasSeen;
  } catch (err) {
    console.warn('FormPigeon: could not persist response ID for edit tracking.', err);
    return false;
  }
}

/** Keeps only the most recent SEEN_IDS_MAX response IDs. */
function pruneSeenIds_(seen) {
  const entries = Object.entries(seen).sort((a, b) => (a[1] < b[1] ? 1 : -1));
  const kept = {};
  for (const [id, ts] of entries.slice(0, SEEN_IDS_MAX)) kept[id] = ts;
  return kept;
}

// Tiny indirection so tests can monkey-patch the property key if needed.
function SEEN_KEY_NAME() {
  return SEEN_IDS_KEY;
}

// ══════════════════════════════════════════════════════════════════════
//  Google Forms → plain data
// ══════════════════════════════════════════════════════════════════════

/**
 * Flattens the Apps Script event objects into plain data that the
 * (pure, testable) payload builder below can consume.
 */
function collectSubmissionData_(form, response, edited) {
  const answeredIds = {};
  const qa = [];
  const fileGroups = [];

  for (const itemResponse of response.getItemResponses()) {
    const item = itemResponse.getItem();
    answeredIds[item.getId()] = true;
    const type = String(item.getType());
    const title = String(item.getTitle() || 'Untitled question');

    if (type === 'FILE_UPLOAD') {
      const ids = normalizeFileIds_(itemResponse.getResponse());
      if (ids.length) fileGroups.push({ question: title, ids: ids });
      continue; // uploads get their own section, not a Q&A entry
    }

    qa.push({ question: title, answer: formatAnswer_(itemResponse.getResponse()) });
  }

  if (CONFIG.SHOW_UNANSWERED) {
    for (const item of form.getItems()) {
      const type = String(item.getType());
      if (NON_ANSWERABLE.has(type)) continue;
      if (answeredIds[item.getId()]) continue;
      qa.push({ question: String(item.getTitle()), answer: null });
    }
  }

  return {
    formTitle: String(form.getTitle() || 'Untitled form'),
    respondentEmail: safeGet_(response.getRespondentEmail, response),
    timestamp: response.getTimestamp() || new Date(),
    edited: !!edited,
    responseId: response.getId() || '',
    editUrl: safeGet_(response.getEditUrl, response),
    formEditUrl: safeGet_(form.getEditUrl, form),
    qa: qa,
    files: resolveFileNames_(fileGroups),
  };
}

/** Formats one answer; returns null when nothing was answered. */
function formatAnswer_(raw) {
  if (raw === null || raw === undefined) return null;

  let text;
  if (Array.isArray(raw)) {
    const parts = (raw.flat ? raw.flat(Infinity) : raw)
      .map(v => String(v).trim())
      .filter(Boolean);
    if (!parts.length) return null;
    text = parts.length === 1
      ? parts[0]
      : parts.map(p => `• ${p}`).join('\n');
  } else {
    text = String(raw).replace(/\r\n?/g, '\n').trim();
    if (!text) return null;
  }

  text = escapeUserText_(text);
  if (shouldNeutralizeEveryone_()) text = neutralizeEveryone_(text);
  return limitAnswer_(text);
}

/**
 * True when CONFIG.MENTION uses @everyone/@here — those pings are then
 * allowed_mentions-whitelisted, so respondent answers must be neutralized
 * so they can never ping the whole room.
 */
function shouldNeutralizeEveryone_() {
  return /@(everyone|here)\b/.test(CONFIG.MENTION || '');
}

/**
 * Escapes markdown specials in respondent-supplied text so nobody can
 * forge headings, spoilers or mentions through their answers.
 * Raw URLs are left untouched (Discord auto-links them).
 */
function escapeUserText_(text) {
  if (!CONFIG.ESCAPE_MARKDOWN) return text;
  return String(text)
    .split(/(https?:\/\/\S+)/g)
    .map((part, i) => (i % 2 === 1
      ? part
      : part.replace(/[\\`*_~<>|#\[\]()!]/g, '\\$&')))
    .join('');
}

/** Breaks the @everyone / @here token with a zero-width space. */
function neutralizeEveryone_(text) {
  return text.replace(/@(everyone|here)/g, m => '@\u200b' + m.slice(1));
}

/** Truncates answers beyond CONFIG.MAX_ANSWER_LENGTH. */
function limitAnswer_(text) {
  const max = CONFIG.MAX_ANSWER_LENGTH;
  if (!max || text.length <= max) return text;
  const extra = text.length - max;
  return truncate_(text, max) + `\n-# Answer truncated — ${extra} more characters`;
}

/** Normalizes FILE_UPLOAD responses (array of Drive file IDs or URLs). */
function normalizeFileIds_(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const ids = [];
  for (const entry of list) {
    const value = String(entry || '').trim();
    if (!value) continue;
    const match = value.match(/[?&]id=([\w-]+)/); // handles full URLs too
    ids.push(match ? match[1] : value);
  }
  return ids;
}

/** Resolves friendly file names through DriveApp (best effort). */
function resolveFileNames_(groups) {
  return groups.map(group => ({
    question: group.question,
    files: group.ids.map(id => {
      const file = {
        id: id,
        name: null,
        url: `https://drive.google.com/file/d/${id}/view`,
      };
      if (CONFIG.RESOLVE_FILE_NAMES) {
        try {
          file.name = DriveApp.getFileById(id).getName();
        } catch (err) {
          // Missing Drive permission or deleted file — generic label is fine.
        }
      }
      return file;
    }),
  }));
}

/** Calls a getter defensively and returns '' on failure. */
function safeGet_(fn, ctx) {
  try {
    return fn.call(ctx) || '';
  } catch (err) {
    return '';
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Components V2 payload builder  (pure — runs fine outside Apps Script)
// ══════════════════════════════════════════════════════════════════════

/**
 * Builds one or more complete webhook payloads from submission data.
 * A single Discord message is limited to 40 components (nested included)
 * and 4000 characters of Text Display content — long submissions are
 * split into several cards labeled "part 1 of N".
 * @param {Object} data Plain submission data as produced by
 *     collectSubmissionData_ — questions are escaped there, and answers
 *     are already formatted/escaped/truncated via formatAnswer_.
 * @return {Object[]} An array of webhook JSON payloads.
 */
function buildPayloadParts(data) {
  const blocks = [];

  // Q&A blocks
  let number = 0;
  for (const entry of data.qa) {
    number += 1;
    const label = CONFIG.NUMBER_QUESTIONS ? `${number}. ` : '';
    const question = truncate_(escapeUserText_(entry.question), 120);
    const answer = entry.answer === null ? '_No answer given._' : entry.answer;
    blocks.push(makeTextBlock_(`**${label}${question}**\n${answer}`));
  }

  // Attachment blocks
  if (data.files.length && CONFIG.FILE_THUMBNAILS) {
    for (const group of data.files) {
      const items = group.files.map(f => ({
        media: { url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800` },
        description: (f.name || 'Uploaded file').slice(0, 200),
      }));
      for (let i = 0; i < items.length; i += 10) { // 10 items max per gallery
        blocks.push(makeGalleryBlock_(items.slice(i, i + 10)));
      }
    }
  } else {
    for (const group of data.files) {
      const lines = group.files.map(f => {
        const label = truncate_(escapeUserText_(f.name || 'Uploaded file'), 80);
        return `• 📎 [${label}](${f.url})`;
      });
      const question = truncate_(escapeUserText_(group.question), 100);
      blocks.push(makeTextBlock_(`**📎 ${question}**\n${lines.join('\n')}`));
    }
  }

  const textBudget = Math.max(200, CONFIG.MAX_TEXT_PER_MESSAGE - RESERVED_TEXT_CHARS);
  const compBudget = Math.max(4, CONFIG.MAX_COMPONENTS - RESERVED_COMPONENTS);
  const groups = chunkBlocks_(blocks, textBudget, compBudget);
  const safeGroups = groups.length ? groups : [[]]; // always send at least the card

  return safeGroups.map((group, index) => assemblePart_(data, group, index, safeGroups.length));
}

/** Builds one webhook payload (one Discord message) out of a block group. */
function assemblePart_(data, group, index, total) {
  const children = [];

  if (index === 0) {
    children.push(headerSection_(data));
  } else {
    const continued = `## 🕊️ ${truncate_(escapeUserText_(data.formTitle), 80)} — continued\n-# Part ${index + 1} of ${total}`;
    children.push(textDisplay_(continued));
  }
  children.push(separator_(1));

  for (const block of group) {
    if (block.kind === 'text') children.push(textDisplay_(block.text));
    if (block.kind === 'gallery') children.push(gallery_(block.items));
  }

  if (index === total - 1) {
    children.push(separator_(2));
    children.push(textDisplay_(footerText_(data)));
  }

  const components = [{
    type: COMPONENT.CONTAINER,
    accent_color: CONFIG.ACCENT_COLOR == null ? undefined : Number(CONFIG.ACCENT_COLOR),
    components: children,
  }];

  // The mention sits outside the card so it renders like a normal ping.
  if (index === 0 && CONFIG.MENTION) {
    components.unshift(textDisplay_(CONFIG.MENTION));
  }

  const payload = {
    flags: FLAG_IS_COMPONENTS_V2,
    username: CONFIG.BOT_NAME || undefined,
    avatar_url: CONFIG.AVATAR_URL || undefined,
    allowed_mentions: buildAllowedMentions_(CONFIG.MENTION),
    components: components,
  };
  return payload;
}

/** Card header: "New response — <form title>" with a Forms icon. */
function headerSection_(data) {
  const title = truncate_(escapeUserText_(data.formTitle), 80);
  const heading = data.edited
    ? `## 📝 Edited response — ${title}`
    : `## 📬 New response — ${title}`;

  const bits = [];
  if (CONFIG.SHOW_RESPONDENT_EMAIL && data.respondentEmail) {
    bits.push(`Respondent: ${escapeUserText_(data.respondentEmail)}`);
  }
  bits.push(`Received: ${formatTimestamp_(data.timestamp)}`);

  const section = {
    type: COMPONENT.SECTION,
    components: [textDisplay_(`${heading}\n-# ${bits.join(' · ')}`)],
  };

  if (CONFIG.HEADER_ICON_URL) {
    section.accessory = {
      type: COMPONENT.THUMBNAIL,
      media: { url: CONFIG.HEADER_ICON_URL },
      description: 'Google Forms logo',
    };
  }
  return section;
}

/** Card footer: timestamps + links (edit response / form dashboard). */
function footerText_(data) {
  const links = [];
  if (CONFIG.SHOW_EDIT_LINK && data.editUrl) {
    links.push(`[Open response](${data.editUrl})`);
  }
  if (CONFIG.SHOW_FORM_LINK && data.formEditUrl) {
    links.push(`[Form dashboard](${data.formEditUrl})`);
  }
  let line = `-# Response ID ${data.responseId ? data.responseId : '—'} · Received ${formatTimestamp_(data.timestamp)}`;
  if (links.length) line += `\n${links.join(' · ')}`;
  return line;
}

// ─── Small component helpers ──────────────────────────────────────────

function textDisplay_(content) {
  return { type: COMPONENT.TEXT_DISPLAY, content: content };
}

/** spacing 1 = small, 2 = large */
function separator_(spacing) {
  return { type: COMPONENT.SEPARATOR, divider: true, spacing: spacing === 2 ? 2 : 1 };
}

function gallery_(items) {
  return { type: COMPONENT.MEDIA_GALLERY, items: items };
}

function makeTextBlock_(text) {
  return { kind: 'text', text: text, chars: text.length, comps: 1 };
}

function makeGalleryBlock_(items) {
  return { kind: 'gallery', items: items, chars: 0, comps: 1 + items.length };
}

/** Splits blocks so every message stays inside Discord's limits. */
function chunkBlocks_(blocks, textBudget, compBudget) {
  const groups = [];
  let current = [];
  let usedChars = 0;
  let usedComps = 0;

  for (const block of blocks) {
    if (
      current.length &&
      (usedChars + block.chars > textBudget || usedComps + block.comps > compBudget)
    ) {
      groups.push(current);
      current = [];
      usedChars = 0;
      usedComps = 0;
    }
    if (block.chars > textBudget) { // pathological single block — hard-fit it
      block.text = truncate_(block.text, textBudget);
      block.chars = textBudget;
    }
    current.push(block);
    usedChars += block.chars;
    usedComps += block.comps;
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * allowed_mentions controls who can actually be pinged:
 *  - default: parse: [] → respondent answers can never ping anyone
 *  - explicit role/user IDs in CONFIG.MENTION are whitelisted
 *  - '@everyone' / '@here' in CONFIG.MENTION enables the everyone allowance
 */
function buildAllowedMentions_(mention) {
  if (!mention) return { parse: [] };
  if (/@(everyone|here)\b/.test(mention)) return { parse: ['everyone'] };
  const roles = [...mention.matchAll(/<@&(\d+)>/g)].map(m => m[1]);
  const users = [...mention.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
  return {
    parse: [],
    ...(roles.length ? { roles: roles } : {}),
    ...(users.length ? { users: users } : {}),
  };
}

function formatTimestamp_(date) {
  const tz = CONFIG.TIMEZONE || Session.getScriptTimeZone() || 'UTC';
  return Utilities.formatDate(new Date(date), tz, 'MMM d, yyyy HH:mm');
}

function truncate_(text, max) {
  text = String(text);
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

// ══════════════════════════════════════════════════════════════════════
//  Delivery
// ══════════════════════════════════════════════════════════════════════

/** Sends every payload to every configured webhook. */
function deliver_(payloads) {
  const urls = (CONFIG.WEBHOOK_URLS || [])
    .map(u => String(u).trim())
    .filter(isWebhookUrl_);

  if (!urls.length) {
    throw new Error(
      'CONFIG.WEBHOOK_URLS does not contain a valid webhook URL. ' +
      'Copy it from Discord → Server Settings → Integrations → Webhooks → Copy Webhook URL.'
    );
  }

  let sent = 0;
  for (const url of urls) {
    for (const payload of payloads) {
      postToWebhook_(url, payload);
      sent += 1;
      if (payloads.length > 1 || urls.length > 1) Utilities.sleep(400);
    }
  }
  return sent;
}

/**
 * POSTs one payload. Note the `?with_components=true` query parameter —
 * for webhooks that are not owned by an application, Discord silently
 * ignores the components field unless it is present.
 */
function postToWebhook_(url, payload) {
  const base = url.split('?')[0];
  const target = CONFIG.THREAD_ID
    ? `${base}?with_components=true&thread_id=${encodeURIComponent(CONFIG.THREAD_ID)}`
    : `${base}?with_components=true`;

  let code = 0;
  let body = '';
  for (let attempt = 1; attempt <= 2; attempt++) { // one retry on rate limit
    const response = UrlFetchApp.fetch(target, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    code = response.getResponseCode();
    body = response.getContentText();
    if (code !== 429) break;
    const wait = parseRetryAfter_(body);
    console.warn(`FormPigeon: rate limited — retrying in ${wait} ms`);
    Utilities.sleep(wait);
  }

  if (code < 200 || code >= 300) {
    throw new Error(`Discord webhook returned HTTP ${code}: ${body.slice(0, 500)}`);
  }
}

function parseRetryAfter_(body) {
  try {
    const data = JSON.parse(body);
    if (data && typeof data.retry_after === 'number') {
      return data.retry_after * 1000 + 250;
    }
  } catch (err) {
    // fall through
  }
  return 1000;
}

/** Matches a normal incoming webhook URL (query strings tolerated). */
function isWebhookUrl_(url) {
  const base = String(url).trim().split('?')[0];
  return /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(base);
}

/** Logs the failure and (optionally) emails the script owner. */
function handleFailure_(err) {
  console.error('FormPigeon: failed to deliver a notification.', err && err.stack ? err.stack : err);
  if (!CONFIG.EMAIL_ON_ERROR) return;
  try {
    const recipient = Session.getEffectiveUser().getEmail();
    if (recipient) {
      MailApp.sendEmail({
        to: recipient,
        subject: '🕊️ FormPigeon could not deliver a form notification',
        body:
          'FormPigeon failed to post a form response to Discord.\n\n' +
          `Error:\n${err && err.stack ? err.stack : String(err)}\n\n` +
          'Check the Apps Script execution log (Executions) for details.',
      });
    }
  } catch (mailErr) {
    console.error('FormPigeon: the error email could not be sent either.', mailErr);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Form-editor menu (🕊️ Discord)
//  Only works when this script is BOUND to the form
//  (open the form → Extensions → Apps Script).
// ══════════════════════════════════════════════════════════════════════

function onOpen() {
  FormApp.getUi()
    .createMenu('🕊️ Discord')
    .addItem('📮 Send test message', 'menuSendTestMessage')
    .addItem('🟢 Install notification trigger', 'menuInstallTrigger')
    .addItem('🔴 Remove notification trigger', 'menuUninstallTrigger')
    .addSeparator()
    .addItem('ℹ️ Check status', 'menuShowStatus')
    .addToUi();
}

function menuSendTestMessage() {
  const ui = FormApp.getUi();
  try {
    const payloads = buildPayloadParts(sampleSubmissionData_());
    const sent = deliver_(payloads);
    ui.alert(
      '🕊️ Test delivered',
      `Sent ${sent} message(s) to your webhook(s).\n\n` +
      'If nothing arrived in Discord, double-check CONFIG.WEBHOOK_URLS ' +
      'and the Apps Script execution log.',
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('❌ Test failed', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
  }
}

function menuInstallTrigger() {
  const ui = FormApp.getUi();
  try {
    const form = FormApp.getActiveForm();
    if (!form) throw new Error('This script is not bound to a form. Open your form → Extensions → Apps Script and paste the code there.');
    assertConfigured_();
    removeExistingTriggers_(form);
    ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
    ui.alert(
      '✅ Trigger installed',
      'Every new form response will now be posted to Discord.\n\n' +
      'Tip: send one real submission to verify end-to-end.',
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('❌ Install failed', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
  }
}

function menuUninstallTrigger() {
  const ui = FormApp.getUi();
  try {
    const form = FormApp.getActiveForm();
    if (!form) throw new Error('This script is not bound to a form.');
    const removed = removeExistingTriggers_(form);
    ui.alert(
      removed ? '🗑️ Trigger removed' : 'Nothing to remove',
      removed
        ? 'Notifications are now switched off. The script and its authorization remain.'
        : 'No notification trigger was installed for this form.',
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('❌ Remove failed', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
  }
}

function menuShowStatus() {
  const ui = FormApp.getUi();
  try {
    const form = FormApp.getActiveForm();
    const triggers = form
      ? ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onFormSubmit')
      : [];
    const urls = (CONFIG.WEBHOOK_URLS || []).filter(isWebhookUrl_);
    const lines = [
      `Webhook URLs: ${urls.length} valid / ${(CONFIG.WEBHOOK_URLS || []).length} configured`,
      `Notification trigger: ${triggers.length ? `installed (×${triggers.length})` : 'NOT installed'}`,
      `Bot name: ${CONFIG.BOT_NAME || '(webhook default)'}`,
      `Mention: ${CONFIG.MENTION || '(none)'}`,
      `Edited-response marker: ${CONFIG.MARK_EDITED ? 'on' : 'off'}`,
      `File thumbnails: ${CONFIG.FILE_THUMBNAILS ? 'on' : 'off'}`,
      `Unanswered questions listed: ${CONFIG.SHOW_UNANSWERED ? 'yes' : 'no'}`,
    ];
    if (!form) {
      lines.push('');
      lines.push('⚠️ This script is not bound to a form — the Discord menu only works from a form-bound script.');
    }
    ui.alert('ℹ️ FormPigeon status', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('❌ Status failed', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
  }
}

function removeExistingTriggers_(form) {
  let removed = 0;
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() !== 'onFormSubmit') continue;
    const sourceId = trigger.getTriggerSourceId ? String(trigger.getTriggerSourceId()) : '';
    if (!form || !sourceId || sourceId === String(form.getId())) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  }
  return removed;
}

function assertConfigured_() {
  const urls = (CONFIG.WEBHOOK_URLS || []).filter(isWebhookUrl_);
  if (!urls.length) {
    throw new Error(
      'No valid webhook URL found in CONFIG.WEBHOOK_URLS.\n' +
      'Copy it from Discord → Server Settings → Integrations → Webhooks → your webhook → Copy Webhook URL.'
    );
  }
}

/** Synthetic submission used by "Send test message". */
function sampleSubmissionData_() {
  const form = FormApp.getActiveForm();
  return {
    formTitle: `${form ? form.getTitle() : 'Sample form'} — test notification`,
    respondentEmail: 'respondent@example.com',
    timestamp: new Date(),
    edited: false,
    responseId: 'test-response-id',
    editUrl: form ? form.getPublishedUrl() : 'https://docs.google.com/forms',
    formEditUrl: form ? form.getEditUrl() : 'https://docs.google.com/forms',
    qa: [
      { question: 'What is your name?', answer: formatAnswer_('Ada Lovelace') },
      { question: 'Which workshops did you attend?', answer: formatAnswer_(['Intro to Apps Script', 'Components V2 in practice']) },
      { question: 'Rate the event (1–5)', answer: formatAnswer_('5') },
      {
        question: 'Anything else you would like to tell us?',
        answer: formatAnswer_('Loved it!\n' +
          'Markdown typed by respondents shows up as plain text: **bold**, # heading, ' +
          '<@123456789012345678>, @everyone and ||spoiler||.'),
      },
      { question: 'A question left unanswered (demo)', answer: null },
    ],
    files: [],
  };
}
