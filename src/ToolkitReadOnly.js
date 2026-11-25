/**
 * The Barking Lot v3 — private, READ-ONLY Notion adapter.
 * Run inside the existing, private spreadsheet-bound Apps Script project.
 * Never expose this function via doGet/doPost or an unauthenticated web app.
 * Do not log returned records or publish them as JSON on GitHub Pages.
 */
var TBLToolkitRead = (function () {
  'use strict';
  var API_VERSION='2025-09-03';
  var APPROVED_STATUSES={'confirmed':true,'in progress':true,'checked in':true,'active':true};
  function config() {
    var p=PropertiesService.getScriptProperties();
    var keys=['NOTION_TOKEN','DOGS_DATA_SOURCE_ID','BOOKINGS_DATA_SOURCE_ID'];
    var c={};
    keys.forEach(function(k){c[k]=p.getProperty(k);if(!c[k])throw new Error('Missing Script Property: '+k);});
    return c;
  }
  function query(id,c,filter) {
    var out=[],cursor=null;
    do {
      var body={page_size:100};
      if(cursor)body.start_cursor=cursor;
      if(filter)body.filter=filter;
      var res=UrlFetchApp.fetch('https://api.notion.com/v1/data_sources/'+encodeURIComponent(id)+'/query',{
        method:'post',contentType:'application/json',muteHttpExceptions:true,
        headers:{'Authorization':'Bearer '+c.NOTION_TOKEN,'Notion-Version':API_VERSION},
        payload:JSON.stringify(body)
      });
      if(res.getResponseCode()!==200)throw new Error('Notion read failed: '+res.getResponseCode());
      var payload=JSON.parse(res.getContentText());
      out=out.concat(payload.results||[]);
      if(out.length>5000)throw new Error('Too many records; stop and review pagination.');
      cursor=payload.has_more?payload.next_cursor:null;
    }while(cursor);
    return out;
  }
  function textProp(v){
    if(!v)return '';
    var val=v[v.type]||v.title||v.rich_text||[];
    if(Array.isArray(val))return val.map(function(x){return x.plain_text||(x.text&&x.text.content)||'';}).join('');
    return typeof val==='string'?val:'';
  }
  function normId(id){return String(id||'').replace(/-/g,'').toLowerCase();}
  function datePart(s){return String(s||'').slice(0,10);}
  function dateInStay(day,start,end){
    // Notion "Pick-up" is treated as inclusive (care may occur on pickup day).
    return !!start && day>=datePart(start) && (!end||day<=datePart(end));
  }
  function status(p){
    if(!p)return '';
    var v=p.status||p.select;
    return v&&v.name?String(v.name):'';
  }
  function service(p){return p&&p.select&&p.select.name?String(p.select.name):'';}
  function ISOday(value){
    var day=value||Utilities.formatDate(new Date(),'America/Los_Angeles','yyyy-MM-dd');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||isNaN(Date.parse(day+'T12:00:00Z')))throw new Error('Expected yyyy-MM-dd.');
    return day;
  }
  function today(day){
    var date=ISOday(day), c=config();
    var bookings=query(c.BOOKINGS_DATA_SOURCE_ID,c);
    var eligible=bookings.filter(function(b){
      var p=b.properties||{};
      var state=status(p['Booking Status']).trim().toLowerCase();
      if(!APPROVED_STATUSES[state])return false;
      var start=p['Drop-off']&&p['Drop-off'].date&&p['Drop-off'].date.start;
      var end=p['Pick-up']&&p['Pick-up'].date&&p['Pick-up'].date.start;
      return dateInStay(date,start,end);
    });
    if(!eligible.length)return {date:date,pets:[]};
    var dogs=query(c.DOGS_DATA_SOURCE_ID,c);
    var dogMap={};
    dogs.forEach(function(p){dogMap[normId(p.id)]=p;});
    var found=[];
    eligible.forEach(function(b){
      var p=b.properties||{},relation=p['🐶 Dog Profile']&&p['🐶 Dog Profile'].relation||[];
      // Avoid showing unmatched or multi-dog bookings as one confidently identified pet.
      if(relation.length!==1)return;
      var dog=dogMap[normId(relation[0].id)];
      if(!dog)return;
      var petName=textProp((dog.properties||{}).Name);
      if(!petName)return;
      found.push({
        // Minimal fields only. Never return owner name, phone, notes, medication, or tokens.
        bookingId:b.id, petId:dog.id, petName:petName,
        careType:service(p['Service Type'])||'Not recorded',
        stayStart:datePart(p['Drop-off']&&p['Drop-off'].date&&p['Drop-off'].date.start),
        stayEnd:datePart(p['Pick-up']&&p['Pick-up'].date&&p['Pick-up'].date.start),
        date:date
      });
    });
    found.sort(function(a,b){return a.petName.localeCompare(b.petName);});
    return {date:date,pets:found};
  }
  return {today:today};
})();
/**
 * Private manual test: select from Apps Script function menu and inspect the
 * returned object in the debugger. Do NOT console.log customer/pet records.
 */
function toolkitTodayPetsReadOnly(date) {return TBLToolkitRead.today(date);}
