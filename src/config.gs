/**
 * email-sorter settings. This is the only file most people need to edit.
 * After changing anything here, run setup() once from the Apps Script editor.
 * Using clasp and a public fork? Put personal settings in src/config.local.gs (gitignored),
 * e.g. CONFIG.aboutMe = `...`; it runs after this file, so its values win.
 */
const CONFIG = {
  // ── AI provider ─────────────────────────────────────────────────────────
  // Add the matching key in Project Settings → Script Properties:
  //   anthropic → ANTHROPIC_API_KEY   openai → OPENAI_API_KEY   gemini → GEMINI_API_KEY
  //
  // Cheap models that work well (USD per million tokens, checked Nov 2026):
  //   provider    model                   input   output
  //   anthropic   claude-haiku-5-5        0.10    0.50    ← default
  //   openai      gpt-6-luna              0.10    0.50
  //   gemini      gemini-3.1-flash-lite   0.25    1.50
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  pricePerMillion: { input: 0.10, output: 0.50 }, // only used for cost estimates

  // ── Schedule ────────────────────────────────────────────────────────────
  triggerMinutes: 10,      // how often new mail is checked: 1, 5, 10, 15 or 30
  batchSize: 25,           // max emails per normal run
  backlogBatchSize: 100,   // max emails per backlog run (each run also stops after ~4 minutes)

  digest: {
    frequency: 'daily',    // 'daily', 'weekly' or 'off'
    hour: 21,              // 0–23, in the timeZone set in appsscript.json
    weekday: 'SUNDAY',     // only used when frequency is 'weekly'
  },

  // ── Labels ──────────────────────────────────────────────────────────────
  // Every email gets exactly one of these. The AI reads the descriptions, so be specific.
  // digest: 'highlight' = listed near the top, 'show' = listed, 'count' = collapsed to a count
  // If a Gmail label with the exact same name already exists, it is reused.
  labels: [
    { name: '0 University', digest: 'show',
      description: "Course platform (e.g. Moodle), department office, accommodation, careers service, students' union admin" },
    { name: '1 Orders', digest: 'show',
      description: 'Purchases, receipts, payments, subscriptions, refunds, bank notifications, travel bookings, deliveries' },
    { name: '2 Opportunities', digest: 'highlight',
      description: 'Hackathons, events, workshops, internships, job and recruiter emails, application updates' },
    { name: '3 LinkedIn', digest: 'count',
      description: 'All LinkedIn notifications' },
    { name: '4 Security', digest: 'show',
      description: 'Sign-in alerts, new apps connected, password changes, account notices, dev alerts (Vercel, GitHub, API billing/usage)' },
    { name: '5 Promotions', digest: 'count',
      description: 'Marketing, promos, product updates, surveys, general newsletters' },
  ],
  actionLabel: '⭐ Action',                 // added on top of the category when an email needs you
  digestLabel: '📋 Digest',                 // put on the digest emails themselves
  processedLabel: 'InboxSorter/Processed',  // hidden label that marks emails already handled

  // ── Sender rules ────────────────────────────────────────────────────────
  // Matching senders are labelled directly and skip the AI (free and instant).
  // from: a full address ('tutor@uni.ac.uk') or a domain ('linkedin.com', also matches subdomains).
  // Note: with the LinkedIn rule, messages from real people on LinkedIn are never marked Action.
  senderRules: [
    { from: 'linkedin.com', label: '3 LinkedIn', action: false },
    // { from: 'noreply@github.com', label: '4 Security', action: false },
    // { from: 'my.tutor@uni.ac.uk', label: '0 University', action: true },
  ],

  // ── About me ────────────────────────────────────────────────────────────
  // ╔════════════════════════════════════════════════════════════════════╗
  // ║  EXAMPLE (a made-up student): REPLACE THIS WITH YOUR OWN. The AI    ║
  // ║  uses it to decide which emails get ⭐ Action. See README.          ║
  // ╚════════════════════════════════════════════════════════════════════╝
  aboutMe: `
I'm a university student. I'm applying for internships, go to hackathons and tech events, and build side projects that I deploy online. I'd rather have one unimportant email marked as Action than miss one important one.

Mark as ACTION if it:
- Is from a real person writing to me (not a mailing list), or is a reply in a thread I started
- Needs me to do something or has a deadline: book, pay, sign, reply, submit, confirm
- Is about an application I've made (receipts, online assessments, interviews, offers, rejections)
- Is a security alert I didn't expect (new sign-in, new app connected, password change) or a problem with my money (refunds, failed/cancelled payments, disputes)
- Is a failed deployment or broken build for one of my projects
- Is an event I've signed up to that's in the next 48 hours, or a change to it
- Affects my plans in the next few days (travel disruption, strikes, cancellations)

NOT action:
- Marketing, promos, discounts, "you forgot to finish signing up", product updates
- LinkedIn notifications and stats
- Surveys, prize draws, general university or Students' Union newsletters
- Confirmations that need nothing from me (submission receipts, order shipped, booking confirmed, appointment reminders)
- New events or opportunities I haven't signed up to (these get highlighted in the digest instead)

When unsure, mark it as Action.
`,
};
