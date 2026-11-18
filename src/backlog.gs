/**
 * Backlog mode: labels the emails already in your inbox (older than 2 days; run() handles newer ones).
 * startBacklog() runs a batch every 5 minutes until a run labels nothing, then switches itself off.
 * Backlog emails are not added to the digest.
 */

function startBacklog() {
  stopBacklog();
  ScriptApp.newTrigger('backlogRun').timeBased().everyMinutes(5).create();
  console.log('Backlog started: a batch every 5 minutes. Watch progress in the Runs tab of the Sheet.');
}

function backlogRun() {
  withLock(() => {
    const stats = processInbox({
      query: inboxQuery() + ' older_than:2d',
      batchSize: CONFIG.backlogBatchSize,
      mode: 'backlog',
      digest: false,
    });
    // Stop when nothing new was labelled: either the inbox is done, or every remaining email
    // keeps failing (see 'First error' in the Runs tab), which would otherwise retry forever.
    if (stats.processed === 0) {
      stopBacklog();
      logRun('backlog finished', stats);
    }
  });
}

function stopBacklog() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'backlogRun')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}
