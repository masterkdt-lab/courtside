#!/usr/bin/env node
// Copies the service-account key from a downloaded Google JSON key file into .env without
// printing it. Usage:  node scripts/set-private-key.js ~/Downloads/<project>-<id>.json
// Sets GOOGLE_PRIVATE_KEY (one line, literal \n sequences, double-quoted) and
// GOOGLE_SERVICE_ACCOUNT_EMAIL. Everything else in .env is left as is.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/set-private-key.js <service-account-key.json>');
  process.exit(1);
}
const jsonPath = resolve(arg.replace(/^~(?=$|\/)/, process.env.HOME || '~'));
if (!existsSync(jsonPath)) {
  console.error(`No such file: ${jsonPath}`);
  process.exit(1);
}
let sa;
try {
  sa = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch {
  console.error('That file is not valid JSON.');
  process.exit(1);
}
if (typeof sa.private_key !== 'string' || typeof sa.client_email !== 'string') {
  console.error('That file does not look like a service-account key (no private_key / client_email).');
  process.exit(1);
}

const envPath = resolve(process.cwd(), '.env');
if (!existsSync(envPath)) {
  console.error('.env not found in the current folder. Copy .env.example to .env first.');
  process.exit(1);
}

// JSON.parse turned the \n escapes into real newlines; put them back so the value is one line.
const keyOneLine = sa.private_key.replace(/\r?\n/g, '\\n');
let env = readFileSync(envPath, 'utf8');
function setLine(name, value) {
  const re = new RegExp(`^${name}=.*$`, 'm');
  const line = `${name}="${value}"`;
  env = re.test(env) ? env.replace(re, () => line) : `${env.replace(/\n?$/, '\n')}${line}\n`;
}
setLine('GOOGLE_PRIVATE_KEY', keyOneLine);
setLine('GOOGLE_SERVICE_ACCOUNT_EMAIL', sa.client_email);
writeFileSync(envPath, env);

const markers = keyOneLine.startsWith('-----BEGIN PRIVATE KEY-----\\n') && keyOneLine.endsWith('-----END PRIVATE KEY-----\\n');
console.log(`Updated .env for ${sa.client_email}`);
console.log(`GOOGLE_PRIVATE_KEY written: ${keyOneLine.length} characters, PEM markers ${markers ? 'present' : 'MISSING'}. The key itself is not printed.`);
