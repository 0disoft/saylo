import { pathToFileURL } from 'node:url';
import { packageIds } from './release-check.mjs';

// Authentication probe only: no publish, tag changes, credentials on disk or token output.
// Protocol: https://api-docs.npmjs.com/ (OIDC token exchange).
export async function verifyOidc({ env = process.env, request = fetch, log = console.log } = {}) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== '0disoft/saylo' || env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('OIDC verification requires the Saylo main workflow.');
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    throw new Error('GitHub id-token permission is required.');
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== 'https:') throw new Error('GitHub OIDC endpoint must use HTTPS.');
  url.searchParams.set('audience', 'npm:registry.npmjs.org');
  let idToken;
  try {
    const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    idToken = (await response.json()).value;
    if (typeof idToken !== 'string' || !idToken) throw new Error('Missing ID token');
  } catch { throw new Error('GitHub OIDC token request failed.'); }
  for (const id of packageIds) {
    const name = `@0disoft/saylo-${id}`;
    let token;
    let phase = 'request';
    let status;
    try {
      const response = await request(`https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${name.replace('/', '%2f')}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Accept: 'application/json', Authorization: `Bearer ${idToken}` } });
      status = response.status;
      if (!response.ok) throw new Error(`npm OIDC exchange failed for ${name}: HTTP ${response.status}`);
      phase = 'response JSON';
      token = await response.json();
      phase = 'token validation';
      // Match npm CLI's OIDC helper: the token is required; auxiliary fields vary by registry version.
      if (typeof token?.token !== 'string' || !token.token)
        throw new Error(`npm OIDC exchange returned an invalid token for ${name}.`);
    } catch (error) {
      // Never forward response bodies or transport errors that might contain credentials.
      const expected = `npm OIDC exchange failed for ${name}: HTTP `;
      if (error.message.startsWith(expected) && /^\d{3}$/.test(error.message.slice(expected.length))) throw new Error(error.message);
      throw new Error(`npm OIDC exchange failed for ${name} (${phase}${status ? `, HTTP ${status}` : ''}).`);
    }
    token = undefined;
    log(`[oidc] Package-scoped npm token exchange verified: ${name}`);
  }
  log(`[oidc] All ${packageIds.length} Trusted Publishers authenticated; no packages published.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyOidc();
