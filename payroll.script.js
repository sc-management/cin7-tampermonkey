// ==UserScript==
// @name         SC Load Payroll (Native)
// @namespace    http://tampermonkey.net/
// @version      0.1.4
// @updateURL    https://raw.githubusercontent.com/sc-management/cin7-tampermonkey/main/payroll.script.js
// @downloadURL  https://raw.githubusercontent.com/sc-management/cin7-tampermonkey/main/payroll.script.js
// @description  Fill my patriot using data from HomeBase and payroll sheet!
// @author       Yihui Liu
// @match        https://login.patriotsoftware.com/payroll/entry*
// @match        https://login.patriotsoftware.com/payroll/recallsavedentry*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @noframes
// @connect      sc-tools-backend-production.up.railway.app
// ==/UserScript==

(function () {
    'use strict';


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
    const PAYROLL_AUTH_STORAGE_KEY = 'sclp.payrollAuthorization.v1';
    const PAYROLL_IMPORT_URL = 'https://sc-tools-backend-production.up.railway.app/payroll-imports/redeem';
    const TOOLS_PAYROLL_URL = 'https://tools.shakingcrab.com/account/authorizations';
    const PAYROLL_PENDING_KEY = 'sclp.payrollConnection.v1';
    const CONNECTION_URL = PAYROLL_IMPORT_URL.replace('/redeem', '/connections');
    let importPending = false;
    let connecting = false;
    class PayrollImportError extends Error {}

    function currentPatriotId() {
        return document.querySelector('.header-id')?.textContent.trim().replace(/\s+/g, '') || '';
    }

    function isPatriotPayrollPage() {
        return location.protocol === 'https:' &&
            location.hostname === 'login.patriotsoftware.com' &&
            /^\/payroll\/(entry|recallsavedentry)(?:\/|$)/.test(location.pathname);
    }

    function validPayrollPayload(payroll) {
        const number = (value) => typeof value === 'number' && Number.isFinite(value);
        return Array.isArray(payroll) && payroll.every((employee) =>
            employee && typeof employee.name === 'string' && employee.name.trim() &&
            ['tips', 'tips_cash', 'bonus'].every((key) => employee[key] == null || number(employee[key])) &&
            (!employee.employee?.name_set ||
                (Array.isArray(employee.employee.name_set) && employee.employee.name_set.length > 0 &&
                    employee.employee.name_set.every((name) => typeof name === 'string' && name.trim()))) &&
            employee.summary && typeof employee.summary === 'object' && !Array.isArray(employee.summary) &&
            Object.values(employee.summary).every((role) =>
                role && ['regular_hours', 'overtime_hours', 'pay_rate'].every((key) => number(role[key]))
            )
        );
    }

    // A manual deadline also works when Tampermonkey uses fetch for redirect:error.
    function payrollRequest(url, body, authorization) {
        return new Promise((resolve, reject) => {
            let request, settled = false;
            const finish = (error, data) => {
                if (settled) return;
                settled = true;
                clearTimeout(deadline);
                if (error) reject(error); else resolve(data);
            };
            const deadline = setTimeout(() => {
                finish(new PayrollImportError('Request timed out. Please try again.'));
                request?.abort();
            }, 20000);
            try {
                request = GM_xmlhttpRequest({
                    method: 'POST', url,
                    headers: {'Content-Type': 'application/json', ...(authorization ? {Authorization: authorization} : {})},
                    data: JSON.stringify(body), anonymous: true, redirect: 'error', timeout: 20000,
                    onload(res) {
                        if (res.status < 200 || res.status >= 300) {
                            const messages = {
                                401: 'Authorization is no longer valid. Click Connect Tools again.',
                                403: 'Your Tools account does not have the required access.',
                                404: 'The requested connection or saved payroll export was not found.',
                                409: 'This request has changed or needs review in Tools.',
                                410: 'Connection request expired. Click Connect Tools again.',
                                429: 'Too many requests. Please wait a minute and try again.',
                            };
                            const error = new PayrollImportError(messages[res.status] || 'Tools is unavailable. Please try again later.');
                            error.status = res.status;
                            finish(error); return;
                        }
                        try {
                            const envelope = JSON.parse(res.responseText);
                            if ((res.finalUrl && res.finalUrl !== url) || !envelope.success || !envelope.data) throw new Error();
                            finish(null, envelope.data);
                        } catch { finish(new PayrollImportError('Unexpected Tools response. Please try again.')); }
                    },
                    onerror() { finish(new PayrollImportError('Network error. Please try again.')); },
                    ontimeout() { finish(new PayrollImportError('Request timed out. Please try again.')); },
                    onabort() { finish(new PayrollImportError('Request cancelled. Please try again.')); },
                });
            } catch { finish(new PayrollImportError('Unable to contact Tools. Please try again.')); }
        });
    }

    async function requestPayroll(credential, patriotId, startDate) {
        try {
            const data = await payrollRequest(PAYROLL_IMPORT_URL, {patriotId, startDate}, `PayrollImport ${credential}`);
            if (data.patriotId !== patriotId || data.startDate !== startDate || !validPayrollPayload(data.payroll)) {
                throw new PayrollImportError('Unexpected payroll response. Nothing was filled.');
            }
            return data.payroll;
        } catch (error) {
            if (error.status === 401 && GM_getValue(PAYROLL_AUTH_STORAGE_KEY, '') === credential) {
                GM_deleteValue(PAYROLL_AUTH_STORAGE_KEY);
                refreshPayrollButton();
            }
            throw error;
        }
    }

    function savedPayrollCredential() {
        const credential = GM_getValue(PAYROLL_AUTH_STORAGE_KEY, '');
        return typeof credential === 'string' && /^pgi\.[A-Za-z0-9_-]{43}$/.test(credential) ? credential : '';
    }

    function refreshPayrollButton() {
        const button = document.querySelector('.sclp-fab');
        if (button) {
            button.textContent = connecting ? 'Connecting Tools…' : savedPayrollCredential() ? 'Load Payroll' : 'Connect Tools';
            button.disabled = connecting;
        }
    }

    async function hashPayrollValue(value) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    async function connectTools() {
        if (connecting || !isPatriotPayrollPage()) return;
        connecting = true;
        refreshPayrollButton();
        let tab, pending;
        try {
            pending = GM_getValue(PAYROLL_PENDING_KEY, null);
            if (!pending || !/^pgi\.[A-Za-z0-9_-]{43}$/.test(pending.credential) ||
                !Number.isFinite(pending.createdAt) || Date.now() - pending.createdAt > 600000) {
                const bytes = crypto.getRandomValues(new Uint8Array(32));
                const credential = 'pgi.' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                pending = {credential, createdAt: Date.now()};
                GM_setValue(PAYROLL_PENDING_KEY, pending);
            }
            const connection = await payrollRequest(CONNECTION_URL, {credentialHash: await hashPayrollValue(pending.credential)});
            if (!/^[A-Za-z0-9_-]{32}$/.test(connection.requestId) || !Number.isFinite(Date.parse(connection.expiresAt))) {
                throw new PayrollImportError('Invalid connection response. Please try again.');
            }
            const code = (await hashPayrollValue(connection.requestId)).slice(0, 8).toUpperCase();
            const url = `${TOOLS_PAYROLL_URL}/connect?request=${encodeURIComponent(connection.requestId)}`;
            tab = GM_openInTab(url, {active: true, insert: true});
            showModal({title: 'Connect Tools', text: `Sign in and allow the connection in the Tools tab.\n\nConnection code: ${code.slice(0, 4)}-${code.slice(4)}\n\nCheck that the code matches. You can dismiss this message while waiting.`});
            // Poll once even after a tab closes: approval may have completed just before closing.
            while (true) {
                if (GM_getValue(PAYROLL_PENDING_KEY, null)?.credential !== pending.credential) return;
                const result = await payrollRequest(`${CONNECTION_URL}/status`, {requestId: connection.requestId}, `PayrollConnect ${pending.credential}`);
                if (GM_getValue(PAYROLL_PENDING_KEY, null)?.credential !== pending.credential) return;
                if (result.status === 'approved') {
                    GM_setValue(PAYROLL_AUTH_STORAGE_KEY, pending.credential);
                    GM_deleteValue(PAYROLL_PENDING_KEY);
                    tab?.close();
                    showModal({title: 'Tools connected', text: 'This browser will remember your authorization until you revoke it. Click Load Payroll to choose a week.'});
                    return;
                }
                if (result.status === 'denied') {
                    GM_deleteValue(PAYROLL_PENDING_KEY);
                    throw new PayrollImportError('Connection declined. No authorization was saved.');
                }
                if (result.status !== 'pending') throw new PayrollImportError('Unexpected connection status. Please try again.');
                if (Date.now() >= Date.parse(connection.expiresAt)) {
                    GM_deleteValue(PAYROLL_PENDING_KEY);
                    throw new PayrollImportError('Connection request expired. Click Connect Tools again.');
                }
                if (tab?.closed) throw new PayrollImportError('Connection window closed. Click Connect Tools to resume.');
                await new Promise((resolve) => setTimeout(resolve, 6000));
            }
        } catch (error) {
            if ([401, 404, 409, 410].includes(error.status) && GM_getValue(PAYROLL_PENDING_KEY, null)?.credential === pending?.credential) {
                GM_deleteValue(PAYROLL_PENDING_KEY);
            }
            showModal({title: 'Connection not completed', text: error instanceof PayrollImportError ? error.message : 'Unable to connect. Please try again.', isError: true});
        } finally {
            connecting = false;
            refreshPayrollButton();
        }
    }

    function openPayroll() {
        if (connecting) return;
        if (!savedPayrollCredential()) { void connectTools(); return; }
        showDateSelector(loadPayroll);
    }

    async function loadPayroll({startDate}) {
        if (importPending) return;
        if (!isPatriotPayrollPage()) return;
        const patriotId = currentPatriotId();
        if (!/^[A-Za-z0-9-]{1,45}$/.test(patriotId) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            showModal({title: 'Error', text: 'Select a valid payroll week and Patriot company.', isError: true});
            return;
        }

        importPending = true;
        try {
            const credential = savedPayrollCredential();
            if (!credential) { await connectTools(); return; }
            const payroll = await requestPayroll(credential, patriotId, startDate);
            if (!isPatriotPayrollPage() || currentPatriotId() !== patriotId) {
                throw new PayrollImportError('The Patriot company changed. Nothing was filled; select the payroll again.');
            }
            GM_setValue(PAYROLL_AUTH_STORAGE_KEY, credential);
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
        } catch (error) {
            // Never display raw transport errors: extensions can include request headers.
            showModal({title: 'Error', text: error instanceof PayrollImportError ? error.message : 'Payroll import failed. Please try again.', isError: true});
        } finally {
            importPending = false;
        }
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

        // 同时薪条目按来源顺序对应页面行；已占用行不可再次匹配。
        // 即使该行已有值也要占用，保证重复导入不会把同一条目填到下一行。
        const usedRows = new Set();

        // 按 summary 逐个 role 匹配 pay rate，并填 hours
        entries.forEach(([role, value]) => {
            const matchedRows = rows.filter((row) => {
                const rowPayRateStr = row.getAttribute('data-pay-rate');
                const rowPayRate = Math.round(parseFloat(rowPayRateStr || '0') * 100) / 100;
                const employeePayRate = Math.round((value.pay_rate || 0) * 100) / 100;
                return !usedRows.has(row) && rowPayRate === employeePayRate;
            });

            let rowMatchedForHours = false;

            for (const row of matchedRows) {
                if (rowMatchedForHours) break;

                const regularHourInput = row.querySelector('input[placeholder="Regular"]');
                const overtimeHourInput = row.querySelector('input[placeholder="Overtime"]');

                if (!regularHourInput && !overtimeHourInput) continue;
                usedRows.add(row);

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
        btn.addEventListener('click', openPayroll);
        document.body.appendChild(btn);
        refreshPayrollButton();
    }

    function setup() {
        GM_registerMenuCommand('Connect Tools / reconnect payroll', () => { void connectTools(); });
        GM_registerMenuCommand('Open Tools payroll authorizations', () => {
            GM_openInTab(TOOLS_PAYROLL_URL, {active: true, insert: true});
        });
        GM_registerMenuCommand('Forget payroll authorization on this browser', () => {
            GM_deleteValue(PAYROLL_AUTH_STORAGE_KEY);
            GM_deleteValue(PAYROLL_PENDING_KEY);
            refreshPayrollButton();
            showModal({title: 'Authorization removed locally', text: 'Click Connect Tools to reconnect. To revoke access everywhere, use your user menu > Authorizations in Tools.'});
        });
        injectStyles(); // 🆕 先注入样式
        createFloatingButton();

        // Ctrl+Shift+P 也能打开
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                openPayroll();
            }
        });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setup();
    } else {
        window.addEventListener('DOMContentLoaded', setup);
    }
})();
