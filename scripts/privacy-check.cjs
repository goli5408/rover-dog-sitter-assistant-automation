/** Scan public repository contents for common accidentally copied identifiers. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = new Set(['.gitignore', '.clasp.json.example', '.env.example']);
const excluded = new Set(['node_modules', '.git', 'dist']);
const patterns = [
  ['Notion secret', /\b(?:secret|ntn)_[A-Za-z0-9]{15,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['Google OAuth token', /\bya29\.[0-9A-Za-z_-]{15,}\b/g],
  ['Private Rover iCal URL', /(?:https?:\/\/)?(?:www\.)?rover\.com\/ical\//gi],
  ['Calendar import ID', /[A-Za-z0-9_-]{25,}@(?:import|group)\.calendar\.google\.com/g],
  ['Personal email', /\b[A-Za-z0-9._%+-]+@(?:gmail|yahoo|outlook|icloud|hotmail)\.com\b/gi],
  ['Notion page URL', /https?:\/\/(?:www\.)?(?:app\.)?notion\.com\/p\/[A-Za-z0-9-]{20,}/g],
  ['Google Sheet link', /https?:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/g]
];
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => {
    if (excluded.has(e.name)) return [];
    const p=path.join(dir,e.name);
    return e.isDirectory()?walk(p):[p];
  });
}
const errors=[];
for (const file of walk(root)) {
  const rel=path.relative(root,file);
  if (rel === 'scripts/privacy-check.cjs' || allowed.has(rel) || rel === 'LICENSE') continue;
  const content=fs.readFileSync(file,'utf8');
  for (const [name,regexp] of patterns) {
    regexp.lastIndex=0;
    if (regexp.test(content)) errors.push(`${rel}: potential ${name}`);
  }
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log('Privacy check passed: no common credentials, personal emails, or private connection IDs detected.');
