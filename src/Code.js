/**
 * The Barking Lot — Google Forms → Notion intake synchronization.
 * Bind this Apps Script project to the Google Form *response spreadsheet*.
 * Do not publish customer responses or credentials to source control.
 */
var TBL = (function () {
  'use strict';
  var VERSION = '2025-09-03';
  var LOG_TAB = '_Intake Sync Log';
  var REQUIRED = ["Timestamp", "Dog's name", "Phone number", "Owner's name"];
  // Intake questions map to independent Notion properties; deprecated booking dates are ignored.
  var SCHEMA_VERSION = 'structured-v4';
  var INTAKE_FIELDS = [
    ["What is their usual potty schedule, and do they show any specific signs when they need to go out?", 'Potty Routine'],
    ['How much should I give your paws per meal?', 'Meal Portions'],
    ['Can I give your dog treats', 'Treats Allowed'],
    ['If your paws require any additional feedings beyond breakfast and dinner, please specify the details.', 'Additional Feeding'],
    ['Can your dog be left home alone?', 'Home Alone'],
    ['Are your paws comfortable with a car ride?', 'Car Rides'],
    ['Do your paws enjoy visiting dog parks and socializing with other dogs?', 'Dog Socialization'],
    ['Anything I should be careful about?', 'Safety Notes'],
    ['Does your paws have any allergies, medical conditions, injuries, or physical limitations?', 'Medical & Allergies'],
    ['What will you be bringing with you?', 'Items to Bring'],
    ["Anything else you’re leaving with me?", 'Other Belongings'],
    ['Other', 'Other Care Notes']
  ];
  var COMM_PREF = {'standard':'Standard','more frequent':'More frequent','minimal':'Minimal'};
  function config() {
    var p = PropertiesService.getScriptProperties();
    var token = p.getProperty('NOTION_TOKEN');
    var customerId = p.getProperty('CUSTOMERS_DATA_SOURCE_ID');
    var dogId = p.getProperty('DOGS_DATA_SOURCE_ID');
    if (!token || !customerId || !dogId) throw new Error('Missing NOTION_TOKEN / CUSTOMERS_DATA_SOURCE_ID / DOGS_DATA_SOURCE_ID in Script Properties.');
    return {token: token, customers: customerId, dogs: dogId,
      dryRun: p.getProperty('DRY_RUN') !== 'false',
      sheetName: p.getProperty('FORM_SHEET_NAME') || 'Form Responses 1'};
  }
  function notion(method, path, body, cfg) {
    var url = 'https://api.notion.com/v1' + path;
    var options = {method: method, muteHttpExceptions: true, headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json'
    }};
    if (body !== null && typeof body !== 'undefined') options.payload = JSON.stringify(body);
    for (var attempt = 0; attempt < 4; attempt++) {
      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();
      var raw = response.getContentText();
      if (code >= 200 && code < 300) return JSON.parse(raw);
      if ((code === 429 || code >= 500) && attempt < 3) {
        Utilities.sleep(Math.min(8000, 1000 * Math.pow(2, attempt)));
        continue;
      }
      // Do not log API bodies, which may contain personally identifiable information.
      throw new Error('Notion HTTP ' + code + ' on ' + method + ' ' + path.split('?')[0]);
    }
  }
  function allRows(sourceId, cfg) {
    var result = [], cursor = null;
    do {
      var req = {page_size: 100};
      if (cursor) req.start_cursor = cursor;
      var page = notion('post', '/data_sources/' + sourceId + '/query', req, cfg);
      result = result.concat(page.results || []);
      cursor = page.has_more ? page.next_cursor : null;
      if (result.length > 10000) throw new Error('Too many Notion records; paginate through a dedicated queue.');
    } while (cursor);
    return result;
  }
  function plain(prop) {
    if (!prop) return '';
    var val = prop[prop.type] || prop.title || prop.rich_text || [];
    if (Array.isArray(val)) return val.map(function (x) {return x.plain_text || (x.text && x.text.content) || '';}).join('');
    return val && typeof val === 'object' ? (val.name || '') : String(val || '');
  }
  function normalizeName(s) {
    return String(s || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }
  function normalizePhone(s) {
    var digits = String(s || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    return digits;
  }
  function matchesName(a, b) {return !!normalizeName(a) && normalizeName(a) === normalizeName(b);}
  function relationIds(prop) {return (prop && prop.relation || []).map(function (x) {return x.id;});}
  function findCustomer(customers, ownerName, phone) {
    var pn = normalizePhone(phone), nm = normalizeName(ownerName);
    var hits = customers.filter(function (c) {
      var cp = normalizePhone(plain(c.properties.Phone));
      var cn = normalizeName(plain(c.properties.Name));
      return (pn && cp && pn === cp) || (nm && cn && nm === cn);
    });
    if (hits.length > 1) return {review: 'Multiple possible customer records'};
    if (!hits.length) return {record: null};
    var rec = hits[0], storedPhone = normalizePhone(plain(rec.properties.Phone));
    var storedName = normalizeName(plain(rec.properties.Name));
    if (pn && storedPhone && pn !== storedPhone) return {review: 'Customer phone conflict'};
    if (nm && storedName && nm !== storedName) return {review: 'Customer name conflict'};
    return {record: rec};
  }
  // A blank phone can be filled only when the named Customer and their existing
  // linked Pet are an unambiguous match. A same-name Customer alone is insufficient.
  function phoneUpdateDecision(customers, customer, matchedPet, ownerName, incomingPhone) {
    if (!customer) return {update:false}; // New Customers receive Phone on creation.
    var current = normalizePhone(plain(customer.properties.Phone));
    var incoming = normalizePhone(incomingPhone);
    if (!/^\d{10}$/.test(incoming)) return {review:'Invalid submitted phone'};
    if (current) {
      if (current !== incoming) return {review:'Customer phone conflict'};
      return {update:false};
    }
    if (!matchesName(plain(customer.properties.Name),ownerName) ||
        !matchedPet || relationIds(matchedPet.properties['Dog Parent(s)']).indexOf(customer.id) === -1)
      return {review:'Unverified customer identity for missing phone'};
    var otherOwnerUsesPhone = customers.some(function (c) {
      return c.id !== customer.id && normalizePhone(plain(c.properties.Phone)) === incoming;
    });
    if (otherOwnerUsesPhone) return {review:'Submitted phone belongs to another customer'};
    return {update:true,phone:incoming};
  }
  function findPet(pets, customer, petName) {
    var nameMatches = pets.filter(function (p) {return matchesName(plain(p.properties.Name), petName);});
    if (!customer) {
      // Avoid creating a duplicate for an existing dog, even if the customer record is missing.
      if (nameMatches.length) return {review:'Pet with this name already exists; customer relationship needs review'};
      return {record:null};
    }
    var own = nameMatches.filter(function (p) {return relationIds(p.properties['Dog Parent(s)']).indexOf(customer.id) !== -1;});
    if (own.length > 1) return {review:'Duplicate pet records for this customer'};
    if (own.length === 1) return {record:own[0]};
    if (nameMatches.length) return {review:'A pet with the same name belongs to another or unlinked customer'};
    return {record:null};
  }
  function formMap(sheet, rowNumber) {
    var width = sheet.getLastColumn();
    var headers = sheet.getRange(1,1,1,width).getDisplayValues()[0];
    var values = sheet.getRange(rowNumber,1,1,width).getDisplayValues()[0];
    var valuesByHeader = {};
    headers.forEach(function (h,i) {if (h) valuesByHeader[h.trim()] = values[i] || '';});
    REQUIRED.forEach(function (h) {if (!headers.includes(h)) throw new Error('Missing form question: ' + h);});
    return valuesByHeader;
  }
  function structuredCare(form) {
    var props = {};
    INTAKE_FIELDS.forEach(function (mapping) {
      var answer = String(form[mapping[0]] || '').trim();
      // Empty answers must NOT erase previously verified care instructions.
      if (answer) props[mapping[1]] = textProp(answer);
    });
    return props;
  }
  function customerPreference(form) {
    var value = String(form['Communication Style'] || '').trim().toLowerCase();
    return COMM_PREF[value] || '';
  }
  function careConflicts(existing, careProps) {
    var fields = Object.keys(careProps);
    return fields.filter(function (name) {
      var prior = plain(existing.properties[name]).trim();
      var incoming = plain(careProps[name]).trim();
      return prior && prior !== incoming;
    });
  }
  function richText(content) {
    var out = [], limit = 1800;
    // Notion rich text individual text objects must be <= 2000 characters.
    for (var i = 0; i < content.length; i += limit)
      out.push({type:'text', text:{content:content.slice(i,i+limit)}});
    if (!out.length) out.push({type:'text',text:{content:'Not recorded'}});
    if (out.length > 100) throw new Error('Questionnaire exceeds Notion rich text limit');
    return out;
  }
  function title(value) {return {title:richText(value)};}
  function textProp(value) {return {rich_text:richText(value)};}
  function createCustomer(name, phone, preference, cfg) {
    var props = {Name:title(name), Phone:{phone_number:phone}};
    if (preference) props['Communication Preference'] = {select:{name:preference}};
    return notion('post', '/pages', {parent:{type:'data_source_id', data_source_id:cfg.customers},
      properties:props}, cfg);
  }
  function createPet(name, customerId, careProps, cfg) {
    var properties = Object.assign({Name:title(name),'Dog Parent(s)':{relation:[{id:customerId}]},
      'Intake Status':{select:{name:'Completed'}}},careProps);
    return notion('post','/pages',{parent:{type:'data_source_id',data_source_id:cfg.dogs}, properties:properties},cfg);
  }
  function updatePet(id, careProps, cfg) {
    var properties = Object.assign({'Intake Status':{select:{name:'Completed'}}},careProps);
    return notion('patch','/pages/' + id,{properties:properties},cfg);
  }
  function updateCustomerDetails(id, phone, preference, cfg) {
    var properties = {};
    if (phone) properties.Phone = {phone_number:phone};
    if (preference) properties['Communication Preference'] = {select:{name:preference}};
    if (!Object.keys(properties).length) return null;
    return notion('patch','/pages/' + id,{properties:properties},cfg);
  }
  function statusPet(id, name, cfg) {
    return notion('patch','/pages/' + id,{properties:{'Intake Status':{select:{name:name}}}},cfg);
  }
  function fingerprint(s) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
    return bytes.map(function (b) {return ('0' + (b & 255).toString(16)).slice(-2);}).join('');
  }
  function logSheet(ss) {
    var sh = ss.getSheetByName(LOG_TAB);
    if (!sh) {
      sh = ss.insertSheet(LOG_TAB);
      sh.getRange(1,1,1,7).setValues([['Response key','Sheet row','State','Reason (no PII)','Updated at','Notion pet page ID','Schema version']]);
      sh.setFrozenRows(1);
      sh.hideSheet();
    }
    if (!sh.getRange(1,7).getValue()) sh.getRange(1,7).setValue('Schema version');
    return sh;
  }
  function ledgerEntry(sh, key) {
    var rows = sh.getLastRow() - 1;
    if (!rows) return null;
    var cells = sh.getRange(2,1,rows,7).getValues();
    for (var i = 0; i < cells.length; i++) if (cells[i][0] === key) return {row:i+2,state:cells[i][2],version:cells[i][6]};
    return null;
  }
  function writeLedger(sh, key, row, state, reason, petId) {
    var existing = ledgerEntry(sh,key);
    var dest = existing ? existing.row : sh.getLastRow()+1;
    sh.getRange(dest,1,1,7).setValues([[key,row,state,reason || '',new Date(),petId || '',SCHEMA_VERSION]]);
  }
  function processRow(rowNumber, opts) {
    opts = opts || {};
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('Could not acquire synchronization lock');
    try {
      var cfg = config();
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(cfg.sheetName);
      if (!sh) throw new Error('Form response sheet not found');
      if (!rowNumber || rowNumber < 2 || rowNumber > sh.getLastRow()) throw new Error('Invalid response row');
      var form = formMap(sh,rowNumber);
      var key = fingerprint(ss.getId()+'|'+sh.getSheetId()+'|'+rowNumber+'|'+form.Timestamp);
      var ledger = logSheet(ss);
      var previous = ledgerEntry(ledger,key);
      if (previous && previous.state === 'COMPLETED' && previous.version === SCHEMA_VERSION) return {state:'SKIPPED',reason:'Already processed'};
      var owner = String(form["Owner's name"] || '').trim();
      var pet = String(form["Dog's name"] || '').trim();
      var phone = String(form['Phone number'] || '').trim();
      if (!owner || !pet || normalizePhone(phone).length < 10) {
        writeLedger(ledger,key,rowNumber,'NEEDS_REVIEW','Missing owner / pet / valid phone');
        return {state:'NEEDS_REVIEW',reason:'Incomplete identifying information'};
      }
      var customers = allRows(cfg.customers,cfg);
      var pets = allRows(cfg.dogs,cfg);
      var ownerMatch = findCustomer(customers,owner,phone);
      if (ownerMatch.review) {
        writeLedger(ledger,key,rowNumber,'NEEDS_REVIEW',ownerMatch.review);
        return {state:'NEEDS_REVIEW',reason:ownerMatch.review};
      }
      var petMatch = findPet(pets,ownerMatch.record,pet);
      if (petMatch.review) {
        writeLedger(ledger,key,rowNumber,'NEEDS_REVIEW',petMatch.review);
        return {state:'NEEDS_REVIEW',reason:petMatch.review};
      }
      var careProps = structuredCare(form);
      var pref = customerPreference(form);
      var existing = petMatch.record;
      var phonePlan = phoneUpdateDecision(customers,ownerMatch.record,existing,owner,phone);
      if (phonePlan.review) {
        writeLedger(ledger,key,rowNumber,'NEEDS_REVIEW',phonePlan.review,existing ? existing.id : '');
        return {state:'NEEDS_REVIEW',reason:phonePlan.review};
      }
      // One-off test cannot create customer/pet, and cannot target a different pet.
      if (opts.existingPetOnly) {
        if (!existing || !ownerMatch.record || !opts.expectedPetId || existing.id.replace(/-/g, '').toLowerCase() !== opts.expectedPetId)
          throw new Error('TEST_WRITE_BLOCKED: response does not match the approved existing pet ID');
      }
      var conflicts = existing ? careConflicts(existing, careProps) : [];
      var storedPref = ownerMatch.record ? plain(ownerMatch.record.properties['Communication Preference']).trim() : '';
      if (pref && storedPref && pref !== storedPref) conflicts.push('Communication Preference');
      if (conflicts.length) {
        // Record just the field names, never the sensitive form answers.
        if (!cfg.dryRun && !opts.existingPetOnly && existing) statusPet(existing.id,'Needs Review',cfg);
        writeLedger(ledger,key,rowNumber,cfg.dryRun?'DRY_RUN':'NEEDS_REVIEW',
          'Conflicting fields: '+conflicts.join(', '),existing ? existing.id : '');
        return {state:cfg.dryRun?'DRY_RUN':'NEEDS_REVIEW',reason:'Existing structured information differs'};
      }
      // One-off testing is deliberately pet-only: no changes to Customers.
      // An owner phone fill must wait for a separately reviewed normal sync.
      if (opts.existingPetOnly && phonePlan.update) {
        writeLedger(ledger,key,rowNumber,'NEEDS_REVIEW','Customer phone update requires normal sync',existing ? existing.id : '');
        return {state:'NEEDS_REVIEW',reason:'Customer phone update requires normal sync'};
      }
      if (cfg.dryRun) {
        writeLedger(ledger,key,rowNumber,'DRY_RUN',
          phonePlan.update ? 'Validated intake; existing customer phone would be filled; no Notion writes' :
          'Validated structured intake; no Notion writes',existing ? existing.id : '');
        return {state:'DRY_RUN',operation:existing?'update':'create',customer:ownerMatch.record?'existing':'new',phoneAction:phonePlan.update?'fill':'none'};
      }
      var customer = ownerMatch.record || createCustomer(owner,phone,pref,cfg);
      var petResult = existing ? updatePet(existing.id,careProps,cfg) : createPet(pet,customer.id,careProps,cfg);
      // Apply safe phone fill and communication preference to Customers in one PATCH.
      // Keep already-recorded nonblank phones unchanged.
      if (ownerMatch.record && (phonePlan.update || (pref && !storedPref)))
        updateCustomerDetails(customer.id,phonePlan.update?phonePlan.phone:null,pref && !storedPref?pref:null,cfg);
      writeLedger(ledger,key,rowNumber,'COMPLETED',phonePlan.update ?
        'Structured intake synchronized; verified blank customer phone filled' :
        'Structured intake synchronized',petResult.id);
      return {state:'COMPLETED',operation:existing?'update':'create',phoneAction:phonePlan.update?'filled':'none'};
    } finally {lock.releaseLock();}
  }
  function onFormSubmit(e) {
    if (!e || !e.range) throw new Error('Use an installable spreadsheet On form submit trigger.');
    if (e.range.getSheet().getName() !== config().sheetName) return;
    try {return processRow(e.range.getRow());}
    catch(err) {console.error('Intake sync failed; inspect execution and retry. Error: '+String(err.message||err));throw err;}
  }
  function dryRunLatest() {
    var cfg=config();
    var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.sheetName);
    if (!cfg.dryRun) throw new Error('Set DRY_RUN=true before running dryRunLatest');
    return processRow(sh.getLastRow());
  }
  // Deliberate ONE-TIME write test of the latest response to an ALREADY EXISTING pet.
  // Requires explicit Script Properties; never creates a customer or pet. Not a trigger.
  function testWriteLatest() {
    var cfg = config();
    if (cfg.dryRun) throw new Error('Set DRY_RUN=false ONLY after validating the latest response.');
    var props = PropertiesService.getScriptProperties();
    var expected = String(props.getProperty('TEST_WRITE_PET_ID') || '').trim().replace(/-/g, '').toLowerCase();
    var confirm = props.getProperty('TEST_WRITE_CONFIRM');
    if (!/^[a-f0-9]{32}$/.test(expected) || confirm !== 'WRITE_LATEST_INTAKE_ONCE')
      throw new Error('TEST_WRITE_BLOCKED: set TEST_WRITE_PET_ID and TEST_WRITE_CONFIRM in Script Properties.');
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.sheetName);
    if (!sh || sh.getLastRow() < 2) throw new Error('No form responses to test');
    // Consume the approval before attempting any Notion write; prevents accidental repeats.
    props.deleteProperty('TEST_WRITE_CONFIRM');
    var result = processRow(sh.getLastRow(), {existingPetOnly:true, expectedPetId:expected});
    console.log('testWriteLatest outcome: ' + result.state + ' (no personal data logged)');
    return result;
  }
  function retryPending() {
    var cfg=config(),ss=SpreadsheetApp.getActiveSpreadsheet();
    var sh=ss.getSheetByName(cfg.sheetName);
    var ledger=logSheet(ss), count=0;
    // Max 10 rows/run to stay within Google Apps Script execution limits.
    for (var row=2;row<=sh.getLastRow()&&count<10;row++) {
      var f=formMap(sh,row);
      var key=fingerprint(ss.getId()+'|'+sh.getSheetId()+'|'+row+'|'+f.Timestamp);
      var prev=ledgerEntry(ledger,key);
      if (!prev || prev.state==='DRY_RUN') {processRow(row);count++;}
    }
    return count;
  }
  function installTrigger() {
    var cfg=config();
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    // Do not duplicate triggers.
    var triggers=ScriptApp.getProjectTriggers();
    var exists=triggers.some(function(t){return t.getHandlerFunction()==='onFormSubmit';});
    if(!exists) ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
    logSheet(ss);
    return 'Trigger ready. DRY_RUN='+cfg.dryRun;
  }
  function testConnection() {
    var cfg=config();
    var c=notion('get','/data_sources/'+cfg.customers,null,cfg);
    var d=notion('get','/data_sources/'+cfg.dogs,null,cfg);
    ['Name','Phone','Communication Preference'].forEach(function(k){if(!c.properties[k])throw new Error('Customer schema missing '+k);});
    ['Name','Dog Parent(s)','Intake Status'].concat(INTAKE_FIELDS.map(function (x) {return x[1];})).forEach(function(k){if(!d.properties[k])throw new Error('Pet schema missing '+k);});
    return 'Connection and schema OK. DRY_RUN='+cfg.dryRun;
  }
  return {onFormSubmit:onFormSubmit, dryRunLatest:dryRunLatest,testWriteLatest:testWriteLatest,retryPending:retryPending,
    installTrigger:installTrigger,testConnection:testConnection,
    _test:{findCustomer:findCustomer,findPet:findPet,normalizeName:normalizeName,
      normalizePhone:normalizePhone,structuredCare:structuredCare,careConflicts:careConflicts,customerPreference:customerPreference,richText:richText,phoneUpdateDecision:phoneUpdateDecision}};
})();

// Apps Script menu-visible handlers must be top-level functions.
function onFormSubmit(e) {return TBL.onFormSubmit(e);}
function dryRunLatest() {return TBL.dryRunLatest();}
function testWriteLatest() {return TBL.testWriteLatest();}
function retryPending() {return TBL.retryPending();}
function installTrigger() {return TBL.installTrigger();}
function testConnection() {return TBL.testConnection();}
