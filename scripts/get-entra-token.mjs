// DEV-25: obtain a real Entra access token for a test user via the OAuth2 device code
// flow, then decode and print the role claims. No dependency: uses Node 22 fetch.
//
// Run it so the tenant and client ids come from the root .env at runtime (this script
// never reads secrets itself):
//
//   node --env-file=.env scripts/get-entra-token.mjs --role admin
//
// Sign in as the test user for that role when prompted. The script prints the access
// token's roles, aud, oid, and upn so you can confirm the App Role claim end-to-end.
// Add --call <baseUrl> to hit core-api and print the status per endpoint, for example:
//
//   node --env-file=.env scripts/get-entra-token.mjs --role admin --call https://mat-inspect.staging

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const tenantId = process.env.ENTRA_TENANT_ID;
const clientId = process.env.ENTRA_CLIENT_ID;
const role = args.get('role') ?? '(unspecified)';
const callBase = args.get('call');

if (!tenantId || !clientId) {
  console.error('ENTRA_TENANT_ID and ENTRA_CLIENT_ID must be set (run with --env-file=.env).');
  process.exit(1);
}

const authority = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;
const scope = `api://${clientId}/access_as_user openid profile offline_access`;

const decodeJwt = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Step 1: request a device code.
const deviceRes = await fetch(`${authority}/devicecode`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, scope }),
});
const device = await deviceRes.json();
if (!deviceRes.ok) {
  console.error('Device code request failed:', device.error, device.error_description);
  process.exit(1);
}

console.log(`\nSign in as the ${role} test user:`);
console.log(`  1. Open ${device.verification_uri}`);
console.log(`  2. Enter code: ${device.user_code}\n`);
console.log('Waiting for sign-in...');

// Step 2: poll the token endpoint until the user completes sign-in.
let token;
const deadline = Date.now() + device.expires_in * 1000;
let interval = device.interval ?? 5;
while (Date.now() < deadline) {
  await sleep(interval * 1000);
  const tokenRes = await fetch(`${authority}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: device.device_code,
    }),
  });
  const body = await tokenRes.json();
  if (tokenRes.ok) {
    token = body.access_token;
    break;
  }
  if (body.error === 'authorization_pending') continue;
  if (body.error === 'slow_down') {
    interval += 5;
    continue;
  }
  console.error('Token request failed:', body.error, body.error_description);
  process.exit(1);
}

if (!token) {
  console.error('Timed out waiting for sign-in.');
  process.exit(1);
}

const claims = decodeJwt(token);
console.log('\nAccess token acquired.');
console.log('  roles:', JSON.stringify(claims.roles ?? null));
// Accept both audience shapes: the bare client id (v2 access tokens) and the
// api://{clientId} App ID URI (v1 style). Either is the correct audience for this API.
const audMatches = claims.aud === clientId || claims.aud === `api://${clientId}`;
console.log('  aud:  ', claims.aud, audMatches ? '(matches client id)' : '(MISMATCH)');
console.log('  iss:  ', claims.iss);
console.log('  oid:  ', claims.oid);
console.log('  upn:  ', claims.upn ?? claims.preferred_username);
console.log('  exp:  ', new Date(claims.exp * 1000).toISOString());

// Optional: exercise core-api with the real token to show allow/deny per role.
if (callBase) {
  // A valid body so Fastify schema validation passes and the requireRole preHandler
  // actually runs. Validation runs before preHandler, so an invalid body returns 400
  // before the role check and would mask allow/deny.
  const validChecklist = {
    equipmentType: 'FORKLIFT',
    items: [
      {
        key: 'forks-condition',
        prompt: 'Forks free of cracks',
        type: 'BOOLEAN',
        required: true,
        failSeverity: 'BLOCKING',
      },
    ],
  };
  const endpoints = [
    ['GET', '/api/v1/equipment'], // requireRole('operator')
    ['POST', '/api/v1/checklists'], // requireRole('admin')
  ];
  console.log(`\nCalling core-api at ${callBase}:`);
  for (const [method, path] of endpoints) {
    const res = await fetch(`${callBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(method === 'POST' && { body: JSON.stringify(validChecklist) }),
    });
    // 401/403 are decided in auth before the handler. 400 means validation rejected the
    // body before the role check ran, so it is not an allow/deny signal. Anything else
    // (2xx, or a 5xx from the handler) means the request got past authz.
    const verdict =
      res.status === 403
        ? 'DENY'
        : res.status === 401
          ? 'UNAUTH'
          : res.status === 400
            ? 'BADREQ (role check not reached)'
            : 'ALLOW';
    console.log(`  ${method} ${path} -> ${res.status} ${verdict}`);
  }
}

console.log('\nFull token (for manual curl):\n' + token + '\n');
