# SC userscripts

## Payroll import (0.1.5)

The public payroll script contains no shared Tools partner key. Each operator connects their own browser once. Access is limited to saved payroll exports and stays valid until revoked, across the stores/weeks that operator may access.

1. Update **SC Load Payroll (Native)** to `payroll.script.js` 0.1.5. Preserve its name/namespace so Tampermonkey updates the existing installation; accept the script's storage/menu/tab grants.
2. In Patriot, click **Connect Tools**. Sign into the Tools tab if needed. Check your account and the matching connection code, name the browser and click **Allow connection**.
3. The script saves access automatically and returns to Patriot. Click **Load Payroll** and choose a saved week. Regular imports need no further login, token creation or pasting.
4. View/revoke your browsers in **Tools user menu → Authorizations**. Administrators with `perm:manage` can view/revoke everyone's access under **User → Authorizations**, including search and active/revoked filters.
5. Tampermonkey's **Connect Tools / reconnect payroll** menu opens a new connection. **Forget payroll authorization on this browser** removes local access only; use Tools to revoke it. Closing the login tab or a network failure allows Connect Tools to resume a pending attempt within ten minutes. Permanent access never expires automatically.

The script reads the latest saved export; submit the week in Tools first. Existing input values and same-rate role row allocation are preserved. Connecting does not fill payroll, and the script never submits/approves payroll in Patriot. PTO/snapshot/payroll calculation changes are not included.

### Credential handling

Web Crypto generates a personal credential in the userscript sandbox; only its SHA-256 digest is sent when starting a connection. The login link and comparison code contain no credential. Tools records the hash only after explicit approval. Polling proves possession through a separate `PayrollConnect` header; payroll reads use `PayrollImport`. Neither is a Tools login/refresh token or general partner key.

The secret stays in [Tampermonkey script storage](https://www.tampermonkey.net/documentation.php#api:GM_setValue), never in public source, page DOM/storage, postMessage, query strings or console. It is a bearer credential, not cryptographically device-bound; revoke the browser if its profile/extension access is compromised. Revocation causes the next import to clear local access; permission/network errors preserve it for retry. Requests use fixed HTTPS destinations, no cookies/redirects and a manual abort deadline.

### Release order

1. Apply the backend's `20261019_payroll_import_authorization.sql` and `20261019_payroll_import_connection.sql` additive migrations, regenerate Prisma, deploy backend.
2. Deploy the Tools authorization/consent/admin UI.
3. Publish/update this payroll script. Explicit update/download metadata uses the public repository's main branch. Do not publish before the backend/UI are ready.
4. Coordinate rotation of the exposed shared partner key separately. Removing it here does not revoke the old key or erase history. BcoSys, order-prediction and the Mac mini revenue writer still need their own migration.

Other Cin7 scripts are unchanged. No production token rotation or deployment is implied by these source edits.

### Verification

`node --test test/payroll-auth.test.cjs test/payroll-import.test.cjs` (18 tests) and `node --check payroll.script.js`. Fixtures cover pairing/denial/retry/local Forget, credential boundaries, transport deadlines and unchanged filling. They also reproduce Patriot overriding `Date.parse`: use `new Date(iso).getTime()` for API expiry timestamps and reuse that numeric deadline during polling. Reject missing/non-string/invalid expiry values. Extension installation and a real operator's import remain rollout smoke checks. Never commit credentials or real payroll fixtures.
