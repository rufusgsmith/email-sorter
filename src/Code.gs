/**
 * email-sorter: AI that labels your Gmail.
 *
 * Entry points (run from the Apps Script editor):
 *   setup()        check config, create labels and log tabs, install triggers. Re-run after editing config.gs.
 *   run()          label new inbox emails. The trigger runs this every CONFIG.triggerMinutes.
 *   sendDigest()   in digest.gs
 *   startBacklog() in backlog.gs
 *   selfTest(), dryRun() in tests.gs
 */

const TIME_LIMIT_MS = 4 * 60 * 1000; // stop well before Apps Script's 6-minute execution limit
const RUN_SHEET = 'Runs';
const EMAIL_SHEET = 'Emails';
const SHEET_HEADERS = {
  [RUN_SHEET]: ['Time', 'Mode', 'Processed', 'By sender rule', 'Failed', 'Labels', 'Input tokens', 'Output tokens', 'Est. cost (USD)', 'First error'],
  [EMAIL_SHEET]: ['Time', 'Thread ID', 'From', 'Label', 'Action', 'Summary'],
};
const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function setup() {
  validateConfig();
  getApiKey();
  getLabelIds(); // creates any missing labels
  getSheet(RUN_SHEET);
  getSheet(EMAIL_SHEET);

  // Replace our triggers so re-running setup() never duplicates them (a running backlog is left alone).
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() !== 'backlogRun')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().everyMinutes(CONFIG.triggerMinutes).create();

  const d = CONFIG.digest;
  if (d.frequency !== 'off') {
    const t = ScriptApp.newTrigger('sendDigest').timeBased().atHour(d.hour);
    (d.frequency === 'weekly' ? t.onWeekDay(ScriptApp.WeekDay[d.weekday]) : t.everyDays(1)).create();
  }
  console.log(`Setup done. Checking new mail every ${CONFIG.triggerMinutes} min; digest: ${d.frequency}.`);
}

/** Labels new inbox emails (last 2 days). Older emails are left for backlog mode. */
function run() {
  withLock(() => processInbox({ query: inboxQuery() + ' newer_than:2d', batchSize: CONFIG.batchSize, mode: 'run', digest: true }));
}

/** Gmail search for inbox emails we haven't processed. Gmail search writes '/' and spaces in label names as '-'. */
function inboxQuery() {
  return 'in:inbox -label:' + CONFIG.processedLabel.toLowerCase().replace(/[\s/]+/g, '-');
}

/**
 * Classifies and labels up to batchSize threads matching query, stopping early near the time limit.
 * A failed email is left unlabelled, so the next run picks it up again.
 * When digest is true, each email is added to the Emails tab for the next digest.
 */
function processInbox({ query, batchSize, mode, digest }) {
  const started = Date.now();
  const ids = getLabelIds();
  const stats = { processed: 0, byRule: 0, failed: 0, inputTokens: 0, outputTokens: 0, labels: {}, error: '' };

  // Newest first; keep one message per thread (the newest one, which is the one to classify).
  const seen = new Set();
  const messages = (Gmail.Users.Messages.list('me', { q: query, maxResults: batchSize }).messages || [])
    .filter((m) => !seen.has(m.threadId) && seen.add(m.threadId));

  for (const m of messages) {
    if (Date.now() - started > TIME_LIMIT_MS) break;
    try {
      const email = readEmail(m.id);
      const result = classifyEmail(email, stats);
      applyLabels(m.threadId, result, ids);

      stats.processed++;
      if (result.byRule) stats.byRule++;
      stats.labels[result.label] = (stats.labels[result.label] || 0) + 1;
      if (result.action) stats.labels[CONFIG.actionLabel] = (stats.labels[CONFIG.actionLabel] || 0) + 1;
      if (digest) appendRow(EMAIL_SHEET, [new Date(), m.threadId, email.from, result.label, result.action, result.summary]);
    } catch (e) {
      stats.failed++;
      stats.error = stats.error || String(e.message || e);
      console.error(`Message ${m.id} left for next run: ${e.message || e}`);
    }
  }
  if (messages.length) logRun(mode, stats); // empty runs aren't logged, so the sheet isn't flooded
  return stats;
}

/** Fetches one message and returns { from, subject, body } with the body cut to BODY_CHARS. */
function readEmail(id) {
  const msg = Gmail.Users.Messages.get('me', id, { format: 'full' });
  const header = (name) => (msg.payload.headers.find((h) => h.name.toLowerCase() === name) || {}).value || '';
  return { from: header('from'), subject: header('subject'), body: extractBody(msg.payload, msg.snippet) };
}

/** Adds category + processed (+ action) to the thread and removes any other category, so each thread has exactly one. */
function applyLabels(threadId, result, ids) {
  const add = [ids[result.label], ids[CONFIG.processedLabel]];
  if (result.action) add.push(ids[CONFIG.actionLabel]);
  const remove = CONFIG.labels.map((l) => ids[l.name]).filter((id) => !add.includes(id));
  Gmail.Users.Threads.modify({ addLabelIds: add, removeLabelIds: remove }, 'me', threadId);
}

let labelIdCache = null;

/** { labelName: labelId } for every label we use, creating missing ones. Existing labels with the exact name are reused. */
function getLabelIds() {
  if (labelIdCache) return labelIdCache;
  const ids = {};
  (Gmail.Users.Labels.list('me').labels || []).forEach((l) => (ids[l.name] = l.id));

  const wanted = CONFIG.labels.map((l) => l.name).concat(CONFIG.actionLabel, CONFIG.digestLabel, CONFIG.processedLabel);
  for (const name of wanted) {
    if (ids[name]) continue;
    const hidden = name === CONFIG.processedLabel;
    ids[name] = Gmail.Users.Labels.create({
      name,
      labelListVisibility: hidden ? 'labelHide' : 'labelShow',
      messageListVisibility: hidden ? 'hide' : 'show',
    }, 'me').id;
    console.log('Created Gmail label: ' + name);
  }
  return (labelIdCache = ids);
}

/** Throws one error listing every problem in config.gs. */
function validateConfig() {
  const c = CONFIG;
  const names = c.labels.map((l) => l.name);
  const problems = [];
  if (!PROVIDERS[c.provider]) problems.push(`provider must be one of: ${Object.keys(PROVIDERS).join(', ')}`);
  if (!names.length) problems.push('labels must not be empty');
  if (new Set(names).size !== names.length) problems.push('label names must be unique');
  for (const l of c.labels) {
    if (!['highlight', 'show', 'count'].includes(l.digest)) problems.push(`label "${l.name}": digest must be 'highlight', 'show' or 'count'`);
  }
  for (const r of c.senderRules) {
    if (!names.includes(r.label)) problems.push(`sender rule "${r.from}": label "${r.label}" is not in labels`);
    if (typeof r.action !== 'boolean') problems.push(`sender rule "${r.from}": action must be true or false`);
  }
  if (![1, 5, 10, 15, 30].includes(c.triggerMinutes)) problems.push('triggerMinutes must be 1, 5, 10, 15 or 30');
  if (!['daily', 'weekly', 'off'].includes(c.digest.frequency)) problems.push("digest.frequency must be 'daily', 'weekly' or 'off'");
  if (!(c.digest.hour >= 0 && c.digest.hour <= 23)) problems.push('digest.hour must be 0–23');
  if (c.digest.frequency === 'weekly' && !WEEKDAYS.includes(c.digest.weekday)) problems.push(`digest.weekday must be one of ${WEEKDAYS.join(', ')}`);
  if (problems.length) throw new Error('Please fix config.gs:\n- ' + problems.join('\n- '));
}

/** Runs fn while holding the script lock, so overlapping triggers can't label the same email twice. */
function withLock(fn, waitMs = 0) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) {
    console.log('Another email-sorter run is in progress; skipping this one.');
    return undefined;
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ── Log sheet (the Google Sheet this script is attached to) ────────────────

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(SHEET_HEADERS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Appends a row. Text starting with = + - @ is prefixed with ' so an email can't inject a spreadsheet formula. */
function appendRow(sheetName, values) {
  getSheet(sheetName).appendRow(values.map((v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v)));
}

/** Rows (without the header) whose first column (Time) is after `since`. */
function rowsSince(sheetName, since) {
  return getSheet(sheetName).getDataRange().getValues().slice(1).filter((r) => r[0] > since);
}

function logRun(mode, stats) {
  const cost = estimateCost(stats.inputTokens, stats.outputTokens);
  const labels = Object.keys(stats.labels).map((k) => `${k}: ${stats.labels[k]}`).join(', ');
  appendRow(RUN_SHEET, [new Date(), mode, stats.processed, stats.byRule, stats.failed, labels,
    stats.inputTokens, stats.outputTokens, cost, stats.error]);
  console.log(`${mode}: ${stats.processed} labelled (${stats.byRule} by sender rule), ${stats.failed} failed, ` +
    `${stats.inputTokens}+${stats.outputTokens} tokens, ~$${cost.toFixed(5)}. ${labels}`);
}
