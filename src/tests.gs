/**
 * selfTest(): checks the logic without touching Gmail or calling the AI. Free; run it after editing config.gs.
 * dryRun():   classifies your 5 newest inbox emails and logs the results WITHOUT labelling anything.
 *             This calls the AI, so it costs a fraction of a cent.
 */

function selfTest() {
  const eq = (actual, expected, what) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`selfTest failed (${what}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };
  const throws = (fn, what) => {
    try { fn(); } catch (e) { return; }
    throw new Error(`selfTest failed (${what}): expected an error`);
  };

  validateConfig();

  // Sender rules: exact address, domain and subdomain match, but no look-alike domains.
  const rules = [{ from: 'linkedin.com', label: 'L', action: false }, { from: 'tutor@uni.ac.uk', label: 'U', action: true }];
  eq(senderAddress('Jane Doe <Jane@Example.com>'), 'jane@example.com', 'senderAddress');
  eq((matchRule('LinkedIn <messages-noreply@linkedin.com>', rules) || {}).label, 'L', 'domain rule');
  eq((matchRule('jobs@e.linkedin.com', rules) || {}).label, 'L', 'subdomain rule');
  eq((matchRule('Tutor <tutor@uni.ac.uk>', rules) || {}).label, 'U', 'address rule');
  eq(matchRule('someone@notlinkedin.com', rules), undefined, 'look-alike domain');
  eq(matchRule('other@uni.ac.uk', rules), undefined, 'other address on same domain');

  // AI answers: valid JSON passes, anything malformed throws so the email is retried.
  const label = CONFIG.labels[0].name;
  eq(parseClassification(JSON.stringify({ label, action: true, summary: 'Reply needed' })),
    { label, action: true, summary: 'Reply needed' }, 'valid answer');
  eq(parseClassification('```json\n' + JSON.stringify({ label, action: false, summary: 'x' }) + '\n```').label, label, 'fenced answer');
  eq(parseClassification(JSON.stringify({ label, action: false, summary: 'w '.repeat(40) })).summary.split(' ').length, 20, 'summary capped');
  throws(() => parseClassification('not json'), 'invalid JSON');
  throws(() => parseClassification(JSON.stringify({ label: 'Made Up', action: true, summary: 'x' })), 'unknown label');
  throws(() => parseClassification(JSON.stringify({ label, action: 'yes', summary: 'x' })), 'non-boolean action');

  // Email bodies: plain text preferred, HTML stripped as a fallback, then the snippet.
  const part = (mimeType, text) => ({ mimeType, body: { data: Utilities.base64EncodeWebSafe(text) } });
  eq(extractBody({ mimeType: 'multipart/alternative', parts: [part('text/html', '<p>HTML</p>'), part('text/plain', 'Plain  text\n')] }),
    'Plain text', 'prefers text/plain');
  eq(extractBody({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative',
    parts: [part('text/html', '<style>p{}</style><p>Hi &amp; bye</p>')] }] }), 'Hi & bye', 'nested HTML fallback');
  eq(extractBody({ mimeType: 'text/plain', body: { size: 0 } }, 'snippet'), 'snippet', 'snippet fallback');
  eq(extractBody(part('text/plain', 'x'.repeat(5000))).length, BODY_CHARS, 'body cut to BODY_CHARS');

  // Digest: Action first, then highlight, then show; count labels collapsed; HTML escaped.
  const labels = [
    { name: 'Show', digest: 'show' }, { name: 'Count', digest: 'count' }, { name: 'High', digest: 'highlight' },
  ];
  const html = buildDigestHtml([
    { threadId: 't1', from: '"Ann" <a@x.com>', label: 'Show', action: false, summary: 'show-item' },
    { threadId: 't2', from: 'b@x.com', label: 'Count', action: false, summary: 'hidden-item' },
    { threadId: 't3', from: 'c@x.com', label: 'High', action: false, summary: 'high-item' },
    { threadId: 't4', from: 'd@x.com', label: 'Count', action: true, summary: 'act <now>' },
  ], 0.0123, 'me@x.com', labels);
  const pos = (s) => html.indexOf(s);
  eq(pos('act &lt;now&gt;') < pos('high-item') && pos('high-item') < pos('show-item'), true, 'digest order');
  eq(pos('hidden-item'), -1, 'count label collapsed');
  eq(pos('<b>Ann</b>') > -1 && pos('$0.0123') > -1, true, 'sender name and cost');

  console.log('selfTest passed ✔');
}

function dryRun() {
  const stats = { inputTokens: 0, outputTokens: 0 };
  for (const m of Gmail.Users.Messages.list('me', { q: 'in:inbox', maxResults: 5 }).messages || []) {
    const email = readEmail(m.id);
    const r = classifyEmail(email, stats);
    console.log(`${r.label}${r.action ? ' + ' + CONFIG.actionLabel : ''}${r.byRule ? ' (sender rule)' : ''}` +
      ` | ${email.from} | ${r.summary}`);
  }
  console.log(`Tokens: ${stats.inputTokens} in, ${stats.outputTokens} out; est. cost $${estimateCost(stats.inputTokens, stats.outputTokens).toFixed(5)}. Nothing was labelled.`);
}
