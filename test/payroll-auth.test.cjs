const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../payroll.script.js'), 'utf8');
const helpers = source.slice(source.indexOf('    const PAYROLL_AUTH_STORAGE_KEY'), source.indexOf('    function fillPayrolls('));
const credential = `pgi.${'a'.repeat(43)}`; // Synthetic, never a production credential.
const storageKey = 'sclp.payrollAuthorization.v1';
const payroll = [{name: 'Test Employee', tips: 2, tips_cash: 0, bonus: 0, summary: {Kitchen: {regular_hours: 8, overtime_hours: 0, pay_rate: 20}}}];

function fixture(options = {}) {
    const storage = options.storage || new Map([[storageKey, credential]]);
    const requests = [], messages = [], fills = [];
    let prompts = 0, company = '12345';
    const context = {
        setTimeout, clearTimeout,
        location: {protocol: 'https:', hostname: 'login.patriotsoftware.com', pathname: '/payroll/entry'},
        document: {querySelector: () => ({textContent: company})},
        window: {prompt: () => { prompts++; return options.prompt === undefined ? credential : options.prompt; }},
        GM_getValue: (key, fallback) => storage.get(key) ?? fallback,
        GM_setValue: (key, value) => storage.set(key, value),
        GM_deleteValue: (key) => storage.delete(key),
        GM_xmlhttpRequest: (request) => {
            requests.push(request);
            if (options.transport) return options.transport(request);
            request.onload({status: options.status || 200, responseText: options.response || JSON.stringify({success: true, data: {patriotId: company, startDate: '2026-10-12', payroll}})});
        },
        showModal: (message) => messages.push(message),
        fillPayrolls: (data) => { fills.push(data); return {matchedEmployees: data.length, missedEmployees: [], missedRoles: []}; },
    };
    vm.createContext(context);
    vm.runInContext(helpers, context);
    return {context, storage, requests, messages, fills, prompts: () => prompts, company: (value) => {company = value;}, load: () => context.loadPayroll({startDate: '2026-10-12'})};
}

test('connected import uses a dedicated header and remembers authorization only in GM storage', async () => {
    const f = fixture();
    await f.load();
    assert.equal(f.storage.get(storageKey), credential);
    assert.equal(f.fills.length, 1);
    assert.equal(f.requests[0].method, 'POST');
    assert.equal(f.requests[0].headers.Authorization, `PayrollImport ${credential}`);
    assert.equal(f.requests[0].anonymous, true);
    assert.equal(f.requests[0].redirect, 'error');
    assert.equal(f.requests[0].url, 'https://sc-tools-backend-production.up.railway.app/payroll-imports/redeem');
    assert.ok(!f.requests[0].data.includes(credential));
    assert.ok(!JSON.stringify(f.messages).includes(credential));
    const reloaded = fixture({storage: f.storage});
    await reloaded.load();
    assert.equal(reloaded.prompts(), 0);
    assert.equal(reloaded.fills.length, 1);
});

test('revocation clears local authorization; permission/network errors keep it for retry', async () => {
    for (const status of [401, 403, 404, 409, 429, 503]) {
        const f = fixture({status, storage: new Map([[storageKey, credential]])});
        await f.load();
        assert.equal(f.storage.has(storageKey), status !== 401);
        assert.equal(f.fills.length, 0);
    }
});

test('malformed, cross-company, cross-week and invalid employee responses cannot partially fill payroll', async () => {
    for (const response of [
        '{broken',
        JSON.stringify({success: true, data: {patriotId: 'OTHER', startDate: '2026-10-12', payroll}}),
        JSON.stringify({success: true, data: {patriotId: '12345', startDate: '2026-10-19', payroll}}),
        JSON.stringify({success: true, data: {patriotId: '12345', startDate: '2026-10-12', payroll: [...payroll, {name: null}]}}),
    ]) {
        const f = fixture({response}); await f.load();
        assert.equal(f.fills.length, 0);
        assert.equal(f.storage.get(storageKey), credential);
    }
});

test('other hosts and HTTP pages never send authorization', async () => {
    for (const changes of [{hostname: 'example.com'}, {protocol: 'http:'}, {pathname: '/other'}]) {
        const f = fixture(); Object.assign(f.context.location, changes);
        await f.load(); assert.equal(f.requests.length, 0);
    }
});

test('company switch during request prevents filling; double clicks produce one request', async () => {
    const f = fixture({transport() {}});
    const pending = f.load();
    await f.load();
    assert.equal(f.requests.length, 1);
    f.company('99999');
    f.requests[0].onload({status: 200, responseText: JSON.stringify({success: true, data: {patriotId: '12345', startDate: '2026-10-12', payroll}})});
    await pending;
    assert.equal(f.fills.length, 0);
});

test('transport errors and thrown errors cannot expose request credentials', async () => {
    for (const transport of [
        (request) => request.onerror({headers: {Authorization: credential}}),
        () => {throw new Error(credential);},
        (request) => request.ontimeout(),
    ]) {
        const f = fixture({transport}); await f.load();
        assert.equal(f.fills.length, 0);
        assert.ok(!JSON.stringify(f.messages).includes(credential));
    }
});

test('distribution contains no partner authentication or payroll console logging', () => {
    assert.ok(source.includes('https://tools.shakingcrab.com/account/authorizations'));
    assert.ok(!source.includes('tools.shakingcrab.com/payroll/checklist'));
    assert.ok(!/api_token|const apiToken|\/partner\/patriot|console\.(log|error)/.test(source));
    assert.ok(!/localStorage|sessionStorage/.test(helpers));
    for (const grant of ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_registerMenuCommand']) {
        assert.ok(source.includes(`// @grant        ${grant}`));
    }
});

const pendingKey = 'sclp.payrollConnection.v1';
function connectionFixture(options = {}) {
    const storage = options.storage || new Map(), requests = [], messages = [], tabs = [];
    let polls = 0;
    const context = {
        crypto: webcrypto, TextEncoder, Uint8Array, btoa,
        setTimeout: (callback, delay) => setTimeout(callback, delay === 6000 ? 0 : delay), clearTimeout,
        location: { protocol: 'https:', hostname: 'login.patriotsoftware.com', pathname: '/payroll/entry' },
        document: { querySelector: () => null },
        GM_getValue: (key, fallback) => storage.get(key) ?? fallback,
        GM_setValue: (key, value) => storage.set(key, value),
        GM_deleteValue: (key) => storage.delete(key),
        GM_openInTab: (url) => { const tab = { url, closed: !!options.closed, close() { this.closed = true; } }; tabs.push(tab); return tab; },
        GM_xmlhttpRequest: (request) => {
            requests.push(request);
            if (options.transport) return options.transport(request, storage);
            const isPoll = request.url.endsWith('/status');
            if (isPoll) polls++;
            request.onload({status: 200, responseText: JSON.stringify({success: true, data: isPoll
                ? { status: options.status || (polls === 1 ? 'pending' : 'approved') }
                : { requestId: 'r'.repeat(32), expiresAt: new Date(Date.now() + 600000).toISOString() }})});
        },
        showModal: (message) => messages.push(message),
    };
    vm.createContext(context); vm.runInContext(helpers, context);
    return { context, storage, requests, messages, tabs, connect: () => context.connectTools() };
}

test('connect opens login/consent with only a request ID, saves approved credential in GM and never fills', async () => {
    const f = connectionFixture(); await f.connect();
    const raw = f.storage.get(storageKey);
    assert.match(raw, /^pgi\.[A-Za-z0-9_-]{43}$/);
    assert.equal(f.storage.has(pendingKey), false);
    assert.equal(JSON.parse(f.requests[0].data).credentialHash, createHash('sha256').update(raw).digest('hex'));
    assert.equal(f.requests[0].headers.Authorization, undefined);
    assert.equal(f.requests[1].headers.Authorization, `PayrollConnect ${raw}`);
    assert.equal(f.tabs[0].url, `https://tools.shakingcrab.com/account/authorizations/connect?request=${'r'.repeat(32)}`);
    assert.equal(f.tabs[0].closed, true);
    assert.ok(!JSON.stringify(f.messages).includes(raw));
    assert.ok(!f.requests.some((r) => r.url.includes(raw) || r.data.includes(raw)));
});

test('denial and expiry do not save access; network failures retain pending proof for retry', async () => {
    const denied = connectionFixture({status: 'denied'}); await denied.connect();
    assert.equal(denied.storage.size, 0);
    const expired = connectionFixture({transport: (request) => request.onload({status: 410})}); await expired.connect();
    assert.equal(expired.storage.size, 0);
    const storage = new Map();
    const failed = connectionFixture({storage, transport: (request) => request.onerror({secret: 'never displayed'})}); await failed.connect();
    const raw = storage.get(pendingKey).credential;
    assert.equal(storage.has(storageKey), false);
    const retry = connectionFixture({storage}); await retry.connect();
    assert.equal(storage.get(storageKey), raw);
});

test('closing consent pauses connection and local Forget during approval cannot resurrect access', async () => {
    const closed = connectionFixture({closed: true}); await closed.connect();
    assert.equal(closed.storage.has(storageKey), false);
    assert.equal(closed.storage.has(pendingKey), true);
    const forgotten = connectionFixture({transport: (request, storage) => {
        if (request.url.endsWith('/status')) {
            storage.delete(pendingKey);
            request.onload({status: 200, responseText: JSON.stringify({success: true, data: {status: 'approved'}})});
        } else request.onload({status: 200, responseText: JSON.stringify({success: true, data: {requestId: 'r'.repeat(32), expiresAt: new Date(Date.now() + 600000).toISOString()}})});
    }});
    await forgotten.connect(); assert.equal(forgotten.storage.size, 0);
});

test('manual network deadline aborts requests even without a Tampermonkey timeout callback', async () => {
    let aborted = false;
    const f = fixture({transport: () => ({abort() {aborted = true;}})});
    f.context.setTimeout = (callback) => setTimeout(callback, 5);
    await f.load(); assert.equal(aborted, true); assert.equal(f.fills.length, 0);
});
