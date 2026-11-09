const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const name of ['Code', 'CalendarSync', 'CalendarTriggerMonitor', 'CalendarTriggerAuto']) {
  fs.copyFileSync(path.join(root, 'src', `${name}.js`), path.join(out, `${name}.js`));
}
fs.copyFileSync(path.join(root, 'appsscript.json'), path.join(out, 'appsscript.json'));
console.log('Created dist/ with Apps Script source and manifest.');
