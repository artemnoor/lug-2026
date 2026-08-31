import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../apps/web/public/js/store.js', import.meta.url), 'utf8');
assert.match(source, /CAPTAIN_REQUIRED/);
assert.match(source, /error\.userMessage/);
assert.match(source, /HTTP_429/);
console.log('web-store-errors: ok');
