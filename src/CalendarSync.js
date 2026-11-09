/**
 * The Barking Lot — Calendar → Notion DRY RUN + gated single-create + baseline-protected automatic sync.
 * Sidecar file: add to the *existing* Google Apps Script project alongside Code.gs.
 * Dry run reads only; calendarSafeWriteOnce can CREATE one Notion record after explicit gates.
 * Automatic writes require an explicit historical baseline and a separate v0.7 trigger.
 * Script properties: NOTION_TOKEN, CUSTOMERS_DATA_SOURCE_ID,
 * DOGS_DATA_SOURCE_ID, BOOKINGS_DATA_SOURCE_ID, TBL_ROVER_CALENDAR_ID, TBL_DIRECT_CALENDAR_ID.
 * All credentials/IDs stay in Script Properties, never committed.
 */
var TBLCalendar = (function () {
  'use strict';
  var API_VERSION = '2025-09-03';
  var LOG_SHEET = '_Calendar Sync Dry Run';
  var ALIAS_SHEET = '_Customer Aliases';
  var REGISTRY_SHEET = '_Calendar Sync Registry';
  var EVENT_KEY_PROPERTY = 'Calendar Event Key';
  var SOURCE_PROPERTY = 'Booking Source';
  var SERVICES = {'boarding':'Boarding','daycare':'Daycare','doggy day care':'Daycare',
    'doggy daycare':'Daycare','drop-in':'Drop-in','drop in':'Drop-in'};

  function norm(s) {return String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
  function uid(value) {var id = String(value || '').split('/').pop().replace(/-/g,''); var m=id.match(/[a-f0-9]{32}/i); return m?m[0].toLowerCase():'';}
  function cfg() {
    var p = PropertiesService.getScriptProperties();
    var keys = ['NOTION_TOKEN','CUSTOMERS_DATA_SOURCE_ID','DOGS_DATA_SOURCE_ID','BOOKINGS_DATA_SOURCE_ID','TBL_ROVER_CALENDAR_ID','TBL_DIRECT_CALENDAR_ID'];
    var c = {};
    keys.forEach(function(k){c[k] = p.getProperty(k); if (!c[k]) throw new Error('Missing Script Property: '+k);});
    return c;
  }
  function notion(method,path,body,c) {
    var opts = {method:method,muteHttpExceptions:true,headers:{Authorization:'Bearer '+c.NOTION_TOKEN,
      'Notion-Version':API_VERSION,'Content-Type':'application/json'}};
    if (body !== null) opts.payload = JSON.stringify(body);
    for (var k=0;k<3;k++) {
      var res = UrlFetchApp.fetch('https://api.notion.com/v1'+path,opts);
      var status=res.getResponseCode();
      if (status>=200 && status<300) return JSON.parse(res.getContentText());
      if (!(method==='post'&&path==='/pages') && (status===429||status>=500)&&k<2) {Utilities.sleep(1000*(k+1));continue;}
      throw new Error('Notion HTTP '+status+' on '+method+' '+path.split('?')[0]); // no response body / PII
    }
  }
  function rows(id,c) {
    var all=[],next=null;
    do {
      var req={page_size:100};if(next)req.start_cursor=next;
      var result=notion('post','/data_sources/'+id+'/query',req,c);
      all=all.concat(result.results||[]);
      next=result.has_more?result.next_cursor:null;
      if(all.length>5000)throw new Error('Too many Notion records; implement paging window.');
    }while(next);
    return all;
  }
  function plain(p) {
    if(!p) return '';
    var v = p[p.type] || p.title || p.rich_text || [];
    if(Array.isArray(v))return v.map(function(t){return t.plain_text||(t.text&&t.text.content)||'';}).join('');
    if(typeof v==='object') return v.name||v.start||'';
    return String(v||'');
  }
  function rel(p) {return (p && p.relation || []).map(function(x){return x.id.toLowerCase().replace(/-/g,'');});}
  function parseTitle(title) {
    var m = String(title||'').match(/^\s*(.+?)\s*\/\s*(.+?)\s*:\s*(.+?)\s*$/);
    if(!m)return {error:'TITLE_FORMAT'};
    var rawService=norm(m[3]);
    var request=/\b(request|inquiry|meet and greet)\b/.test(rawService);
    var clean=rawService.replace(/\b(request|inquiry)\b/g,'').trim();
    var service=SERVICES[clean];
    if(!service)return {error:'SERVICE_UNKNOWN'};
    return {dog:m[1].trim(),owner:m[2].trim(),service:service,isRequest:request};
  }
  function source(description) {
    var d=String(description||'');
    var rover=/(?:https?:\/\/)?(?:[\w.-]+\.)?rover\.com\//i.test(d);
    var direct=/^\s*Source\s*:\s*Direct\s*$/im.test(d);
    if(rover&&direct)return {source:'Unknown',reason:'SOURCE_CONFLICT'};
    if(rover)return {source:'Rover',reason:''};
    if(direct)return {source:'Direct',reason:''};
    return {source:'Unknown',reason:'SOURCE_UNKNOWN'};
  }
  function ownerComparison(fromCalendar, storedName) {
    var a=norm(fromCalendar), b=norm(storedName);
    if(a && a===b)return 'exact';
    // A calendar owner like 'Alex R.' matches a stored 'Alex Rivera' only approximately.
    // Never allow an approximate comparison to create or update a booking.
    var firstA=a.split(' ')[0], firstB=b.split(' ')[0];
    if(firstA && firstA===firstB)return 'weak';
    return 'none';
  }
  function matchProfile(parsed,customers,pets) {
    var named=pets.filter(function(p){return norm(plain(p.properties.Name))===norm(parsed.dog);});
    if(!named.length)return {state:'NEEDS_REVIEW',reason:'PET_NOT_FOUND'};
    var hits=[];
    named.forEach(function(p){
      var ids=rel(p.properties['Dog Parent(s)']);
      ids.forEach(function(id){var c=customers.find(function(x){return uid(x.id)===id;});
        if(c)hits.push({pet:p,owner:c,strength:ownerComparison(parsed.owner,plain(c.properties.Name))});});
    });
    var exact=hits.filter(function(x){return x.strength==='exact';});
    if(exact.length===1)return {state:'MATCHED',pet:exact[0].pet,customer:exact[0].owner};
    if(exact.length>1)return {state:'NEEDS_REVIEW',reason:'MULTIPLE_EXACT_OWNER_PET_PAIRS'};
    if(hits.some(function(x){return x.strength==='weak';}))return {state:'NEEDS_REVIEW',reason:'OWNER_ALIAS_UNVERIFIED'};
    return {state:'NEEDS_REVIEW',reason:'OWNER_PET_RELATION_NOT_FOUND'};
  }
  function verifiedAliases() {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sh=ss&&ss.getSheetByName(ALIAS_SHEET);
    if(!sh) return [];
    var n=sh.getLastRow();
    if(n<2)return [];
    return sh.getRange(2,1,n-1,7).getValues().map(function(v){
      return {alias:norm(v[0]), customerName:norm(v[1]), petName:norm(v[2]),
        verified:String(v[3]||'').trim().toLowerCase()==='confirmed by owner',
        customerId:uid(v[5]), petId:uid(v[6])};
    }).filter(function(a){return a.verified&&a.alias&&a.customerId&&a.petId;});
  }
  function matchProfileWithAliases(parsed,customers,pets,aliases) {
    var matches=[];
    pets.forEach(function(p){
      var pid=uid(p.id);
      var named=norm(plain(p.properties.Name))===norm(parsed.dog);
      var linked=rel(p.properties['Dog Parent(s)']);
      linked.forEach(function(ownerId){
        var customer=customers.find(function(c){return uid(c.id)===ownerId;});
        if(!customer)return;
        var exact=named&&norm(plain(customer.properties.Name))===norm(parsed.owner);
        var alias=named&&aliases.some(function(a){return a.alias===norm(parsed.owner)&&
          a.petName===norm(parsed.dog)&&a.customerId===ownerId&&a.petId===pid&&
          a.customerName===norm(plain(customer.properties.Name));});
        if(exact||alias)matches.push({pet:p,customer:customer});
      });
    });
    if(matches.length===1)return {state:'MATCHED',pet:matches[0].pet,customer:matches[0].customer};
    if(matches.length>1)return {state:'NEEDS_REVIEW',reason:'AMBIGUOUS_OWNER_PET_PAIR'};
    var standard=matchProfile(parsed,customers,pets);
    return standard.state==='MATCHED'?standard:{state:'NEEDS_REVIEW',reason:standard.reason};
  }
  function localDate(d) {return Utilities.formatDate(d,'America/Los_Angeles','yyyy-MM-dd');}
  function localDateTime(d) {return Utilities.formatDate(d,'America/Los_Angeles',"yyyy-MM-dd'T'HH:mm:ssXXX");}
  function allDayDate(d) {
    // CalendarApp exposes all-day date-only values as midnight UTC Dates.
    // Formatting them in LA can erroneously shift them to the previous day.
    return Utilities.formatDate(d,'UTC','yyyy-MM-dd');
  }
  function dateBeforeUtc(yyyyMmDd) {
    var d = new Date(yyyyMmDd + 'T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate()-1);
    return Utilities.formatDate(d,'UTC','yyyy-MM-dd');
  }
  function eventDates(ev) {
    if (ev.isAllDayEvent()) {
      var first=allDayDate(ev.getAllDayStartDate());
      var endExclusive=allDayDate(ev.getAllDayEndDate());
      return {kind:'ALL_DAY',start:first,end:dateBeforeUtc(endExclusive),
        startTime:'',endTime:'',endExclusive:endExclusive};
    }
    var start=ev.getStartTime(),end=ev.getEndTime();
    return {kind:'TIMED',start:localDate(start),end:localDate(end),
      startTime:localDateTime(start),endTime:localDateTime(end),endExclusive:''};
  }
  function bookingDate(p){var d=p&&p.date;return d&&d.start?String(d.start).slice(0,10):'';}
  function evaluate(ev,ctx,calendarSource) {
    var parsed=parseTitle(ev.getTitle());
    var sr=source(ev.getDescription());
    // Calendar membership is authoritative for the booking *channel*, but
    // conflicting explicit metadata must be reviewed before any future write.
    var mismatch=(sr.source!=='Unknown'&&sr.source!==calendarSource);
    var sourceReason=mismatch?'SOURCE_CALENDAR_DESCRIPTION_CONFLICT':
      sr.reason==='SOURCE_CONFLICT'?'SOURCE_CONFLICT':'';
    var dates=eventDates(ev);
    // Calendar identity is stable across ordinary date/time edits.
    // Calendar ID is included to avoid collisions between separate calendars.
    var base={calendarEventKey:ctx.calendarId+'|'+ev.getId(),
      start:dates.start,end:dates.end,startTime:dates.startTime,endTime:dates.endTime,
      timeType:dates.kind,endExclusive:dates.endExclusive,
      source:calendarSource,service:parsed.service||'',action:'REVIEW',reason:''};
    if(parsed.error){base.reason=parsed.error;return base;}
    if(ev.isRecurringEvent&&ev.isRecurringEvent()){base.reason='RECURRING_EVENT_REVIEW';return base;}
    if(sourceReason){base.reason=sourceReason;return base;}
    if(parsed.isRequest){base.reason='REQUEST_NOT_CONFIRMED';return base;}
    var pair=matchProfileWithAliases(parsed,ctx.customers,ctx.pets,ctx.aliases||[]);
    if(pair.state!=='MATCHED'){base.reason=pair.reason;return base;}
    var petId=uid(pair.pet.id);
    var sameKey=ctx.bookings.filter(function(b){return plain(b.properties[EVENT_KEY_PROPERTY])===base.calendarEventKey;});
    if(sameKey.length>1){base.reason='DUPLICATE_EVENT_KEY_IN_NOTION';return base;}
    if(sameKey.length===1){
      // Do not mutate existing pages: manual review of any changed dates/status.
      base.action='EXISTING_REVIEW';base.reason='EXACT_EVENT_KEY_ALREADY_LINKED';return base;
    }
    var existing=ctx.bookings.filter(function(b){return rel(b.properties['🐶 Dog Profile']).indexOf(petId)!==-1;});
    var same=existing.filter(function(b){return bookingDate(b.properties['Drop-off'])===base.start && bookingDate(b.properties['Pick-up'])===base.end;});
    if(same.length>1){base.reason='MULTIPLE_BOOKINGS_SAME_DATES';return base;}
    if(same.length===1){base.action='EXISTING_REVIEW';base.reason='EXISTING_BOOKING_VERIFY_STATUS_AND_TIMES';return base;}
    // Date-only Notion fields cannot safely establish duplicate status for overlapping stays.
    var overlaps=existing.some(function(b){var st=bookingDate(b.properties['Drop-off']), en=bookingDate(b.properties['Pick-up']);
      return st&&en&&st<=base.end&&en>=base.start;});
    if(overlaps){base.reason='POSSIBLE_OVERLAPPING_BOOKING';return base;}
    base.action='CANDIDATE_CREATE';base.reason='MATCHED_OWNER_PET_CHECK_BEFORE_WRITE';
    return base;
  }
  function sheet() {
    var ss=SpreadsheetApp.getActiveSpreadsheet();if(!ss)throw new Error('Bind script to the Form response spreadsheet');
    var sh=ss.getSheetByName(LOG_SHEET)||ss.insertSheet(LOG_SHEET);
    var header=['Checked at','Calendar event key','Start date','End date','Source','Service','Action','Reason (no PII)','Time type','Start time (LA)','End time (LA)','All-day end (exclusive)'];
    sh.getRange(1,1,1,header.length).setValues([header]);sh.setFrozenRows(1);
    return sh;
  }
  function getConfiguredCalendar(id,label) {
    // 'primary' is a convenience value for the account's default calendar.
    var cal=id==='primary'?CalendarApp.getDefaultCalendar():CalendarApp.getCalendarById(id);
    if(!cal)throw new Error('Cannot access '+label+' calendar. Check Script Properties and sharing.');
    return cal;
  }
  function runCalendarDryRun() {
    var c=cfg();
    var rover=getConfiguredCalendar(c.TBL_ROVER_CALENDAR_ID,'Rover');
    var direct=getConfiguredCalendar(c.TBL_DIRECT_CALENDAR_ID,'Direct');
    if(rover.getId()===direct.getId())throw new Error('Rover and Direct calendar IDs must be different.');
    var now=new Date(),from=new Date(now.getTime()-40*86400000),to=new Date(now.getTime()+100*86400000);
    var sources=[{cal:rover,kind:'Rover'},{cal:direct,kind:'Direct'}];
    var candidates=[],excluded=0;
    sources.forEach(function(s){
      s.cal.getEvents(from,to).forEach(function(e){
        // Protect personal-calendar privacy. Only events that follow the
        // explicit booking convention are considered, even in Rover calendar.
        if(parseTitle(e.getTitle()).error){excluded++;return;}
        candidates.push({event:e,source:s.kind,calendarId:s.cal.getId()});
      });
    });
    var ctx={customers:rows(c.CUSTOMERS_DATA_SOURCE_ID,c),pets:rows(c.DOGS_DATA_SOURCE_ID,c),bookings:rows(c.BOOKINGS_DATA_SOURCE_ID,c),aliases:verifiedAliases()};
    var result=candidates.map(function(x){
      var scoped={customers:ctx.customers,pets:ctx.pets,bookings:ctx.bookings,
        calendarId:x.calendarId,aliases:ctx.aliases};
      return evaluate(x.event,scoped,x.source);
    });
    var sh=sheet();
    // Replace report rows, never Form responses / Notion / Calendar.
    var last=sh.getLastRow();if(last>1)sh.getRange(2,1,last-1,12).clearContent();
    if(result.length)sh.getRange(2,1,result.length,12).setValues(result.map(function(x){
      return [new Date(),x.calendarEventKey,x.start,x.end,x.source,x.service,x.action,x.reason,
        x.timeType,x.startTime,x.endTime,x.endExclusive];
    }));
    var counts={};result.forEach(function(x){counts[x.action]=(counts[x.action]||0)+1;});
    console.log('Calendar dry run: no Notion writes. Booking events='+result.length+'; unrelated events excluded='+excluded+'; actions='+JSON.stringify(counts));
    return counts;
  }
  function ensureNotionSchema(c) {
    var schema=notion('get','/data_sources/'+c.BOOKINGS_DATA_SOURCE_ID,null,c).properties||{};
    var requirements={Name:'title','🐶 Dog Profile':'relation','Drop-off':'date','Pick-up':'date',
      'Service Type':'select','Booking Status':'status'};
    Object.keys(requirements).forEach(function(k){
      if(!schema[k]||schema[k].type!==requirements[k])throw new Error('Booking schema missing/type mismatch: '+k);
    });
    if(!schema[EVENT_KEY_PROPERTY]||schema[EVENT_KEY_PROPERTY].type!=='rich_text')
      throw new Error('Add Notion rich_text property: '+EVENT_KEY_PROPERTY);
    if(!schema[SOURCE_PROPERTY]||schema[SOURCE_PROPERTY].type!=='select')
      throw new Error('Add Notion select property: '+SOURCE_PROPERTY+' (Rover, Direct)');
    ['Rover','Direct'].forEach(function(value){
      if(!(schema[SOURCE_PROPERTY].select.options||[]).some(function(o){return o.name===value;}))
        throw new Error('Missing Booking Source option: '+value);
    });
    return true;
  }
  function getEventForKey(c,key) {
    var calendars=[{cal:getConfiguredCalendar(c.TBL_ROVER_CALENDAR_ID,'Rover'),source:'Rover'},
      {cal:getConfiguredCalendar(c.TBL_DIRECT_CALENDAR_ID,'Direct'),source:'Direct'}];
    var hits=[];
    // Fail closed: prevent ambiguous calendar identities.
    if(calendars[0].cal.getId()===calendars[1].cal.getId())throw new Error('Calendar IDs are identical');
    // Stable provider ID plus Calendar ID, not date/time.
    calendars.forEach(function(entry){
      var prefix=entry.cal.getId()+'|';
      if(key.indexOf(prefix)!==0)return;
      var eventId=key.slice(prefix.length);
      if(!eventId)return;
      var now=new Date(),from=new Date(now.getTime()-40*86400000),to=new Date(now.getTime()+100*86400000);
      entry.cal.getEvents(from,to).forEach(function(ev){
        if(ev.getId()===eventId&&parseTitle(ev.getTitle()).error===undefined)
          hits.push({event:ev,source:entry.source,calendarId:entry.cal.getId()});
      });
    });
    if(hits.length!==1)throw new Error('Expected exactly one booking event in current sync window; found '+hits.length);
    return hits[0];
  }
  function runCalendarSafeWriteOnce() {
    var lock=LockService.getScriptLock();
    if(!lock.tryLock(10000))throw new Error('Another calendar write is running');
    try {
    var props=PropertiesService.getScriptProperties();
    var confirm=props.getProperty('TBL_SAFE_WRITE_CONFIRM');
    // Confirmation is one-time and consumed BEFORE attempting any write.
    if(confirm!=='CREATE_ONE_BOOKING_ONCE')throw new Error('Missing one-time TBL_SAFE_WRITE_CONFIRM');
    props.deleteProperty('TBL_SAFE_WRITE_CONFIRM');
    if(props.getProperty('TBL_SAFE_WRITE_ENABLED')!=='true')throw new Error('Safe Write disabled');
    if(props.getProperty('DRY_RUN')!=='false')throw new Error('DRY_RUN must be false for a controlled one-time create');
    var key=String(props.getProperty('TBL_SAFE_WRITE_EVENT_KEY')||'').trim();
    if(!key)throw new Error('Missing TBL_SAFE_WRITE_EVENT_KEY');
      var c=cfg();
      ensureNotionSchema(c);
      var selected=getEventForKey(c,key);
      var ctx={customers:rows(c.CUSTOMERS_DATA_SOURCE_ID,c),pets:rows(c.DOGS_DATA_SOURCE_ID,c),
        bookings:rows(c.BOOKINGS_DATA_SOURCE_ID,c),aliases:verifiedAliases(),calendarId:selected.calendarId};
      var checked=evaluate(selected.event,ctx,selected.source);
      if(checked.calendarEventKey!==key||checked.action!=='CANDIDATE_CREATE')
        throw new Error('Not eligible for create: '+checked.action+' / '+checked.reason);
      var parsed=parseTitle(selected.event.getTitle());
      var matching=matchProfileWithAliases(parsed,ctx.customers,ctx.pets,ctx.aliases);
      if(matching.state!=='MATCHED')throw new Error('Owner/pet relation not uniquely confirmed');
      var dates=eventDates(selected.event);
      var properties={};
      properties.Name={title:[{text:{content:parsed.dog}}]};
      properties['🐶 Dog Profile']={relation:[{id:matching.pet.id}]};
      properties['Service Type']={select:{name:parsed.service}};
      // Calendar presence does not prove booking approval or fulfillment.
      properties['Booking Status']={status:{name:'Inquiry'}};
      properties['Drop-off']={date:{start:dates.kind==='ALL_DAY'?dates.start:dates.startTime}};
      properties['Pick-up']={date:{start:dates.kind==='ALL_DAY'?dates.end:dates.endTime}};
      properties[EVENT_KEY_PROPERTY]={rich_text:[{text:{content:key}}]};
      properties[SOURCE_PROPERTY]={select:{name:selected.source}};
      if(selected.source==='Direct'){
        var schema=notion('get','/data_sources/'+c.BOOKINGS_DATA_SOURCE_ID,null,c).properties||{};
        if(schema['Rover Reviewed']&&schema['Rover Reviewed'].type==='select')
          properties['Rover Reviewed']={select:{name:'N/A'}};
      }
      var created=notion('post','/pages',{parent:{type:'data_source_id',data_source_id:c.BOOKINGS_DATA_SOURCE_ID},properties:properties},c);
      if(!created.id)throw new Error('Notion create returned no page ID; check before retrying');
      // Do not print event key / customer details into logs.
      console.log('Safe Write created one Booking page. No other records updated.');
      return {createdPageId:created.id,action:'CREATED'};
    } finally {lock.releaseLock();}
  }
  // v0.7: Explicit migration baseline. All calendar events present at the time
  // of baseline are NEVER automatically created as new Notion bookings.
  function calendarSources(c) {
    var rover=getConfiguredCalendar(c.TBL_ROVER_CALENDAR_ID,'Rover');
    var direct=getConfiguredCalendar(c.TBL_DIRECT_CALENDAR_ID,'Direct');
    if(rover.getId()===direct.getId())throw new Error('Calendar IDs must be different');
    return [{cal:rover,source:'Rover'},{cal:direct,source:'Direct'}];
  }
  function eventsInWindow(c) {
    var now=new Date(),from=new Date(now.getTime()-40*86400000),to=new Date(now.getTime()+100*86400000);
    var out=[];
    calendarSources(c).forEach(function(s){
      s.cal.getEvents(from,to).forEach(function(e){
        if(parseTitle(e.getTitle()).error)return;
        out.push({event:e,source:s.source,calendarId:s.cal.getId(),key:s.cal.getId()+'|'+e.getId()});
      });
    });
    var seen={};
    out.forEach(function(e){if(seen[e.key])throw new Error('Duplicate Calendar event key detected; aborting');seen[e.key]=true;});
    return out;
  }
  function registry() {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    if(!ss)throw new Error('Must be bound to Form response spreadsheet');
    var sh=ss.getSheetByName(REGISTRY_SHEET)||ss.insertSheet(REGISTRY_SHEET);
    var header=['Calendar Event Key','State','Notion Page ID','Checked At','Reason (no PII)'];
    sh.getRange(1,1,1,header.length).setValues([header]);
    sh.setFrozenRows(1);
    if(!sh.isSheetHidden())sh.hideSheet();
    return sh;
  }
  function registryIndex(sh) {
    var n=sh.getLastRow(),map={};
    if(n<2)return map;
    var values=sh.getRange(2,1,n-1,5).getValues();
    values.forEach(function(v,i){
      var key=String(v[0]||'');
      if(!key)return;
      if(map[key])throw new Error('Duplicate registry key; stop: row '+(i+2));
      map[key]={row:i+2,state:String(v[1]||''),pageId:String(v[2]||'')};
    });
    return map;
  }
  function recordRegistry(sh,index,key,state,pageId,reason) {
    var row=index[key]?index[key].row:sh.getLastRow()+1;
    sh.getRange(row,1,1,5).setValues([[key,state,pageId||'',new Date(),reason||'']]);
    index[key]={row:row,state:state,pageId:pageId||''};
  }
  function binding(c) {return c.TBL_ROVER_CALENDAR_ID+'|'+c.TBL_DIRECT_CALENDAR_ID;}
  function baselineCalendarBookings() {
    var lock=LockService.getScriptLock();
    if(!lock.tryLock(10000))throw new Error('Calendar sync already running');
    try {
      var p=PropertiesService.getScriptProperties();
      if(p.getProperty('TBL_AUTO_SYNC_ENABLED')==='true')throw new Error('Stop automatic sync before baseline');
      if(p.getProperty('TBL_AUTO_SYNC_BASELINED')==='true')throw new Error('Baseline already exists. Do not reset automatically.');
      var c=cfg(), events=eventsInWindow(c),sh=registry(),index=registryIndex(sh);
      if(Object.keys(index).length)throw new Error('Registry already contains records; manual reconciliation required');
      if(!events.length)throw new Error('No booking events found; verify calendar IDs first');
      var now=new Date();
      sh.getRange(2,1,events.length,5).setValues(events.map(function(e){return [e.key,'BASELINE','',now,'PREEXISTING_CALENDAR_EVENT'];}));
      // Store exactly the calendar configuration that this baseline covers.
      p.setProperties({'TBL_AUTO_SYNC_CALENDAR_BINDING':binding(c),'TBL_AUTO_SYNC_BASELINED':'true',
        'TBL_AUTO_SYNC_BASELINED_AT':new Date().toISOString()});
      console.log('Baseline recorded '+events.length+' existing booking events; zero Notion writes.');
      return {baselined:events.length};
    } finally {lock.releaseLock();}
  }
  function createNotionBooking(selected,matching,c) {
    var parsed=parseTitle(selected.event.getTitle());
    var dates=eventDates(selected.event),key=selected.key;
    var properties={};
    properties.Name={title:[{text:{content:parsed.dog}}]};
    properties['🐶 Dog Profile']={relation:[{id:matching.pet.id}]};
    properties['Service Type']={select:{name:parsed.service}};
    // Do not infer approval, payment, fulfillment or actual pickup times from Rover iCal.
    properties['Booking Status']={status:{name:'Inquiry'}};
    properties['Drop-off']={date:{start:dates.kind==='ALL_DAY'?dates.start:dates.startTime}};
    properties['Pick-up']={date:{start:dates.kind==='ALL_DAY'?dates.end:dates.endTime}};
    properties[EVENT_KEY_PROPERTY]={rich_text:[{text:{content:key}}]};
    properties[SOURCE_PROPERTY]={select:{name:selected.source}};
    if(selected.source==='Direct')properties['Rover Reviewed']={select:{name:'N/A'}};
    // One single Notion POST, NO automatic retry for ambiguous 5xx/timeout responses.
    // Next scan first re-queries all Notion event keys to avoid duplicate writes.
    var created=notion('post','/pages',
      {parent:{type:'data_source_id',data_source_id:c.BOOKINGS_DATA_SOURCE_ID},properties:properties},c);
    if(!created.id)throw new Error('Create response uncertain; check Notion before retrying');
    return created;
  }
  function runCalendarAutoSync() {
    var lock=LockService.getScriptLock();
    if(!lock.tryLock(10000))throw new Error('Another calendar sync is running');
    try {
      var p=PropertiesService.getScriptProperties(),c=cfg();
      if(p.getProperty('TBL_AUTO_SYNC_ENABLED')!=='true')throw new Error('Automatic sync is disabled');
      if(p.getProperty('TBL_AUTO_SYNC_BASELINED')!=='true')throw new Error('Missing historical calendar baseline');
      if(p.getProperty('TBL_AUTO_SYNC_CALENDAR_BINDING')!==binding(c))throw new Error('Calendar IDs changed since baseline; stop');
      ensureNotionSchema(c);
      var events=eventsInWindow(c),sh=registry(),index=registryIndex(sh);
      if(!Object.keys(index).length)throw new Error('Missing baseline registry rows');
      var unseen=events.filter(function(e){return !index[e.key]||index[e.key].state==='REVIEW';});
      // Large changes to subscribed calendars should not mass-create bookings.
      if(unseen.length>10)throw new Error('Too many new/review events: manual check required');
      var context={customers:rows(c.CUSTOMERS_DATA_SOURCE_ID,c),pets:rows(c.DOGS_DATA_SOURCE_ID,c),
        bookings:rows(c.BOOKINGS_DATA_SOURCE_ID,c),aliases:verifiedAliases()};
      var created=0,review=0,skipped=0;
      unseen.forEach(function(e){
        if(index[e.key] && index[e.key].state==='BASELINE'){skipped++;return;}
        // Calendar events created before baseline but absent from the moving
        // scan window are historical, not newly booked events.
        var addedAt=e.event.getDateCreated&&e.event.getDateCreated();
        var cutoff=p.getProperty('TBL_AUTO_SYNC_BASELINED_AT');
        if(!index[e.key] && addedAt instanceof Date && !isNaN(addedAt.getTime()) && cutoff &&
          addedAt.getTime()<new Date(cutoff).getTime()) {
          recordRegistry(sh,index,e.key,'BASELINE','', 'PREEXISTING_EVENT_OUTSIDE_BASELINE_WINDOW');
          skipped++;return;
        }
        var ctx={customers:context.customers,pets:context.pets,bookings:context.bookings,
          aliases:context.aliases,calendarId:e.calendarId};
        var checked=evaluate(e.event,ctx,e.source);
        if(checked.action==='EXISTING_REVIEW'||checked.reason==='EXACT_EVENT_KEY_ALREADY_LINKED'){
          recordRegistry(sh,index,e.key,'EXISTING','',checked.reason);skipped++;return;
        }
        if(checked.action!=='CANDIDATE_CREATE'){
          recordRegistry(sh,index,e.key,'REVIEW','',checked.reason);review++;return;
        }
        // Fail closed after two creates in any given scheduled run.
        if(created>=2){recordRegistry(sh,index,e.key,'REVIEW','', 'WRITE_LIMIT_REACHED');review++;return;}
        var parsed=parseTitle(e.event.getTitle());
        var pair=matchProfileWithAliases(parsed,context.customers,context.pets,context.aliases);
        if(pair.state!=='MATCHED'){
          recordRegistry(sh,index,e.key,'REVIEW','',pair.reason);review++;return;
        }
        try {
          // Mark as PENDING before POST so a failed/uncertain response never
          // automatically triggers a second create attempt.
          recordRegistry(sh,index,e.key,'PENDING','', 'NOTION_WRITE_IN_PROGRESS');
          var page=createNotionBooking(e,pair,c);
          recordRegistry(sh,index,e.key,'CREATED',page.id,'CREATED');
          context.bookings.push(page);
          created++;
        } catch(err) {
          recordRegistry(sh,index,e.key,'WRITE_UNCERTAIN','', 'VERIFY_NOTION_BEFORE_RETRY');
          console.error('Calendar create uncertain; requires manual review. No automatic retry.');
        }
      });
      console.log('Calendar auto sync: created='+created+'; review='+review+'; skipped='+skipped+'; historical baseline protected.');
      return {created:created,review:review,skipped:skipped};
    } finally {lock.releaseLock();}
  }
  return {runCalendarDryRun:runCalendarDryRun,runCalendarSafeWriteOnce:runCalendarSafeWriteOnce,
    baselineCalendarBookings:baselineCalendarBookings,runCalendarAutoSync:runCalendarAutoSync,
    parseTitle:parseTitle,source:source,ownerComparison:ownerComparison,eventDates:eventDates};
})();
function calendarDryRun() {return TBLCalendar.runCalendarDryRun();}

/** Manual invocation only. Never attach a time-based/form trigger. */
function calendarSafeWriteOnce() {return TBLCalendar.runCalendarSafeWriteOnce();}

/** Explicit one-time baseline: old events never auto-create a new Notion page. */
function baselineCalendarBookings() {return TBLCalendar.baselineCalendarBookings();}
/** Time-driven handler, safe only after explicit baseline + enable. */
function calendarAutoSync() {return TBLCalendar.runCalendarAutoSync();}
