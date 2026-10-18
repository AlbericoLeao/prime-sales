import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const service = readFileSync('app/firebase-service.js', 'utf8');
const app = readFileSync('app/app.js', 'utf8');
const functions = readFileSync('functions/index.js', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');
const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')).hosting;

test('operational browser service does not expose Firebase self-signup helpers', () => {
  assert.doesNotMatch(service, /createUserWithEmailAndPassword|createSecondaryUser|deleteApp/);
});

test('new seller provisioning uses an admin-checked callable function', () => {
  assert.match(app, /callFunction\('createSeller',\s*\{\s*nome,\s*email\s*\}\)/);
  assert.match(functions, /exports\.createSeller\s*=\s*onCall/);
  assert.match(functions, /const adminEmail = requireAdmin\(request\)/);
  assert.match(functions, /request\.auth\.token\.email_verified !== true/);
  assert.match(rules, /request\.auth\.token\.email_verified == true/);
  assert.match(functions, /generatePasswordResetLink\(email\)/);
});

test('legacy standalone Prime Sales and test HTML pages are excluded from Firebase Hosting', () => {
  assert.ok(hosting.ignore.includes('**/prime-sales*.html'));
  assert.ok(hosting.ignore.includes('**/teste-*.html'));
  assert.ok(hosting.ignore.includes('**/admin-panel.html'));
});

test('retired standalone HTML versions no longer expose old signup screens', () => {
  const legacyPages = readdirSync('.').filter(name =>
    name.endsWith('.html') && (/^prime-sales/i.test(name) || /^teste-/i.test(name) || /^admin-panel/i.test(name))
  );
  assert.ok(legacyPages.length > 0, 'expected to find legacy HTML versions');
  for (const file of legacyPages) {
    const html = readFileSync(file, 'utf8');
    assert.match(html, /Esta versão antiga do Prime Sales foi desativada/, file + ' must redirect to index.html');
    assert.doesNotMatch(html, /createUserWithEmailAndPassword/, file + ' must not contain Firebase self-signup code');
  }
});
