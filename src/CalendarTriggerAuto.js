/**
 * The Barking Lot v0.7 Calendar → Notion Trigger Installation.
 * IMPORTANT: Run baselineCalendarBookings() in CalendarSync v0.7 first.
 * No external Web App deployment is required.
 */
function installCalendarAutoSyncTrigger() {
  if (typeof calendarAutoSync !== 'function') {
    throw new Error('Install CalendarSync v0.7 before this trigger.');
  }
  var props=PropertiesService.getScriptProperties();
  if (props.getProperty('TBL_AUTO_SYNC_BASELINED')!=='true') {
    throw new Error('First run baselineCalendarBookings() to protect all existing bookings.');
  }
  var rover=props.getProperty('TBL_ROVER_CALENDAR_ID');
  var direct=props.getProperty('TBL_DIRECT_CALENDAR_ID');
  if (props.getProperty('TBL_AUTO_SYNC_CALENDAR_BINDING')!==rover+'|'+direct) {
    throw new Error('Calendar IDs changed since baseline; cannot enable.');
  }
  var active=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()==='calendarAutoSync';
  });
  if(active.length>1)throw new Error('Duplicate automatic sync triggers detected; resolve manually.');
  if(active.length===1){
    props.setProperty('TBL_AUTO_SYNC_ENABLED','true');
    console.log('Existing 1 hourly calendarAutoSync trigger verified; auto sync enabled.');
    return;
  }
  // The old one-time writer must never be installed as a trigger.
  if(ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='calendarSafeWriteOnce';})) {
    throw new Error('Unsafe calendarSafeWriteOnce trigger detected. Remove it first.');
  }
  props.setProperty('TBL_AUTO_SYNC_ENABLED','true');
  try {
    ScriptApp.newTrigger('calendarAutoSync').timeBased().everyHours(1).create();
  } catch(e) {
    props.setProperty('TBL_AUTO_SYNC_ENABLED','false');
    throw e;
  }
  console.log('Installed 1 hourly calendarAutoSync trigger. Only new, uniquely matched events may create Notion bookings.');
}

function checkCalendarAutoSyncTrigger() {
  var p=PropertiesService.getScriptProperties();
  var names=ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction();});
  console.log('calendarAutoSync triggers: '+names.filter(function(x){return x==='calendarAutoSync';}).length);
  console.log('calendarDryRun monitor triggers: '+names.filter(function(x){return x==='calendarDryRun';}).length);
  console.log('Baseline complete: '+(p.getProperty('TBL_AUTO_SYNC_BASELINED')==='true'));
  console.log('Automatic Notion creation enabled: '+(p.getProperty('TBL_AUTO_SYNC_ENABLED')==='true'));
}

function disableCalendarAutoSync() {
  var p=PropertiesService.getScriptProperties();
  // Flip kill switch FIRST, then remove scheduled auto-create triggers.
  p.setProperty('TBL_AUTO_SYNC_ENABLED','false');
  var count=0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==='calendarAutoSync'){
      ScriptApp.deleteTrigger(t);count++;
    }
  });
  console.log('Auto creation disabled; removed '+count+' auto-sync trigger(s). Dry-run monitoring remains unchanged.');
}
