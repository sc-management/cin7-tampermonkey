// ==UserScript==
// @name         SC Load Payroll (Native)
// @namespace    http://tampermonkey.net/
// @version      0.1.1
// @description  Fill my patriot using data from HomeBase and payroll sheet!
// @author       Yihui Liu
// @match        *://login.patriotsoftware.com/payroll/entry*
// @match        *://login.patriotsoftware.com/payroll/recallsavedentry*
// @grant        GM_xmlhttpRequest
// @connect      sc-tools-backend-production.up.railway.app
// ==/UserScript==

(function () {
    'use strict';

    console.log('SC Load Payroll (Clean UI) loaded');

    function injectStyles() {
        if (document.getElementById('sclp-style')) return;
        const style = document.createElement('style');
        style.id = 'sclp-style';
        style.textContent = `
        /* 浮动按钮：默认静止，hover 时轻微上浮 + 放大 */
        .sclp-fab {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 999998;
          border-radius: 999px;
          padding: 8px 18px;
          border: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: #fff;
          background: linear-gradient(135deg,#6366f1,#a855f7);
          box-shadow: 0 12px 30px rgba(79,70,229,0.45);
          transform: translateY(0) scale(1);
          transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
        }
        .sclp-fab:hover {
          transform: translateY(-2px) scale(1.05);
          box-shadow: 0 16px 36px rgba(79,70,229,0.6);
        }

        /* 输入框绿色闪光动画（保持原样） */
        .sclp-flash {
          animation: sclp-flash-bg 1.2s ease-out;
        }
        @keyframes sclp-flash-bg {
          0%   { background-color: #bbf7d0; }
          50%  { background-color: #dcfce7; }
          100% { background-color: inherit; }
        }
        `;
        document.head.appendChild(style);
    }

    // --- 小工具：设置 input 值并触发事件，避免框架覆盖 ---
    function setInputValue(input, value) {
        if (!input) return;
        const val = typeof value === 'number' ? value.toFixed(2) : value;

        // 同时改 property 和 attribute
        input.value = val;
        input.setAttribute('value', val);

        // 触发 input/change，让 Patriot 的脚本也感知到
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));

        // 绿色闪光提示：先移除再强制 reflow，再添加 class
        input.classList.remove('sclp-flash');
        // 强制重绘一次，让动画可以重复触发
        void input.offsetWidth;
        input.classList.add('sclp-flash');
    }

    // ---------- 日期工具：上一周（周一到周日） ----------
    function formatYMD(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function getLastWeekRange() {
        const today = new Date();
        const day = today.getDay(); // 0=Sun,1=Mon,...6=Sat

        // 当前周的周一
        const offsetToMonday = (day + 6) % 7; // 把周一当成 0
        const thisMonday = new Date(today);
        thisMonday.setDate(today.getDate() - offsetToMonday);

        // 当前周的周日 = 当前周一 + 6
        const thisSunday = new Date(thisMonday);
        thisSunday.setDate(thisMonday.getDate() + 6);

        // 上一周的周一、周日
        const lastMonday = new Date(thisMonday);
        lastMonday.setDate(thisMonday.getDate() - 7);

        const lastSunday = new Date(thisSunday);
        lastSunday.setDate(thisSunday.getDate() - 7);

        return {
            start: formatYMD(lastMonday), // 上周一
            end: formatYMD(lastSunday), // 上周日
        };
    }

    // --- 自己的简易 modal（类似 SweetAlert2 风格） ---
    function showModal({title, text, isError = false, onOk}) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.4);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
      width: 380px;
      max-width: calc(100% - 32px);
      padding: 24px 24px 20px;
      position: relative;
      transform: translateY(0);
    `;

        const icon = document.createElement('div');
        icon.style.cssText = `
      width: 32px;
      height: 32px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
      font-size: 18px;
      color: ${isError ? '#b91c1c' : '#16a34a'};
      background: ${isError ? 'rgba(248, 113, 113, 0.12)' : 'rgba(74, 222, 128, 0.16)'};
    `;
        icon.textContent = isError ? '!' : '✓';

        const titleEl = document.createElement('div');
        titleEl.textContent = title;
        titleEl.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 4px;
    `;

        const textEl = document.createElement('div');
        textEl.textContent = text;
        textEl.style.cssText = `
      font-size: 14px;
      color: #4b5563;
      margin-bottom: 20px;
      white-space: pre-wrap;
    `;

        const btnRow = document.createElement('div');
        btnRow.style.cssText = `
      display: flex;
      justify-content: flex-end;
    `;

        const okBtn = document.createElement('button');
        okBtn.textContent = 'Ok';
        okBtn.style.cssText = `
      min-width: 80px;
      padding: 8px 20px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
      background: linear-gradient(135deg,#6366f1,#a855f7);
      box-shadow: 0 10px 25px rgba(79,70,229,0.5);
    `;

        okBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            if (onOk) onOk();
        });

        btnRow.appendChild(okBtn);
        dialog.appendChild(icon);
        dialog.appendChild(titleEl);
        dialog.appendChild(textEl);
        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    // 日期选择 modal
    function showDateSelector(onConfirm) {
        const {start, end} = getLastWeekRange();

        const overlay = document.createElement('div');
        overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.4);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
      width: 380px;
      max-width: calc(100% - 32px);
      padding: 24px 24px 20px;
    `;

        const title = document.createElement('div');
        title.textContent = 'Select Dates';
        title.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 16px;
    `;

        const form = document.createElement('div');
        form.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;';

        function makeField(labelText, defaultValue) {
            const wrap = document.createElement('label');
            wrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #374151;';

            const label = document.createElement('span');
            label.textContent = labelText;

            const input = document.createElement('input');
            input.type = 'date';
            input.value = defaultValue;
            input.style.cssText = `
        border-radius: 8px;
        border: 1px solid #d1d5db;
        padding: 6px 10px;
        font-size: 14px;
        color: #111827;
      `;

            wrap.appendChild(label);
            wrap.appendChild(input);
            return {wrap, input};
        }

        const startField = makeField('Start Date', start);
        const endField = makeField('End Date', end);

        form.appendChild(startField.wrap);
        form.appendChild(endField.wrap);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
      padding: 8px 16px;
      border-radius: 999px;
      border: 1px solid #d1d5db;
      background: #fff;
      color: #374151;
      font-size: 14px;
      cursor: pointer;
    `;
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        const okBtn = document.createElement('button');
        okBtn.textContent = 'Ok';
        okBtn.style.cssText = `
      min-width: 80px;
      padding: 8px 20px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
      background: linear-gradient(135deg,#6366f1,#a855f7);
      box-shadow: 0 10px 25px rgba(79,70,229,0.5);
    `;
        okBtn.addEventListener('click', () => {
            const s = startField.input.value;
            const e = endField.input.value;
            if (!s || !e) return;
            document.body.removeChild(overlay);
            onConfirm({startDate: s, endDate: e});
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);

        dialog.appendChild(title);
        dialog.appendChild(form);
        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    // --- 核心逻辑：请求 + 填值 ---
    function loadPayroll({startDate, endDate}) {
        const headerId = document.querySelector('.header-id');
        if (!headerId) {
            showModal({title: 'Error', text: 'header-id not found', isError: true});
            return;
        }

        const patriotId = headerId.textContent.trim().replace(/\s+/g, '');
        if (!patriotId) {
            showModal({title: 'Error', text: 'Invalid patriot ID', isError: true});
            return;
        }

        // 最新 API
        const apiToken = '300b1d5e-0cfc-4576-a933-404a1108176e';
        const url = `https://sc-tools-backend-production.up.railway.app/partner/patriot/${encodeURIComponent(
            patriotId
        )}/payroll-export/${encodeURIComponent(startDate)}?api_token=${encodeURIComponent(
            apiToken
        )}`;

        console.log('[sclp] Requesting payroll:', url);

        GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload: function (res) {
                try {
                    const data = JSON.parse(res.responseText);

                    if (!data.success) {
                        showModal({
                            title: 'Error',
                            text: data.message || 'Unknown API error',
                            isError: true,
                        });
                        return;
                    }

                    const payroll = data.data || [];
                    const result = fillPayrolls(payroll);

                    let text = 'Loaded successfully.\n\n';
                    text += `Matched employees: ${result.matchedEmployees}\n`;
                    if (result.missedEmployees.length) {
                        text += '\nEmployees not found:\n' + result.missedEmployees.join(', ') + '\n';
                    }
                    if (result.missedRoles.length) {
                        text += '\nRoles not found:\n' + result.missedRoles.join(', ') + '\n';
                    }

                    showModal({title: 'Finished', text});
                } catch (err) {
                    console.error(err);
                    showModal({title: 'Error', text: String(err), isError: true});
                }
            },
            onerror: function (err) {
                console.error(err);
                showModal({title: 'Error', text: 'Network error: ' + err, isError: true});
            },
        });
    }


    function fillPayrolls(payroll) {
        const patriotEmployees = document.querySelectorAll('tr.employee-row');
        const patriotIdMap = {};
        patriotEmployees.forEach((row) => {
            const nameCell = row.querySelector('td.employee-name-column');
            if (nameCell && nameCell.hasAttribute('data-column')) {
                const strong = nameCell.querySelector('strong, a[data-employee-name]');
                const nameStr = (strong?.textContent || '').trim();
                if (nameStr) {
                    const eid = row.getAttribute('data-employee-id');
                    patriotIdMap[nameStr] = eid;
                }
            }
        });

        console.log('Patriot employees map:', patriotIdMap);

        let missedEmployees = [];
        let missedRoles = [];
        let matchedEmployees = 0;

        payroll.forEach((shakingEmployee) => {
            const nameSet =
                shakingEmployee.employee?.name_set ||
                shakingEmployee.name.trim().split(/\s+/);

            let employeeMatched = false;

            Object.keys(patriotIdMap).forEach((name) => {
                const matched = nameSet.every((piece) =>
                    name.toLowerCase().includes(piece.toLowerCase())
                );
                if (matched) {
                    employeeMatched = true;
                    matchedEmployees++;
                    fillPayroll(shakingEmployee, patriotIdMap[name], nameSet.join(' '), missedRoles);
                }
            });

            if (!employeeMatched) {
                missedEmployees.push(nameSet.join(' '));
            }
        });

        // 去重一下
        missedEmployees = Array.from(new Set(missedEmployees));
        missedRoles = Array.from(new Set(missedRoles));

        console.log('Matched employees:', matchedEmployees);
        console.log('Missed employees:', missedEmployees);
        console.log('Missed roles:', missedRoles);

        return {matchedEmployees, missedEmployees, missedRoles};
    }

// ---- money 输入框定位：Patriot 改 placeholder 时更抗揍 ----
    function findMoneyInput(row, kind) {
        // kind: 'tipsOwed' | 'tipsCash' | 'bonus'
        const selectors = {
            tipsOwed: [
                'input[placeholder="Tips - Owed"]',
                'input[placeholder^="Tips - Ow"]',
                'input[placeholder*="Tips - Ow"]',
            ],
            tipsCash: [
                'input[placeholder="Tips - Already Paid"]',
                'input[placeholder^="Tips - Al"]',
                'input[placeholder*="Already Paid"]',
                'input[placeholder*="Paid"]',
            ],
            bonus: [
                'input[placeholder="Bonus"]',
                'input[placeholder*="Bonus"]',
            ],
        };

        for (const sel of selectors[kind] || []) {
            const el = row.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    function hasAnyHoursToPay(value) {
        const reg = Number(value?.regular_hours || 0);
        const ot = Number(value?.overtime_hours || 0);
        // 你如果以后要把 vacation/sick 也算“有数值的 hours”，在这里加：
        // const vac = Number(value?.vacation_hours || 0);
        // const sick = Number(value?.sick_hours || 0);
        return reg > 0 || ot > 0;
    }

    function fillPayroll(shakingEmployee, patriotId, name, missedRoles) {
        const rowClass = `payroll-entry-row-full_${patriotId}`;
        const rows = Array.from(document.querySelectorAll(`tr.${rowClass}`));

        // 目标：只在“第一个有 hours 的 pay-rate 行”填一次 tips/bonus
        let moneyFilled = false;

        // 只处理非 other
        const entries = Object.entries(shakingEmployee.summary || {}).filter(
            ([role]) => role !== 'other'
        );

        // 按 summary 逐个 role 匹配 pay rate，并填 hours
        entries.forEach(([role, value]) => {
            const matchedRows = rows.filter((row) => {
                const rowPayRateStr = row.getAttribute('data-pay-rate');
                const rowPayRate = Math.round(parseFloat(rowPayRateStr || '0') * 100) / 100;
                const employeePayRate = Math.round((value.pay_rate || 0) * 100) / 100;
                return rowPayRate === employeePayRate;
            });

            let rowMatchedForHours = false;

            for (const row of matchedRows) {
                if (rowMatchedForHours) break;

                const regularHourInput = row.querySelector('input[placeholder="Regular"]');
                const overtimeHourInput = row.querySelector('input[placeholder="Overtime"]');

                // 先填 hours
                if (regularHourInput && !regularHourInput.value) {
                    setInputValue(regularHourInput, value.regular_hours || 0);
                }
                if (overtimeHourInput && !overtimeHourInput.value) {
                    setInputValue(overtimeHourInput, value.overtime_hours || 0);
                }

                rowMatchedForHours = true;

                // ✅ 再决定是否在这一行填 tips（只填一次，而且必须这一行“有 hours”）
                if (!moneyFilled && hasAnyHoursToPay(value)) {
                    const tipsOwedInput = findMoneyInput(row, 'tipsOwed');
                    const tipsCashInput = findMoneyInput(row, 'tipsCash');
                    const bonusInput = findMoneyInput(row, 'bonus');

                    if (tipsOwedInput && !tipsOwedInput.value) {
                        setInputValue(tipsOwedInput, shakingEmployee.tips || 0);
                    }
                    if (tipsCashInput && !tipsCashInput.value) {
                        setInputValue(tipsCashInput, shakingEmployee.tips_cash || 0);
                    }
                    if (bonusInput && !bonusInput.value) {
                        setInputValue(bonusInput, shakingEmployee.bonus || 0);
                    }

                    moneyFilled = true;
                }
            }

            if (!rowMatchedForHours) {
                missedRoles.push(`${name} > ${role}`);
            }
        });

        // ✅ 兜底：所有 role 都是 0 小时，但只要有 tips/cash/bonus，也要填到第一条 pay-rate 行
        if (!moneyFilled && rows.length) {
            const tips = Number(shakingEmployee.tips || 0);
            const tipsCash = Number(shakingEmployee.tips_cash || 0);
            const bonus = Number(shakingEmployee.bonus || 0);

            const hasMoney = tips !== 0 || tipsCash !== 0 || bonus !== 0;
            if (hasMoney) {
                const firstRow = rows[0];

                const tipsOwedInput = findMoneyInput(firstRow, 'tipsOwed');
                const tipsCashInput = findMoneyInput(firstRow, 'tipsCash');
                const bonusInput = findMoneyInput(firstRow, 'bonus');

                if (tipsOwedInput && !tipsOwedInput.value) setInputValue(tipsOwedInput, tips);
                if (tipsCashInput && !tipsCashInput.value) setInputValue(tipsCashInput, tipsCash);
                if (bonusInput && !bonusInput.value) setInputValue(bonusInput, bonus);

                moneyFilled = true;
            }
        }
    }

    // --- 小浮动按钮 + 快捷键触发 ---
    function createFloatingButton() {
        const existing = document.querySelector('.sclp-fab');
        if (existing) return;

        const btn = document.createElement('button');
        btn.className = 'sclp-fab';
        btn.textContent = 'Load Payroll';
        btn.addEventListener('click', () => {
            showDateSelector(loadPayroll);
        });
        document.body.appendChild(btn);
    }

    function setup() {
        injectStyles(); // 🆕 先注入样式
        createFloatingButton();

        // Ctrl+Shift+P 也能打开
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                showDateSelector(loadPayroll);
            }
        });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setup();
    } else {
        window.addEventListener('DOMContentLoaded', setup);
    }
})();
