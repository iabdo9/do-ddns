import { readFile } from 'node:fs/promises';

const IPIFY_URL = 'https://api.ipify.org?format=json';
const DO_API = 'https://api.digitalocean.com/v2';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const DOMAINS_FILE = new URL('./domains.json', import.meta.url);

// Load API key from .env (Node 20.12+ / 24 native loader)
try {
  process.loadEnvFile();
} catch {
  // no .env file — fall back to the existing process environment
}

const API_KEY = process.env.DO_API_KEY;
if (!API_KEY) {
  console.error('Missing DO_API_KEY — add it to .env (see .env.example)');
  process.exit(1);
}

const authHeaders = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

// The last public IP we successfully pushed, re-checked every 5 minutes.
let currentIp = null;

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function loadDomains() {
  const raw = await readFile(DOMAINS_FILE, 'utf8');
  const domains = JSON.parse(raw);
  if (!Array.isArray(domains)) {
    throw new Error('domains.json must be an array of { name, domain }');
  }
  return domains;
}

// 1. Current public IP from ipify.
async function getPublicIp() {
  const res = await fetch(IPIFY_URL);
  if (!res.ok) throw new Error(`ipify responded ${res.status}`);
  const { ip } = await res.json();
  return ip;
}

// 2. Find the A record id for a host on a DO-managed domain.
async function findRecord(domain, name) {
  const fqdn = name === '@' ? domain : `${name}.${domain}`;
  const url = `${DO_API}/domains/${domain}/records?type=A&name=${encodeURIComponent(fqdn)}`;
  const res = await fetch(url, { headers: authHeaders });
  if (!res.ok) throw new Error(`list records for ${domain} -> ${res.status}`);
  const { domain_records } = await res.json();
  return domain_records[0]; // first matching A record, if any
}

// 3. PUT the new IP onto an existing record.
async function updateRecord(domain, recordId, ip) {
  const url = `${DO_API}/domains/${domain}/records/${recordId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ data: ip }),
  });
  if (!res.ok) throw new Error(`update record ${recordId} -> ${res.status}`);
  return res.json();
}

async function syncDomain({ name, domain }, ip) {
  const record = await findRecord(domain, name);
  if (!record) {
    console.warn(`  ! no A record for ${name}.${domain} — skipping`);
    return true; // config issue, retrying won't help
  }
  if (record.data === ip) {
    log(`  = ${name}.${domain} already ${ip}`);
    return true;
  }
  await updateRecord(domain, record.id, ip);
  log(`  ✓ ${name}.${domain} ${record.data} -> ${ip}`);
  return true;
}

async function check() {
  let ip;
  try {
    ip = await getPublicIp();
  } catch (err) {
    log(`could not fetch public IP: ${err.message}`);
    return;
  }

  if (ip === currentIp) {
    log(`IP unchanged (${ip})`);
    return;
  }

  log(`IP changed: ${currentIp ?? 'none'} -> ${ip}`);

  let domains;
  try {
    domains = await loadDomains();
  } catch (err) {
    log(`could not read domains.json: ${err.message}`);
    return;
  }

  let allOk = true;
  for (const entry of domains) {
    try {
      await syncDomain(entry, ip);
    } catch (err) {
      allOk = false;
      console.error(`  ✗ ${entry.name}.${entry.domain}: ${err.message}`);
    }
  }

  // Only advance the stored IP if every domain synced, so failures retry.
  if (allOk) {
    currentIp = ip;
  } else {
    log('some records failed — will retry next cycle');
  }
}

log('DO DDNS service started — checking every 5 minutes');
await check();
setInterval(check, CHECK_INTERVAL_MS);
