/**
 * Digest: emails you a summary of everything labelled since the last digest.
 * Order: ⭐ Action first, then 'highlight' labels, then 'show' labels; 'count' labels are collapsed to a count.
 * Action emails always appear in the top section, so nothing that needs you is hidden in a collapsed group.
 */

function sendDigest() {
  withLock(() => {
    const props = PropertiesService.getScriptProperties();
    const since = new Date(Number(props.getProperty('DIGEST_LAST') || 0));
    const now = new Date();

    const emails = rowsSince(EMAIL_SHEET, since).map((r) => ({
      threadId: r[1], from: r[2], label: r[3], action: r[4] === true, summary: r[5],
    }));
    const cost = rowsSince(RUN_SHEET, since).reduce((sum, r) => sum + (Number(r[8]) || 0), 0);

    if (emails.length) { // nothing new means no email
      const me = Gmail.Users.getProfile('me').emailAddress;
      const subject = `📋 Inbox digest: ${emails.length} email${emails.length === 1 ? "" : "s"} sorted`;
      const sent = sendToSelf(me, subject, buildDigestHtml(emails, cost, me));
      // Label it straight away so the sorter never classifies its own digest.
      const ids = getLabelIds();
      Gmail.Users.Threads.modify({ addLabelIds: [ids[CONFIG.digestLabel], ids[CONFIG.processedLabel]] }, 'me', sent.threadId);
    }
    props.setProperty('DIGEST_LAST', String(now.getTime()));
    console.log(`Digest: ${emails.length} emails, ~$${cost.toFixed(4)} API cost since ${since.toISOString()}.`);
  }, 5 * 60 * 1000); // wait up to 5 min for a running run() to finish
}

/** Builds the digest body. `labels` defaults to CONFIG.labels; selfTest() passes its own. */
function buildDigestHtml(emails, cost, me, labels = CONFIG.labels) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const link = (threadId) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(me)}#all/${encodeURIComponent(threadId)}`;
  const line = (e) => `<li><b>${esc(senderName(e.from))}</b>: ${esc(e.summary)} · <a href="${link(e.threadId)}">Open</a></li>`;
  const section = (title, items) => `<h3>${esc(title)} (${items.length})</h3><ul>${items.map(line).join('')}</ul>`;

  const action = emails.filter((e) => e.action);
  let html = action.length ? section(CONFIG.actionLabel, action) : '';

  const order = ['highlight', 'show', 'count'];
  const sorted = labels.slice().sort((a, b) => order.indexOf(a.digest) - order.indexOf(b.digest)); // stable: keeps config order
  for (const l of sorted) {
    const items = emails.filter((e) => !e.action && e.label === l.name);
    if (!items.length) continue;
    html += l.digest === 'count'
      ? `<h3>${esc(l.name)}</h3><p>${items.length} email${items.length === 1 ? '' : 's'}</p>`
      : section(l.name, items);
  }
  return html + `<hr><p>${emails.length} emails labelled · estimated API cost $${cost.toFixed(4)}</p>`;
}

/** 'Jane Doe <jane@example.com>' → 'Jane Doe'; a bare address stays as it is. */
function senderName(from) {
  return String(from).replace(/\s*<[^>]*>\s*$/, '').replace(/^"(.*)"$/, '$1').trim() || String(from);
}

/** Sends an HTML email to yourself through the Gmail API and returns { id, threadId }. */
function sendToSelf(me, subject, html) {
  const mime = [
    `To: ${me}`,
    `From: ${me}`,
    `Subject: =?UTF-8?B?${Utilities.base64Encode(subject, Utilities.Charset.UTF_8)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ].join('\r\n');
  return Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8) }, 'me');
}
