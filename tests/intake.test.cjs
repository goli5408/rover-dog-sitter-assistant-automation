const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/../src/Code.js','utf8');
const context = {console};
vm.createContext(context);
vm.runInContext(source,context);
const m = context.TBL._test;
const customer = (id,name,phone) => ({id,properties:{Name:{type:'title',title:[{plain_text:name}]},Phone:{type:'phone_number',phone_number:phone}}});
const pet = (id,name,parents) => ({id,properties:{Name:{type:'title',title:[{plain_text:name}]},'Dog Parent(s)':{relation:parents.map(id=>({id}))}}});
test('normalizes US phone and name',()=>{
 assert.equal(m.normalizePhone('+1 (415) 555-1212'),'4155551212');
 assert.equal(m.normalizeName('  Alex   Rivera '),'alex rivera');
});
test('matches unique existing customer',()=>{
 let c=customer('one','Alex Rivera','415-555-1212');
 assert.equal(m.findCustomer([c],'alex rivera','(415) 555-1212').record.id,'one');
});
test('refuses name/phone disagreement',()=>{
 let c=customer('one','Alex Rivera','415-555-1212');
 assert.match(m.findCustomer([c],'Someone Else','415-555-1212').review,/name conflict/);
 assert.match(m.findCustomer([c],'Alex Rivera','650-555-0101').review,/phone conflict/);
});
test('refuses multiple customers',()=>{
 let rows=[customer('one','Alex','4155551212'),customer('two','Alex','6505551000')];
 assert.match(m.findCustomer(rows,'Alex','4155551212').review,/Multiple/);
});
test('matches dog only within owner relation',()=>{
 let c=customer('one','Alex','4155551212');
 assert.equal(m.findPet([pet('d1','Maple',['one'])],c,'maple').record.id,'d1');
 assert.match(m.findPet([pet('d2','Maple',['two'])],c,'maple').review,/another/);
});
test('rich text splits to Notion per-object character limit',()=>{
 const parts=m.richText('x'.repeat(3700));
 assert.equal(parts.length,3);
 assert.ok(parts.every(x=>x.text.content.length<=2000));
});
test('maps questions to separate Notion properties',()=>{
 const props=m.structuredCare({
  "What is their usual potty schedule, and do they show any specific signs when they need to go out?":'Every 4 hours',
  'How much should I give your paws per meal?':'1 cup',
  'Can I give your dog treats':'Yes',
  'Drop-off date':'2026-11-08',
  'Pick-up date':'2026-11-10'
 });
 assert.equal(props['Potty Routine'].rich_text[0].text.content,'Every 4 hours');
 assert.equal(props['Meal Portions'].rich_text[0].text.content,'1 cup');
 assert.equal(props['Treats Allowed'].rich_text[0].text.content,'Yes');
 assert.equal(Object.keys(props).length,3);
 assert.equal(JSON.stringify(props).includes('2026-11'),false);
 assert.equal(props['Care Instructions'],undefined);
});
test('empty answers are omitted, never overwrite verified values',()=>{
 const props=m.structuredCare({'How much should I give your paws per meal?':'   '});
 assert.equal(Object.keys(props).length,0);
});
test('reports conflicting structured values by property name',()=>{
 const existing={properties:{'Meal Portions':{type:'rich_text',rich_text:[{plain_text:'1 cup'}]}}};
 const changed={'Meal Portions':{rich_text:[{type:'text',text:{content:'2 cups'}}]}};
 assert.deepEqual(Array.from(m.careConflicts(existing,changed)),['Meal Portions']);
});
test('communication preference maps to Customer select, not pet',()=>{
 assert.equal(m.customerPreference({'Communication Style':'Minimal'}),'Minimal');
 assert.equal(m.customerPreference({'Communication Style':'Random option'}),'');
});

test('new customer gets phone during creation; no existing-owner phone patch',()=>{
 assert.equal(m.phoneUpdateDecision([],null,null,'New Owner','4155551212').update,false);
});
test('existing owner missing phone is safe to fill only with matching linked pet',()=>{
 const c=customer('c1','Alex Smith',null);
 const p=pet('pet1','Maple',['c1']);
 const match=m.findCustomer([c],'Alex Smith','4155551212');
 assert.equal(match.record.id,'c1');
 assert.equal(m.phoneUpdateDecision([c],c,p,'Alex Smith','+1 (415) 555-1212').update,true);
});
test('existing owner with same phone requires no update',()=>{
 const c=customer('c1','Alex Smith','4155551212');
 const p=pet('pet1','Maple',['c1']);
 assert.equal(m.phoneUpdateDecision([c],c,p,'Alex Smith','4155551212').update,false);
});
test('existing phone conflict is flagged and never overwritten',()=>{
 const c=customer('c1','Alex Smith','4155551212');
 const p=pet('pet1','Maple',['c1']);
 assert.match(m.phoneUpdateDecision([c],c,p,'Alex Smith','6505550000').review,/phone conflict/);
 assert.match(m.findCustomer([c],'Alex Smith','6505550000').review,/phone conflict/);
});
test('matching owner name alone never authorizes missing phone update',()=>{
 const c=customer('c1','Alex Smith',null);
 assert.match(m.phoneUpdateDecision([c],c,null,'Alex Smith','4155551212').review,/Unverified/);
 assert.match(m.phoneUpdateDecision([c],c,pet('p2','Maple',['c2']),'Alex Smith','4155551212').review,/Unverified/);
});
test('cannot fill missing phone if another customer already uses it',()=>{
 const c=customer('c1','Alex Smith',null);
 const other=customer('c2','Other Owner','4155551212');
 const p=pet('p1','Maple',['c1']);
 assert.match(m.phoneUpdateDecision([c,other],c,p,'Alex Smith','4155551212').review,/another customer/);
 assert.match(m.findCustomer([c,other],'Alex Smith','4155551212').review,/Multiple/);
});
test('ambiguous duplicate customer names remain blocked',()=>{
 const c1=customer('c1','Alex Smith',null),c2=customer('c2','Alex Smith',null);
 assert.match(m.findCustomer([c1,c2],'Alex Smith','4155551212').review,/Multiple/);
});
