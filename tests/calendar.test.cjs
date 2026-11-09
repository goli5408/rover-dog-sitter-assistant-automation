const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixtures = require('./fixtures/sample-data.json');
const script = fs.readFileSync(path.join(__dirname, '../src/CalendarSync.js'), 'utf8');
function load() {
  const context = {console};
  vm.createContext(context);
  vm.runInContext(script, context);
  return context.TBLCalendar;
}
const app = load();
const js = (v) => JSON.parse(JSON.stringify(v));
test('fictional fixture contains no live customer records', () => {
  assert.equal(fixtures.customers.length, 2);
  assert.ok(fixtures.calendarEvents.every(e => /^fictional-event-/.test(e.id)));
});
test('parses Rover boarding calendar title', () => {
  const parsed = app.parseTitle(fixtures.calendarEvents[0].title);
  assert.equal(parsed.dog, 'Maple');
  assert.equal(parsed.owner, 'Alex Rivera');
  assert.equal(parsed.service, 'Boarding');
  assert.equal(parsed.isRequest, false);
});
test('parses Direct daycare title', () => {
  const parsed = app.parseTitle(fixtures.calendarEvents[1].title);
  assert.equal(parsed.service, 'Daycare');
});
test('request is recognized and not considered confirmed', () => {
  assert.equal(app.parseTitle(fixtures.calendarEvents[2].title).isRequest, true);
});
test('rejects unrelated personal calendar events', () => {
  assert.equal(app.parseTitle('Dentist appointment').error, 'TITLE_FORMAT');
});
test('detects explicit Direct event source', () => {
  assert.equal(app.source(fixtures.calendarEvents[1].description).source, 'Direct');
});
test('identifies Rover link without exposing real URLs', () => {
  assert.equal(app.source('Visit https://www.rover.com/example').source, 'Rover');
});
test('conflicting source labels require review', () => {
  assert.equal(app.source('https://www.rover.com/example\nSource: Direct').reason, 'SOURCE_CONFLICT');
});
test('owner surname initial is weak, not exact', () => {
  assert.equal(app.ownerComparison('Alex R.', 'Alex Rivera'), 'weak');
});
test('does not confuse distinct full customer names', () => {
  assert.equal(app.ownerComparison('Alex Rivera', 'Jordan Lane'), 'none');
});
test('all-day UTC date boundaries preserve calendar dates', () => {
  const fake = {isAllDayEvent:()=>true,getAllDayStartDate:()=>new Date('2027-03-10T00:00:00Z'),getAllDayEndDate:()=>new Date('2027-03-13T00:00:00Z')};
  const util = {formatDate:(date,tz,pattern)=>{assert.equal(tz,'UTC');return date.toISOString().slice(0,10);}};
  const context = {console,Utilities:util}; vm.createContext(context);vm.runInContext(script,context);
  const result = js(context.TBLCalendar.eventDates(fake));
  assert.deepEqual(result,{kind:'ALL_DAY',start:'2027-03-10',end:'2027-03-12',startTime:'',endTime:'',endExclusive:'2027-03-13'});
});
