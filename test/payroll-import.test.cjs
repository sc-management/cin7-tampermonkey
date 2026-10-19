const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../payroll.script.js'), 'utf8');
const functions = script.slice(script.indexOf('    function findMoneyInput('), script.indexOf('    // --- 小浮动按钮'));
function row(rate, regular = '', overtime = '') {
    const inputs = Object.fromEntries(['Regular', 'Overtime', 'Vacation', 'Sick', 'Tips - Owed', 'Tips - Already Paid', 'Bonus'].map(name => [name, {value: ''}]));
    inputs.Regular.value = regular;
    inputs.Overtime.value = overtime;
    return {
        inputs,
        getAttribute: () => String(rate),
        querySelector(selector) { return inputs[selector.match(/placeholder="([^"]+)"/)?.[1]] ?? null; },
    };
}
function importer(rows) {
    const context = {
        document: {querySelectorAll: () => rows},
        setInputValue(input, value) { input.value = typeof value === 'number' ? value.toFixed(2) : value; },
    };
    vm.createContext(context);
    vm.runInContext(functions, context);
    return employee => {
        const missed = [];
        context.fillPayroll(employee, 'test', 'Test Employee', missed);
        return missed;
    };
}
const employee = {
    summary: {
        Kitchen: {pay_rate: 19, regular_hours: 19.84, overtime_hours: 0},
        'BOH Manager': {pay_rate: 19, regular_hours: 11.58, overtime_hours: 1.5},
    },
    tips: 20, tips_cash: 5, bonus: 10,
};

test('same-rate entries fill separate rows without role-name matching; money fills once', () => {
    const rows = [row(19), row(19)];
    assert.deepEqual(importer(rows)(employee), []);
    assert.deepEqual(rows.map(r => r.inputs.Regular.value), ['19.84', '11.58']);
    assert.deepEqual(rows.map(r => r.inputs.Overtime.value), ['0.00', '1.50']);
    for (const field of ['Tips - Owed', 'Tips - Already Paid', 'Bonus']) {
        assert.notEqual(rows[0].inputs[field].value, '');
        assert.equal(rows[1].inputs[field].value, '');
    }
});
test('partially imported rows stay assigned and rerunning does not duplicate hours', () => {
    const rows = [row(19, '19.84', '0.00'), row(19), row(19)];
    const fill = importer(rows);
    fill(employee);
    fill(employee);
    assert.deepEqual(rows.map(r => r.inputs.Regular.value), ['19.84', '11.58', '']);
});
test('too few same-rate rows reports the unmatched entry', () => {
    assert.deepEqual(importer([row(19)])(employee), ['Test Employee > BOH Manager']);
});
test('different rates remain independent and existing input is preserved', () => {
    const rows = [row(21), row(19, '20.00')];
    const data = {...employee, summary: {...employee.summary, 'BOH Manager': {pay_rate: 21, regular_hours: 11.58, overtime_hours: 0}}};
    assert.deepEqual(importer(rows)(data), []);
    assert.deepEqual(rows.map(r => r.inputs.Regular.value), ['11.58', '20.00']);
});

test('Vacation and Sick stay on their separate same-rate roles and retain four decimals', () => {
    const rows = [row(19), row(19)];
    const data = {...employee, summary: {
        Kitchen: {...employee.summary.Kitchen, vacation_hours: 1.2345, sick_hours: 2},
        Manager: {...employee.summary['BOH Manager'], vacation_hours: 8, sick_hours: 0.1234},
    }};
    assert.deepEqual(importer(rows)(data), []);
    assert.deepEqual(rows.map(r => r.inputs.Vacation.value), ['1.2345', '8']);
    assert.deepEqual(rows.map(r => r.inputs.Sick.value), ['2', '0.1234']);
});
test('PTO-only rows count as hours and money is still filled once', () => {
    const rows = [row(19), row(19)];
    const data = {...employee, summary: {
        First: {pay_rate: 19, regular_hours: 0, overtime_hours: 0, sick_hours: 3},
        Second: {pay_rate: 19, regular_hours: 0, overtime_hours: 0, vacation_hours: 8},
    }};
    importer(rows)(data);
    assert.equal(rows[0].inputs['Tips - Owed'].value, '20.00');
    assert.equal(rows[1].inputs['Tips - Owed'].value, '');
    assert.equal(rows[0].inputs.Sick.value, '3');
    assert.equal(rows[1].inputs.Vacation.value, '8');
});
test('leave values including zero are preserved on rerun; empty fields are filled', () => {
    const rows = [row(19), row(19)];
    rows[0].inputs.Vacation.value = '0';
    rows[1].inputs.Sick.value = '4.5';
    const data = {...employee, summary: Object.fromEntries(Object.entries(employee.summary).map(([k, v]) => [k, {...v, vacation_hours: 8, sick_hours: 2}]))};
    const fill = importer(rows);
    fill(data); fill(data);
    assert.deepEqual(rows.map(r => r.inputs.Vacation.value), ['0', '8']);
    assert.deepEqual(rows.map(r => r.inputs.Sick.value), ['2', '4.5']);
});
test('unavailable nonzero leave fields are reported without changing the matching flow', () => {
    const rows = [row(19)];
    delete rows[0].inputs.Vacation;
    rows[0].inputs.Sick.disabled = true;
    const missed = importer(rows)({...employee, summary: {Kitchen: {...employee.summary.Kitchen, vacation_hours: 8, sick_hours: 3}}});
    assert.equal(missed.length, 2);
    assert.match(missed[0], /Vacation input unavailable/);
    assert.match(missed[1], /Sick input unavailable/);
    assert.equal(rows[0].inputs.Regular.value, '19.84');
});
test('salary/leave-only input shape works without Regular or Overtime fields', () => {
    const rows = [row(1000)];
    delete rows[0].inputs.Regular;
    delete rows[0].inputs.Overtime;
    assert.deepEqual(importer(rows)({...employee, summary: {Salary: {pay_rate: 1000, regular_hours: 0, overtime_hours: 0, vacation_hours: 8}}}), []);
    assert.equal(rows[0].inputs.Vacation.value, '8');
});
