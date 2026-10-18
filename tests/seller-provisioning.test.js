const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

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
