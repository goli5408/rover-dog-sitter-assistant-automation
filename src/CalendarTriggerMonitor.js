/**
 * The Barking Lot — Calendar v0.6 monitoring trigger.
 * Installs an hourly trigger for calendarDryRun ONLY.
 * Does not enable or call calendarSafeWriteOnce.
 * Run installCalendarMonitorTrigger manually once from Apps Script.
 */
function installCalendarMonitorTrigger() {
  if (typeof calendarDryRun !== 'function') {
    throw new Error('calendarDryRun is missing. Install CalendarSync v0.6 first.');
  }
  // Fail closed if this project already has a calendar write trigger.
  var triggers = ScriptApp.getProjectTriggers();
  var dangerous = triggers.filter(function(t) {
    return t.getHandlerFunction() === 'calendarSafeWriteOnce';
  });
  if (dangerous.length) {
    throw new Error('A calendarSafeWriteOnce trigger exists. Remove it manually before proceeding.');
  }
  // Idempotent install; prevents duplicated monitoring schedules.
  var existing = triggers.filter(function(t) {
    return t.getHandlerFunction() === 'calendarDryRun';
  });
  if (existing.length === 1) {
    console.log('Calendar monitor already installed (1 trigger). No changes made.');
    return;
  }
  if (existing.length > 1) {
    throw new Error('Multiple calendarDryRun triggers exist. Review and remove duplicates manually.');
  }
  ScriptApp.newTrigger('calendarDryRun')
    .timeBased()
    .everyHours(1)
    .create();
  console.log('Installed 1 hourly calendarDryRun trigger (monitor only; no Notion writes).');
}

/** Read-only status: does not print private calendar IDs or tokens. */
function checkCalendarMonitorTrigger() {
  var hits = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'calendarDryRun';
  });
  var writes = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'calendarSafeWriteOnce';
  });
  console.log('calendarDryRun triggers: ' + hits.length);
  console.log('calendarSafeWriteOnce triggers: ' + writes.length);
  if (writes.length) {
    console.warn('Unexpected calendar write trigger detected. Disable it immediately.');
  }
}

/** Removes only calendarDryRun triggers; preserves Form triggers. */
function uninstallCalendarMonitorTrigger() {
  var count = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'calendarDryRun') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  console.log('Removed ' + count + ' calendar monitoring trigger(s).');
}
