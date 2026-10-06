const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../payroll.script.js'), 'utf8');
const functions = script.slice(script.indexOf('    function findMoneyInput('), script.indexOf('    // --- 小浮动按钮'));
function row(rate, regular = '', overtime = '') {
    const inputs = Object.fromEntries(['Regular', 'Overtime', 'Tips - Owed', 'Tips - Already Paid', 'Bonus'].map(name => [name, {value: ''}]));
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
        setInputValue(input, value) { input.value = Number(value).toFixed(2); },
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
