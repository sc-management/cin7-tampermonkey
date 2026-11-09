const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../payroll.script.js'), 'utf8');
const gridCode = source.slice(source.indexOf('    // --- Virtualized payroll grid ---'), source.indexOf('    // --- 小浮动按钮'));
const setterCode = source.slice(source.indexOf('    function setInputValue('), source.indexOf('    // ---------- 日期工具'));
const fields = ['Regular', 'Overtime', 'Vacation', 'Sick', 'Tips - Owed', 'Tips - Already Paid', 'Bonus'];

// Synthetic DOM fixture follows the observed Patriot markup: whole employee
// groups mount/unmount, overlapping windows, multiple rates, a shared viewport,
// and toolbar counts that include both hourly and salary employees.
function fixture(options = {}) {
    const people = options.people || Array.from({length: 36}, (_, i) => ({
        id: String(i + 1), name: `Worker, Person${String(i + 1).padStart(3, '0')}`, rates: i >= 34 ? [1000] : i === 17 ? [19, 19] : [19],
    }));
    const model = people.map(person => ({...person, rows: person.rates.map(rate => ({rate, values: {}}))}));
    let offset = 0;
    model.forEach(person => { person.top = offset; offset += person.rows.length * 180; person.bottom = offset; });
    let now = 0, hydrateAt = Infinity, mounted = [], inView = false, company = '12345', visits = 0;
    const writes = [], scrolls = [], period = {textContent: 'Weekly Payroll | 11/02/2026 - 11/08/2026'};
    const button = {textContent: ''};
    const viewport = {
        scrollTop: options.startTop || 0, scrollLeft: 65, clientHeight: 420, isConnected: true,
        get scrollHeight() { return offset; },
        scrollIntoView() { inView = true; window.scrollY = 800; hydrateAt = now + 100; },
        scrollTo({top, left}) {
            this.scrollTop = Math.max(0, Math.min(top, offset - this.clientHeight));
            if (left !== undefined) this.scrollLeft = left;
            scrolls.push(this.scrollTop);
            hydrateAt = now + 100;
        },
        dispatchEvent() { hydrateAt = now + 100; },
    };
    const window = {
        scrollX: 10, scrollY: 0,
        scrollTo({left, top}) { this.scrollX = left; this.scrollY = top; },
    };
    function mount() {
        visits++;
        mounted.forEach(row => { row.connected = false; });
        mounted = [];
        const visible = options.legacy ? model : inView ? model.filter(p => p.bottom > viewport.scrollTop && p.top < viewport.scrollTop + viewport.clientHeight) : model.slice(0, 2);
        for (const person of visible) {
            if (options.omitId === person.id) continue;
            for (const [index, data] of person.rows.entries()) {
                const row = {connected: true};
                const inputs = Object.fromEntries(fields.map(field => [field, {
                    value: data.values[field] || '',
                    setAttribute() {}, classList: {remove() {}, add() {}}, offsetWidth: 10,
                    dispatchEvent(event) {
                        assert.ok(row.connected, 'input events must reach mounted rows, never stale nodes');
                        if (event.type === 'change') {
                            writes.push({id: person.id, index, field, value: this.value});
                            data.values[field] = this.value;
                        }
                    },
                }]));
                Object.assign(row, {
                    id: person.id,
                    getAttribute: name => name === 'data-employee-id' ? person.id : String(data.rate),
                    querySelectorAll: () => Object.values(inputs),
                    querySelector(selector) {
                        if (selector.includes('employee-name-column')) return index === 0 ? {textContent: person.name} : null;
                        return inputs[selector.match(/placeholder="([^"]+)"/)?.[1]] || null;
                    },
                });
                mounted.push(row);
            }
        }
    }
    const loaded = () => now >= (options.initialDelay || 0);
    const document = {
        querySelector(selector) {
            if (selector === '#entry-grid-viewport') return options.legacy || !loaded() ? null : viewport;
            if (selector === '#appContainer') return loaded() ? period : null;
            if (selector === '.sclp-fab') return button;
            return null;
        },
        querySelectorAll(selector) {
            if (!loaded()) return [];
            if (selector === '#entry-grid-jumps .mk5-jump-count') return options.legacy ? [] : [{textContent: String(model.length - 2)}, {textContent: '2'}];
            if (selector === 'tr.employee-row') return mounted;
            const id = selector.match(/^tr\.payroll-entry-row-full_(\d+)$/)?.[1];
            return id ? mounted.filter(row => row.id === id) : [];
        },
    };
    const context = {
        document, window, Event: class {constructor(type) {this.type = type;}},
        PayrollImportError: class extends Error {},
        currentPatriotId: () => company, isPatriotPayrollPage: () => true,
        setTimeout(fn, ms) {
            queueMicrotask(() => {
                now += ms;
                if (loaded() && (hydrateAt <= now || !mounted.length)) { hydrateAt = Infinity; mount(); }
                if (options.changeCompanyAt && now >= options.changeCompanyAt) company = 'other';
                if (options.changePeriodAt && now >= options.changePeriodAt) period.textContent = 'Different week';
                fn();
            });
        },
    };
    if (loaded()) mount();
    vm.createContext(context);
    vm.runInContext(setterCode + gridCode, context);
    return {context, model, writes, scrolls, viewport, window, visits: () => visits,
        fill: payroll => context.fillPayrolls(payroll)};
}

function exportFor(ids) {
    return ids.map(id => ({name: `Person${String(id).padStart(3, '0')} Worker`, employee: {name_set: [`Person${String(id).padStart(3, '0')}`, 'Worker']},
        summary: {Kitchen: {pay_rate: id > 34 ? 1000 : 19, regular_hours: 8, overtime_hours: 1, vacation_hours: 1.2345, sick_hours: 0}}, tips: 12, bonus: 5, tips_cash: 2}));
}

test('fresh page waits for initialization and fills employees outside the initial DOM, including the last salary group', async () => {
    const f = fixture({initialDelay: 600});
    const result = await f.fill(exportFor([3, 17, 29, 36]));
    assert.equal(result.scannedEmployees, 36);
    assert.equal(result.matchedEmployees, 4);
    assert.equal(result.missedEmployees.length + result.missedRoles.length, 0);
    assert.equal(f.model[35].rows[0].values.Regular, '8.00');
    assert.equal(f.model[28].rows[0].values.Vacation, '1.2345');
    assert.equal(f.viewport.scrollTop, 0);
    assert.equal(f.viewport.scrollLeft, 65);
    assert.equal(f.window.scrollY, 0);
    assert.ok(f.visits() > 20, 'rows really unmounted/remounted during both passes');
});

test('overlapping windows and reruns fill each employee once, keeping same-rate roles separate', async () => {
    const f = fixture({startTop: 2200});
    const payroll = exportFor([18]);
    payroll[0].summary.Manager = {pay_rate: 19, regular_hours: 3, overtime_hours: 0};
    await f.fill(payroll);
    const count = f.writes.length;
    await f.fill(payroll);
    assert.equal(f.writes.length, count, 'no writes repeated on a second import');
    assert.deepEqual(f.model[17].rows.map(r => r.values.Regular), ['8.00', '3.00']);
    assert.equal(f.model[17].rows[1].values['Tips - Owed'], undefined);
    assert.equal(f.writes.filter(w => w.field === 'Regular').length, 2);
    assert.equal(f.viewport.scrollTop, 2200);
});

test('incomplete virtualized roster stops before any payroll field is changed', async () => {
    const f = fixture({omitId: '25'});
    await assert.rejects(f.fill(exportFor([1, 25])), /Only 35 of 36 employees loaded.*Nothing was filled/);
    assert.equal(f.writes.length, 0);
    assert.equal(f.viewport.scrollTop, 0);
    assert.equal(f.window.scrollY, 0);
});

test('genuinely absent employees are reported after scanning the entire roster', async () => {
    const f = fixture();
    const result = await f.fill(exportFor([36, 99]));
    assert.equal(result.matchedEmployees, 1);
    assert.deepEqual(Array.from(result.missedEmployees), ['Person099 Worker']);
});

test('ambiguous names and duplicate source matches never fill multiple employees', async () => {
    const f = fixture({people: [
        {id: '1', name: 'Worker, Person001', rates: [19]},
        {id: '2', name: 'Worker, Person001 Junior', rates: [19]},
        {id: '3', name: 'Worker, Person003', rates: [19]},
    ]});
    const result = await f.fill(exportFor([1, 3, 3]));
    assert.equal(result.matchedEmployees, 0);
    assert.equal(result.ambiguousEmployees.length, 2);
    assert.equal(f.writes.length, 0);
});

test('company or pay-period changes while scanning stop before filling', async () => {
    for (const options of [{changeCompanyAt: 350}, {changePeriodAt: 350}]) {
        const f = fixture(options);
        await assert.rejects(f.fill(exportFor([36])), /payroll page changed/);
        assert.equal(f.writes.length, 0);
        assert.equal(f.viewport.scrollTop, 0);
    }
});

test('legacy static table still imports without a viewport or toolbar count', async () => {
    const f = fixture({legacy: true});
    const result = await f.fill(exportFor([36]));
    assert.equal(result.matchedEmployees, 1);
    assert.equal(f.model[35].rows[0].values.Regular, '8.00');
    assert.equal(f.scrolls.length, 0);
});

test('initial grid timeout reports an actionable error with no field changes', async () => {
    const f = fixture({initialDelay: 15000});
    await assert.rejects(f.fill(exportFor([1])), /employee list did not load/);
    assert.equal(f.writes.length, 0);
});
