/* ═══════════════════════════════════════════
   WATER METER APP — Logic & State v4
   app.js
   ═══════════════════════════════════════════ */

'use strict';

/* ── Config ── */
let HOUSES   = [];
let HOUSE_MAP = new Map();
const API_URL             = 'https://script.google.com/macros/s/AKfycbwDYBiYgoew9Cq1o6J0tSjO5Or8oWgUPqcswr6h0n3HDj76SVRKwRx8tlaxMw8k-a-b/exec';
const RATE_PER_UNIT       = 3;
const SERVICE_FEE         = 20;
const BOOTSTRAP_CACHE_KEY = 'wm_bootstrap_cache_v1';
const BOOTSTRAP_CACHE_TTL = 5 * 60 * 1000;

const VALID_USERS = [
  { username: 'admin', password: 'water1234', displayName: 'ผู้ดูแลระบบ' },
  { username: 'staff', password: '0000',      displayName: 'เจ้าหน้าที่' },
];
const SESSION_KEY = 'wm_session';

/* ── State ── */
let state = {
  selectedHouse:  null,
  selectedMeter:  0,
  currentReading: null,
  isValid:        false,
  paymentStatus:  'paid',
  historyItems:   [],
  historyFilter:  'all',      // 'all' | 'paid' | 'unpaid'  ← NEW
  selectedMonth:  '',         // 'YYYY-MM'  ← NEW
  currentUser:    null,
  editingItem:    null,       // history item being edited  ← NEW
  editingStatus: null,
};

let historyLoaded = false;
let rememberMe    = false;
let dom           = {};

/* ════════════════════════════════
   DOM REFS
════════════════════════════════ */
function buildDomRefs() {
  const $ = id => document.getElementById(id);
  dom = {
    loginScreen: $('loginScreen'), loginUsername: $('loginUsername'),
    loginPassword: $('loginPassword'), loginEyeBtn: $('loginEyeBtn'),
    eyeIconShow: $('eyeIconShow'), eyeIconHide: $('eyeIconHide'),
    rememberToggle: $('rememberToggle'), rememberThumb: $('rememberThumb'),
    loginError: $('loginError'), loginErrorText: $('loginErrorText'),
    loginBtn: $('loginBtn'), loginBtnLabel: $('loginBtnLabel'),

    appScreen: $('appScreen'), navInfoDate: $('navInfoDate'),
    navInfoUser: $('navInfoUser'), navAvatar: $('navAvatar'),

    /* Month + Stat */
    monthSelect:  $('monthSelect'),
    statTotal:    $('statTotal'),
    statPaid:     $('statPaid'),
    statUnpaid:   $('statUnpaid'),
    statPending:  $('statPending'),

    dropdownTrigger: $('dropdownTrigger'), dropdownChevron: $('dropdownChevron'),
    dropdownPanel: $('dropdownPanel'), dropdownSearch: $('dropdownSearch'),
    dropdownList: $('dropdownList'), dropdownDisplay: $('dropdownDisplay'),
    dropdownWrapper: $('dropdownWrapper'),

    houseInfoRow: $('houseInfoRow'), houseInfoName: $('houseInfoName'),
    changeHouseBtn: $('changeHouseBtn'),

    sectionMeter: $('sectionMeter'), sectionReadings: $('sectionReadings'),
    sectionCost: $('sectionCost'), segThumb: $('segThumb'), meterDesc: $('meterDesc'),

    prevDate: $('prevDate'), prevDigits: $('prevDigits'),
    todayDate: $('todayDate'), currentInput: $('currentMeterInput'), inputHint: $('inputHint'),

    unitsUsed: $('unitsUsed'), waterCost: $('waterCost'), totalAmount: $('totalAmount'),
    errorBox: $('errorBox'), errorText: $('errorText'),
    saveBtn: $('saveBtn'), saveBtnLabel: $('saveBtnLabel'),

    toast: $('successToast'), toastMsg: $('toastMsg'),
    sheetOverlay: $('sheetOverlay'), receiptSheet: $('receiptSheet'),
    lastSaveWarning: $('lastSaveWarning'), lastSavedDate: $('lastSavedDate'),
    payOptPaid: $('payOptPaid'), payOptUnpaid: $('payOptUnpaid'),

    historyOverlay: $('historyOverlay'), historySheet: $('historySheet'),
    historySearchInput: $('historySearchInput'),
    historyList: $('historyList'), historySummary: $('historySummary'),

    logoutOverlay: $('logoutOverlay'), logoutConfirm: $('logoutConfirm'),

    /* Edit payment */
    editPayOverlay: $('editPayOverlay'), editPaySheet: $('editPaySheet'),
    editPaySub: $('editPaySub'), editPayError: $('editPayError'),
    editPayErrorText: $('editPayErrorText'),
    editOptPaid: $('editOptPaid'), editOptUnpaid: $('editOptUnpaid'),
    editPaySaveBtn: $('editPaySaveBtn'),
  };
}

/* ════════════════════════════════
   MONTH DROPDOWN  (new)
════════════════════════════════ */
function buildMonthOptions() {
  const sel  = dom.monthSelect;
  const now  = new Date();
  const opts = [];

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
    opts.push(`<option value="${val}">${label}</option>`);
  }
  sel.innerHTML = opts.join('');
  state.selectedMonth = sel.value;
  refreshStatBar();
}

function onMonthChange() {
  state.selectedMonth = dom.monthSelect.value;
  refreshStatBar();
  // If history is open, re-render
  if (dom.historySheet.classList.contains('open')) {
    renderHistoryList(dom.historySearchInput.value);
  }
}

/* ════════════════════════════════
   STAT BAR  (new)
════════════════════════════════ */
function refreshStatBar() {
  const ym = state.selectedMonth;
  const total = HOUSES.length || 0;

  dom.statTotal.textContent = total;

  if (!ym || state.historyItems.length === 0) {
    dom.statPaid.textContent = 0;
    dom.statUnpaid.textContent = 0;
    dom.statPending.textContent = total;
    return;
  }

  const latestRows = getLatestHistoryRowsForMonth(state.historyItems, ym);

  const paid = latestRows.filter(
    row => row.item.payment_status !== 'unpaid'
  ).length;

  const unpaid = latestRows.filter(
    row => row.item.payment_status === 'unpaid'
  ).length;

  const pending = Math.max(0, total - paid - unpaid);

  dom.statPaid.textContent = paid;
  dom.statUnpaid.textContent = unpaid;
  dom.statPending.textContent = pending;
}

/* ════════════════════════════════
   LOGIN / LOGOUT
════════════════════════════════ */
function toggleRemember() {
  rememberMe = !rememberMe;
  dom.rememberToggle.classList.toggle('on', rememberMe);
}

function togglePassword() {
  const input  = dom.loginPassword;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  dom.eyeIconShow.style.display = isPass ? 'none' : '';
  dom.eyeIconHide.style.display = isPass ? '' : 'none';
}

function handleLogin() {
  const username = dom.loginUsername.value.trim();
  const password = dom.loginPassword.value;
  if (!username || !password) { showLoginError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'); return; }

  const user = VALID_USERS.find(u => u.username === username && u.password === password);
  if (!user) {
    showLoginError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    dom.loginBtnLabel.textContent = 'ไม่ถูกต้อง';
    setTimeout(() => { dom.loginBtnLabel.textContent = 'เข้าสู่ระบบ'; }, 1500);
    return;
  }

  dom.loginError.style.display = 'none';
  state.currentUser = { username: user.username, displayName: user.displayName };
  if (rememberMe) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(state.currentUser)); } catch (e) {} }
  enterApp(user.displayName);
}

function showLoginError(msg) {
  dom.loginErrorText.textContent = msg;
  dom.loginError.style.display   = 'flex';
}

function applyNavAvatarRole() {
  const u = state.currentUser?.username || '';
  dom.navAvatar.classList.remove('role-admin', 'role-staff', 'role-default');
  if (u === 'admin') { dom.navAvatar.textContent = 'A'; dom.navAvatar.classList.add('role-admin'); }
  else if (u === 'staff') { dom.navAvatar.textContent = 'S'; dom.navAvatar.classList.add('role-staff'); }
  else { dom.navAvatar.textContent = 'U'; dom.navAvatar.classList.add('role-default'); }
}

function enterApp(displayName) {
  dom.loginScreen.style.transition = 'opacity 0.4s';
  dom.loginScreen.style.opacity    = '0';

  setTimeout(() => {
    dom.loginScreen.style.display = 'none';
    dom.appScreen.style.display   = 'block';
    dom.navInfoDate.textContent   = formatDateTH(new Date());
    dom.navInfoUser.textContent   = displayName;
    applyNavAvatarRole();
    buildMonthOptions();

    loadHistory()
      .then(() => refreshStatBar())
      .catch(() => refreshStatBar());
  }, 400);
}

function handleLogout() {
  dom.logoutOverlay.classList.add('show');
  dom.logoutConfirm.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cancelLogout() {
  dom.logoutOverlay.classList.remove('show');
  dom.logoutConfirm.classList.remove('open');
  document.body.style.overflow = '';
}
function confirmLogout() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  try { sessionStorage.removeItem(BOOTSTRAP_CACHE_KEY); } catch (e) {}
  state.currentUser = null;
  cancelLogout();

  dom.appScreen.style.display  = 'none';
  dom.loginScreen.style.opacity = '0';
  dom.loginScreen.style.display = 'flex';
  requestAnimationFrame(() => {
    dom.loginScreen.style.transition = 'opacity 0.35s';
    dom.loginScreen.style.opacity    = '1';
  });
  dom.loginUsername.value = '';
  dom.loginPassword.value = '';
  dom.loginError.style.display = 'none';
  rememberMe = false;
  dom.rememberToggle.classList.remove('on');
  dom.navAvatar.textContent = 'A';
  dom.navAvatar.classList.remove('role-admin', 'role-staff', 'role-default');
}

function checkSavedSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      const user = JSON.parse(saved);
      if (user && user.displayName) {
        state.currentUser = user;
        dom.loginUsername.value = user.username || '';
        rememberMe = true;
        dom.rememberToggle.classList.add('on');
        enterApp(user.displayName);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function saveBootstrapCache(data) {
  try { sessionStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify({ ts: Date.now(), houses: data })); } catch (e) {}
}
function loadBootstrapCache() {
  try {
    const raw = sessionStorage.getItem(BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.houses)) return null;
    if ((Date.now() - Number(p.ts || 0)) > BOOTSTRAP_CACHE_TTL) return null;
    return p.houses;
  } catch (e) { return null; }
}

/* ════════════════════════════════
   HISTORY helpers
════════════════════════════════ */
function openHistorySheetAndLoad() { openHistorySheet(); loadHistory(); }

function getHouseMetersForPending(house) {
  if (Array.isArray(house.meters) && house.meters.length > 0) {
    return house.meters.map((m, index) => ({
      key: String(m.meterKey || m.meter_key || m.id || `meter${index + 1}`),
      label: m.label || `มิเตอร์ ${index + 1}`,
      shortLabel: `ม.${index + 1}`,
    }));
  }

  return [{
    key: String(house.meter_key || house.meterKey || 'meter1'),
    label: 'มิเตอร์ 1',
    shortLabel: 'ม.1',
  }];
}

function getItemMonthKey(item) {
  if (!item || !item.read_date) return '';

  const d = new Date(item.read_date);
  if (isNaN(d.getTime())) return '';

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getPendingMeterLabelsForHouse(house) {
  const ym = state.selectedMonth;
  if (!ym || !house) return [];

  const meters = getHouseMetersForPending(house);

  const monthItems = state.historyItems.filter(item => {
    const itemHouseKey = String(item.house_id || item.house_no || '');
    const houseKey1 = String(house.id || '');
    const houseKey2 = String(house.num || '');

    const sameHouse = itemHouseKey === houseKey1 || itemHouseKey === houseKey2;
    const sameMonth = getItemMonthKey(item) === ym;

    return sameHouse && sameMonth;
  });

  const recordedMeterKeys = new Set(
    monthItems.map(item => String(item.meter_key || item.meterKey || item.meter_id || 'meter1'))
  );

  return meters
    .filter(meter => !recordedMeterKeys.has(meter.key))
    .map(meter => meters.length > 1 ? meter.shortLabel : '');
}

/* ════════════════════════════════
   DROPDOWN
════════════════════════════════ */
function renderList(query = '') {
  const q = query.trim().toLowerCase();
  const filtered = HOUSES.filter(h =>
    (h.num || '').toLowerCase().includes(q) || (h.name || '').toLowerCase().includes(q)
  );
  if (filtered.length === 0) {
    dom.dropdownList.innerHTML = `<li class="dropdown-empty">ไม่พบข้อมูล</li>`;
    return;
  }
  dom.dropdownList.innerHTML = filtered.map(h => {
    const pendingMeters = getPendingMeterLabelsForHouse(h);

    let pendingBadge = '';
    if (pendingMeters.length > 0) {
      const label = pendingMeters.filter(Boolean).join(', ');
      pendingBadge = `
        <span class="li-pending-badge">
          ยังไม่บันทึก${label ? ` ${label}` : ''}
        </span>
      `;
    }

    return `
      <li data-id="${h.id}" class="${state.selectedHouse?.id === h.id ? 'selected' : ''}" onclick="pickHouse('${h.id}')">
        <span class="li-num">${h.num}</span>
        <span class="li-name">${h.name}</span>
        ${pendingBadge}
        <svg class="li-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </li>
    `;
  }).join('');
}

function openDropdown() {
  dom.dropdownPanel.classList.add('open');
  dom.dropdownChevron.classList.add('open');
  renderList();
  setTimeout(() => dom.dropdownSearch.focus(), 50);
}
function closeDropdown() {
  dom.dropdownPanel.classList.remove('open');
  dom.dropdownChevron.classList.remove('open');
  dom.dropdownSearch.value = '';
}

function pickHouse(id) {
  const house = HOUSE_MAP.get(String(id));
  if (!house) return;

  if (!Array.isArray(house.meters) || house.meters.length === 0) {
    house.meters = [{
      id: 'm1', label: 'มิเตอร์ 1',
      desc: `หมายเลข ${house.meter_no || house.meterNo || 'M-???'}`,
      meterKey: house.meter_key || house.meterKey || 'meter1',
      prev: Number(house.prev_reading ?? house.prevReading ?? 0),
      prevDate: house.prev_date || house.prevDate || null,
    }];
  }

  state.selectedHouse  = house;
  state.selectedMeter  = 0;
  state.currentReading = null;
  state.isValid        = false;

  dom.dropdownDisplay.textContent = `${house.num} · ${house.name}`;
  dom.dropdownDisplay.classList.add('selected');
  dom.houseInfoName.textContent   = `${house.num} — ${house.name}`;
  dom.houseInfoRow.style.display  = 'flex';
  closeDropdown();

  showSection(dom.sectionMeter);
  showSection(dom.sectionReadings);
  showSection(dom.sectionCost);

  dom.currentInput.value      = '';
  dom.inputHint.style.display = 'none';
  dom.saveBtn.disabled        = true;
  dom.errorBox.style.display  = 'none';

  updateMeterSelectorUI();
  refreshMeterView();
  resetCostDisplay();
  dom.todayDate.textContent = formatDateTH(new Date());
  selectPayment('paid');
}

function bindMainEvents() {
  dom.dropdownTrigger.addEventListener('click', e => {
    e.stopPropagation();
    dom.dropdownPanel.classList.contains('open') ? closeDropdown() : openDropdown();
  });
  dom.dropdownSearch.addEventListener('input', e => renderList(e.target.value));
  dom.dropdownSearch.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', e => { if (!dom.dropdownWrapper.contains(e.target)) closeDropdown(); });

  dom.changeHouseBtn.addEventListener('click', () => {
    dom.dropdownDisplay.textContent = 'เลือกเลขที่บ้าน...';
    dom.dropdownDisplay.classList.remove('selected');
    dom.houseInfoRow.style.display = 'none';
    state.selectedHouse = null; state.currentReading = null;
    hideSection(dom.sectionMeter); hideSection(dom.sectionReadings); hideSection(dom.sectionCost);
    if (dom.lastSavedDate) dom.lastSavedDate.textContent = '—';
    if (dom.lastSaveWarning) dom.lastSaveWarning.style.display = 'none';
    dom.currentInput.value = ''; dom.segThumb.style.transform = 'translateX(0)';
    document.querySelectorAll('.seg-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0); btn.disabled = false; btn.classList.remove('disabled');
    });
    openDropdown();
  });

  if (dom.historySearchInput) {
    dom.historySearchInput.addEventListener('input', () => renderHistoryList(dom.historySearchInput.value));
  }
  dom.loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  dom.loginUsername.addEventListener('keydown', e => { if (e.key === 'Enter') dom.loginPassword.focus(); });
}

/* ── Meter helpers ── */
function hasSecondMeter() {
  return !!(state.selectedHouse && Array.isArray(state.selectedHouse.meters) && state.selectedHouse.meters.length > 1);
}
function updateMeterSelectorUI() {
  const segBtns = document.querySelectorAll('.seg-btn');
  const canUse2 = hasSecondMeter();
  if (segBtns[1]) { segBtns[1].disabled = !canUse2; segBtns[1].classList.toggle('disabled', !canUse2); }
  if (!canUse2) {
    state.selectedMeter = 0; dom.segThumb.style.transform = 'translateX(0)';
    segBtns.forEach((btn, i) => btn.classList.toggle('active', i === 0));
  }
}

/* ════════════════════════════════
   METER SELECTOR
════════════════════════════════ */
function selectMeter(num) {
  const idx = num - 1;
  if (!state.selectedHouse) return;
  if (idx === 1 && !hasSecondMeter()) return;
  state.selectedMeter = idx; state.currentReading = null;
  dom.segThumb.style.transform = idx === 0 ? 'translateX(0)' : 'translateX(100%)';
  document.querySelectorAll('.seg-btn').forEach((btn, i) => btn.classList.toggle('active', i === idx));
  dom.currentInput.value = ''; dom.inputHint.style.display = 'none';
  dom.saveBtn.disabled = true; dom.errorBox.style.display = 'none';
  refreshMeterView(); resetCostDisplay();
}

function refreshMeterView() {
  if (!state.selectedHouse) return;
  const meter = state.selectedHouse.meters[state.selectedMeter];
  if (!meter) return;
  const dd = formatDisplayDate(meter.prevDate);
  dom.prevDigits.textContent = formatMeterDigits(meter.prev);
  dom.prevDate.textContent   = dd;
  dom.meterDesc.textContent  = meter.desc || '';
  if (meter.prevDate) { dom.lastSavedDate.textContent = dd; dom.lastSaveWarning.style.display = 'block'; }
  else { dom.lastSavedDate.textContent = '—'; dom.lastSaveWarning.style.display = 'none'; }
}

/* ════════════════════════════════
   METER INPUT
════════════════════════════════ */
function onMeterInput() {
  const raw   = dom.currentInput.value.replace(/\D/g, '');
  dom.currentInput.value = raw;
  const val   = raw === '' ? NaN : Number(raw);
  const meter = state.selectedHouse?.meters?.[state.selectedMeter];
  if (!meter) return;
  dom.errorBox.style.display = 'none';
  if (raw === '' || isNaN(val)) {
    state.isValid = false; state.currentReading = null;
    dom.inputHint.style.display = 'none'; dom.saveBtn.disabled = true; resetCostDisplay(); return;
  }
  if (val < meter.prev) {
    state.isValid = false; state.currentReading = null;
    dom.inputHint.className   = 'input-hint err';
    dom.inputHint.textContent = `⚠️ ต้องมากกว่ายอดก่อนหน้า (${Number(meter.prev).toLocaleString()})`;
    dom.inputHint.style.display = 'block'; dom.saveBtn.disabled = true; resetCostDisplay(); return;
  }
  state.isValid = true; state.currentReading = val;
  const units = val - meter.prev;
  dom.inputHint.className   = 'input-hint ok';
  dom.inputHint.textContent = units === 0 ? `✓ ไม่มีการใช้น้ำ (0 หน่วย)` : `✓ ใช้ไป ${units.toLocaleString()} หน่วย`;
  dom.inputHint.style.display = 'block'; dom.saveBtn.disabled = false;
  updateCostDisplay(meter.prev, val);
}

/* ════════════════════════════════
   COST
════════════════════════════════ */
function updateCostDisplay(prev, curr) {
  const units = curr - prev, water = units * RATE_PER_UNIT, total = water + SERVICE_FEE;
  dom.unitsUsed.textContent   = `${units.toLocaleString()} หน่วย`;
  dom.waterCost.textContent   = `${water.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
  dom.totalAmount.textContent = `${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
}
function resetCostDisplay() {
  dom.unitsUsed.textContent = '— หน่วย'; dom.waterCost.textContent = '— บาท'; dom.totalAmount.textContent = '—';
}

/* ════════════════════════════════
   PAYMENT STATUS
════════════════════════════════ */
function selectPayment(status) {
  state.paymentStatus = status;
  dom.payOptPaid.classList.toggle('active',   status === 'paid');
  dom.payOptUnpaid.classList.toggle('active', status === 'unpaid');
  if (status === 'paid') { dom.saveBtnLabel.textContent = 'บันทึก + ออกใบเสร็จ'; dom.saveBtn.classList.remove('unpaid-mode'); }
  else { dom.saveBtnLabel.textContent = 'บันทึกยอดมิเตอร์'; dom.saveBtn.classList.add('unpaid-mode'); }
}

/* ════════════════════════════════
   SAVE
════════════════════════════════ */
async function handleSave() {
  if (!state.isValid || !state.selectedHouse) return;
  const house = state.selectedHouse;
  const meter = house.meters?.[state.selectedMeter];
  if (!meter) { dom.errorText.textContent = 'ไม่พบข้อมูลมิเตอร์'; dom.errorBox.style.display = 'flex'; return; }

  const curr = state.currentReading, isPaid = state.paymentStatus === 'paid';
  dom.saveBtn.disabled = true; dom.errorBox.style.display = 'none';

  try {
    const res  = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveReading',
        house_id: house.id,
        meter_key: meter.meterKey || meter.id || 'meter1',
        current_reading: curr,
        payment_status: state.paymentStatus,
        reader_name: state.currentUser?.displayName || 'เจ้าหน้าที่',
      })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'บันทึกไม่สำเร็จ');

    const saved = json.data;
    meter.prev = saved.current_reading; meter.prevDate = saved.read_date;
    state.currentReading = null; state.isValid = false;
    dom.currentInput.value = ''; dom.inputHint.style.display = 'none';
    refreshMeterView(); resetCostDisplay();

    // Reload history first, then refresh stat
    await loadHistory(true);
    refreshStatBar();

    if (isPaid) { populateReceipt(house, meter, saved); showToast('บันทึก + ออกใบเสร็จสำเร็จ!'); setTimeout(() => openSheet(), 600); }
    else { showToast('บันทึกสำเร็จ (ยังไม่ชำระ)'); }
  } catch (err) {
    dom.errorText.textContent = err.message || 'เกิดข้อผิดพลาด'; dom.errorBox.style.display = 'flex';
  } finally { dom.saveBtn.disabled = false; }
}

/* ════════════════════════════════
   RECEIPT
════════════════════════════════ */
function populateReceipt(house, meter, saved) {
  document.getElementById('rNo').textContent    = `ใบเสร็จ #${saved.receipt_no}`;
  document.getElementById('rName').textContent  = house.name;
  document.getElementById('rAddr').textContent  = house.addr || house.address || house.num;
    const addrEl = document.getElementById('rAddr');
    addrEl.textContent = house.addr || house.address || house.num || '---';
    addrEl.classList.add('long-text');
  document.getElementById('rMeter').textContent = meter.label || 'มิเตอร์ 1';
  document.getElementById('rMonth').textContent = formatMonthTH(new Date(saved.read_date));
  document.getElementById('rDate').textContent  = formatDateTH(new Date(saved.read_date));
  document.getElementById('rPrev').textContent  = Number(saved.prev_reading).toLocaleString();
  document.getElementById('rCurr').textContent  = Number(saved.current_reading).toLocaleString();
  document.getElementById('rUnits').textContent = Number(saved.units_used).toLocaleString();
  document.getElementById('rWater').textContent = `${Number(saved.water_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
  document.getElementById('rTotal').textContent = `${Number(saved.total_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
}

function openSheet()  { dom.sheetOverlay.classList.add('show');    dom.receiptSheet.classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeSheet() { dom.sheetOverlay.classList.remove('show'); dom.receiptSheet.classList.remove('open'); document.body.style.overflow = ''; }
function printReceipt() { window.print(); }

/* ════════════════════════════════
   TOAST
════════════════════════════════ */
function showToast(msg = 'บันทึกสำเร็จ!') {
  dom.toastMsg.textContent = msg;
  dom.toast.classList.add('show');
  setTimeout(() => dom.toast.classList.remove('show'), 2800);
}

/* ════════════════════════════════
   HISTORY  (updated)
════════════════════════════════ */
async function loadHistory(force = false) {
  if (historyLoaded && !force) {
    renderHistoryList(dom.historySearchInput.value);
    return;
  }

  try {
    dom.historySummary.textContent = 'กำลังโหลดข้อมูล...';
    const res = await fetch(`${API_URL}?action=history&month=${state.selectedMonth}&limit=100`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'โหลดประวัติไม่สำเร็จ');

    state.historyItems = Array.isArray(json.items) ? json.items : [];
    historyLoaded = true;
    refreshStatBar();
    renderHistoryList(dom.historySearchInput.value);

  } catch (err) {
    state.historyItems = [];
    historyLoaded = false;
    refreshStatBar();
    dom.historySummary.textContent = 'โหลดข้อมูลไม่สำเร็จ';
    dom.historyList.innerHTML = `<div class="history-empty">${err.message || 'เกิดข้อผิดพลาด'}</div>`;
  }
}

function refreshHistory() { historyLoaded = false; loadHistory(true); }

function getHistoryDate(item) {
  if (!item || !item.read_date) return null;

  const d = new Date(item.read_date);
  return isNaN(d.getTime()) ? null : d;
}

function getHistoryYM(item) {
  const d = getHistoryDate(item);
  if (!d) return '';

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getLatestHistoryRowsForMonth(items, ym) {
  const rows = items
    .map((item, realIdx) => ({
      item,
      realIdx,
      date: getHistoryDate(item),
    }))
    .filter(row => {
      if (!row.date) return false;
      if (!ym) return true;
      return getHistoryYM(row.item) === ym;
    })
    .sort((a, b) => b.date - a.date);

  const latestByHouse = new Map();

  rows.forEach(row => {
    const key = row.item.house_id || row.item.house_no;
    if (!latestByHouse.has(key)) {
      latestByHouse.set(key, row);
    }
  });

  return [...latestByHouse.values()];
}

/* Filter chip handler */
function setHistoryFilter(f) {
  state.historyFilter = f;
  document.querySelectorAll('.hfilter-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === f);
  });
  renderHistoryList(dom.historySearchInput.value);
}

function renderHistoryList(query = '') {
  const q  = String(query || '').trim().toLowerCase();
  const ym = state.selectedMonth;
  const f  = state.historyFilter;

  const filteredItems = getLatestHistoryRowsForMonth(state.historyItems, ym)
  .filter(({ item }) => {
      const matchQ = !q ||
        String(item.house_no || '').toLowerCase().includes(q) ||
        String(item.owner_name || '').toLowerCase().includes(q);

      const matchF = f === 'all' ? true :
        f === 'paid'   ? item.payment_status !== 'unpaid' :
        f === 'unpaid' ? item.payment_status === 'unpaid' : true;

  return matchQ && matchF;
  });

  dom.historySummary.textContent = `แสดง ${filteredItems.length.toLocaleString()} รายการ`;

  if (filteredItems.length === 0) {
    dom.historyList.innerHTML = `<div class="history-empty">ไม่พบข้อมูลย้อนหลัง</div>`;
    return;
  }

  dom.historyList.innerHTML = filteredItems.map(({ item, realIdx }, idx) => {
    const paidClass = item.payment_status === 'unpaid' ? 'unpaid' : 'paid';
    const paidLabel = item.payment_status === 'unpaid' ? 'ค้างชำระ' : 'ชำระแล้ว';
    return `
        <div class="history-item-outer" id="hio-${idx}">
          <div class="history-item-action" onclick="openEditPaySheetById('${item.reading_id || ''}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            แก้ไข
          </div>

          <div class="history-item" id="hi-${idx}" data-idx="${realIdx}"
            ontouchstart="swipeStart(event,${idx})"
            ontouchmove="swipeMove(event,${idx})"
            ontouchend="swipeEnd(event,${idx})">
            <div class="history-top">
              <div>
                <div class="history-house">${item.house_no || '-'} · ${item.meter_label || '-'}</div>
                <div class="history-name">${item.owner_name || '-'}</div>
              </div>

              <div class="history-top-right">
                <span class="history-badge ${paidClass}">${paidLabel}</span>
                <button
                  type="button"
                  class="history-edit-btn"
                  onclick="event.stopPropagation(); openEditPaySheetById('${item.reading_id || ''}')"
                >
                  ✏️ แก้ไข
                </button>
              </div>
            </div>
          <div class="history-meta">
            <div>วันที่จด: <strong>${formatDisplayDate(item.read_date)}</strong></div>
            <div>เลขมิเตอร์: <strong>${item.meter_code || '-'}</strong></div>
            <div>ยอดก่อน: <strong>${Number(item.prev_reading || 0).toLocaleString()}</strong></div>
            <div>ยอดใหม่: <strong>${Number(item.current_reading || 0).toLocaleString()}</strong></div>
            <div>ใช้ไป: <strong>${Number(item.units_used || 0).toLocaleString()} หน่วย</strong></div>
            <div>ผู้จด: <strong>${item.reader_name || '-'}</strong></div>
          </div>
          <div class="history-total">
            <span class="history-total-label">ยอดรวม</span>
            <span class="history-total-value">${Number(item.total_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span>
          </div>
        </div>
      </div>`;
  }).join('');

  // Close any open swipe when tapping elsewhere
  dom.historyList.addEventListener('click', collapseAllSwipes, { once: true });
}

function editHistoryItem(readingId) {
  const item = state.historyItems.find(
    x => String(x.reading_id || '') === String(readingId || '')
  );

  if (!item) {
    showToast('ไม่พบรายการที่ต้องการแก้ไข');
    return;
  }

  showToast(`เลือกแก้ไขรายการ ${item.house_no || '-'} ${item.meter_label || ''}`);
  console.log('edit item =', item);
}

/* ════════════════════════════════
   SWIPE TO EDIT  (new)
════════════════════════════════ */
let swipeData = { idx: null, startX: 0, startY: 0, dx: 0, tracking: false };
const SWIPE_THRESHOLD = 40; // px

function swipeStart(e, idx) {
  const t = e.touches[0];
  swipeData = { idx, startX: t.clientX, startY: t.clientY, dx: 0, tracking: true };
}

function swipeMove(e, idx) {
  if (!swipeData.tracking || swipeData.idx !== idx) return;
  const t  = e.touches[0];
  const dx = t.clientX - swipeData.startX;
  const dy = t.clientY - swipeData.startY;

  // Cancel if vertical scroll
  if (Math.abs(dy) > Math.abs(dx) + 8) { swipeData.tracking = false; return; }

  swipeData.dx = dx;
  const el = document.getElementById(`hi-${idx}`);
  if (!el) return;

  const isSwiped = el.classList.contains('swiped');
  let offset = isSwiped ? -72 + dx : dx;
  offset = Math.max(-72, Math.min(0, offset));
  el.style.transition = 'none';
  el.style.transform  = `translateX(${offset}px)`;
  e.preventDefault();
}

function swipeEnd(e, idx) {
  if (!swipeData.tracking || swipeData.idx !== idx) return;
  swipeData.tracking = false;
  const el = document.getElementById(`hi-${idx}`);
  if (!el) return;
  el.style.transition = '';

  const isSwiped = el.classList.contains('swiped');
  if (!isSwiped && swipeData.dx < -SWIPE_THRESHOLD) {
    el.classList.add('swiped');
    el.style.transform = '';
  } else if (isSwiped && swipeData.dx > SWIPE_THRESHOLD) {
    el.classList.remove('swiped');
    el.style.transform = '';
  } else {
    el.style.transform = isSwiped ? 'translateX(-72px)' : '';
  }
}

function collapseAllSwipes() {
  document.querySelectorAll('.history-item.swiped').forEach(el => {
    el.classList.remove('swiped');
    el.style.transform = '';
  });
}

/* ════════════════════════════════
   EDIT PAYMENT SHEET  (new)
════════════════════════════════ */
function openEditPaySheet(idx) {
  const cards = dom.historyList.querySelectorAll('.history-item');
  const card  = cards[idx];
  const realIdx = card ? parseInt(card.dataset.idx, 10) : -1;
  const item = realIdx >= 0 ? state.historyItems[realIdx] : null;

  if (!item) return;

  state.editingItem = item;
  const isPaid = item.payment_status !== 'unpaid';
  state.editingStatus = isPaid ? 'paid' : 'unpaid';

  dom.editPaySub.textContent = `${item.house_no || '-'} · ${item.owner_name || '-'}`;
  dom.editPayError.style.display = 'none';

  dom.editOptPaid.classList.toggle('active-paid', isPaid);
  dom.editOptUnpaid.classList.toggle('active-unpaid', !isPaid);

  dom.editPayOverlay.classList.add('show');
  dom.editPaySheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeEditPaySheet() {
  dom.editPayOverlay.classList.remove('show');
  dom.editPaySheet.classList.remove('open');
  document.body.style.overflow = '';
  state.editingItem = null;
  state.editingStatus = null;
  collapseAllSwipes();
}

function selectEditPaymentStatus(status) {
  state.editingStatus = status;

  dom.editOptPaid.classList.toggle('active-paid', status === 'paid');
  dom.editOptUnpaid.classList.toggle('active-unpaid', status === 'unpaid');

  dom.editPayError.style.display = 'none';
}

function saveEditPayment() {
  if (!state.editingItem) return;
  submitEditPayment(state.editingStatus || 'paid');
}

async function submitEditPayment(newStatus) {
  const item = state.editingItem;
  if (!item) return;

  // เช็คว่าสถานะเดิมเป็นค้างชำระ แล้วเปลี่ยนเป็นชำระแล้วหรือไม่
  const oldStatus = item.payment_status === 'unpaid' ? 'unpaid' : 'paid';
  const shouldShowReceipt = oldStatus === 'unpaid' && newStatus === 'paid';

  dom.editOptPaid.classList.toggle('active-paid', newStatus === 'paid');
  dom.editOptUnpaid.classList.toggle('active-unpaid', newStatus === 'unpaid');
  dom.editPayError.style.display = 'none';

  if (dom.editPaySaveBtn) {
    dom.editPaySaveBtn.disabled = true;
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updatePaymentStatus',
        reading_id: item.reading_id,
        payment_status: newStatus,
        editor_name: state.currentUser?.displayName || 'เจ้าหน้าที่',
      })
    });

    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'อัปเดตไม่สำเร็จ');

    // ถ้า Apps Script ส่งข้อมูลกลับมา ให้รวมข้อมูลกลับเข้ารายการเดิม
    const updatedData = json.data || json.item || {};
    Object.assign(item, updatedData);

    // อัปเดตสถานะในหน้าจอ
    item.payment_status = newStatus;
    historyLoaded = false;
    refreshStatBar();
    renderHistoryList(dom.historySearchInput.value);

    const msg = newStatus === 'paid'
      ? '✅ อัปเดตเป็นชำระแล้ว'
      : '🕐 อัปเดตเป็นยังไม่ชำระ';

    showToast(msg);

    // ถ้าเปลี่ยนจากค้างชำระ → ชำระแล้ว ให้เด้งใบเสร็จ
    if (shouldShowReceipt) {
      const receiptHouse = {
        name: item.owner_name || item.name || '-',
        num: item.house_no || item.addr || '-',
        addr: item.house_no || item.addr || '-',
        address: item.house_no || item.address || '-',
      };

      const receiptMeter = {
        label: item.meter_label || item.meter_key || 'มิเตอร์ 1',
      };

      const receiptSaved = {
        receipt_no: item.receipt_no || updatedData.receipt_no || item.reading_id || '---',
        read_date: item.read_date || new Date().toISOString(),
        payment_status: 'paid',
        prev_reading: item.prev_reading,
        current_reading: item.current_reading,
        units_used: item.units_used,
        water_cost: item.water_cost,
        total_amount: item.total_amount,
      };

      closeEditPaySheet();
      closeHistorySheet();

      populateReceipt(receiptHouse, receiptMeter, receiptSaved);

      setTimeout(() => {
        openSheet();
      }, 180);

    } else {
      closeEditPaySheet();
    }

  } catch (err) {
    dom.editPayErrorText.textContent = err.message || 'เกิดข้อผิดพลาด';
    dom.editPayError.style.display = 'flex';

  } finally {
    if (dom.editPaySaveBtn) {
      dom.editPaySaveBtn.disabled = false;
    }

    state.editingStatus = null;
  }
}

function openHistorySheet()  { dom.historyOverlay.classList.add('show');    dom.historySheet.classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeHistorySheet() { dom.historyOverlay.classList.remove('show'); dom.historySheet.classList.remove('open'); document.body.style.overflow = ''; }

/* ════════════════════════════════
   UI HELPERS
════════════════════════════════ */
function showSection(el) { if (!el) return; el.style.display = 'block'; el.style.animation = 'cardIn 0.35s cubic-bezier(0.22,1,0.36,1) both'; }
function hideSection(el) { if (el) el.style.display = 'none'; }
function formatMeterDigits(n) { return String(Number(n)).split('').join(' '); }
function formatDateTH(d) {
  if (!(d instanceof Date) || isNaN(d)) return '—';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
function formatDisplayDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? String(value) : formatDateTH(d);
}
function formatMonthTH(d) {
  if (!(d instanceof Date) || isNaN(d)) return '—';
  return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

/* ════════════════════════════════
   INIT
════════════════════════════════ */
(async function init() {
  buildDomRefs();
  bindMainEvents();
  dom.todayDate.textContent = formatDateTH(new Date());

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheet(); closeHistorySheet(); cancelLogout(); closeEditPaySheet(); }
  });

  const autoLogged = checkSavedSession();
  if (autoLogged) {
  loadBootstrap(true)
    .then(() => loadHistory(true))
    .then(() => refreshStatBar())
    .catch(err => console.error('[bootstrap]', err));
  }
})();

const _enterApp = enterApp;
window.enterApp = function(displayName) {
  _enterApp(displayName);
  buildMonthOptions();
  loadBootstrap(false)
  .then(() => loadHistory(false))
  .then(() => refreshStatBar())
  .catch(() => refreshStatBar());
};

async function loadBootstrap(force = false) {
  if (!force) {
    try {
    } catch (e) {}

    const cached = loadBootstrapCache();
    if (cached) {
      HOUSES = cached;
      HOUSE_MAP = new Map(HOUSES.map(h => [String(h.id), h]));
      renderList();
      refreshStatBar();
      return;
    }
  }
  const res  = await fetch(`${API_URL}?action=bootstrap`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'โหลดข้อมูลไม่สำเร็จ');
  HOUSES = Array.isArray(json.houses) ? json.houses : [];
  HOUSE_MAP = new Map(HOUSES.map(h => [String(h.id), h]));
  saveBootstrapCache(HOUSES);
  renderList();
  refreshStatBar();
}

function openEditPaySheetById(readingId) {
  const item = state.historyItems.find(
    x => String(x.reading_id || '') === String(readingId || '')
  );

  if (!item) return;

  state.editingItem = item;
  const isPaid = item.payment_status !== 'unpaid';
  state.editingStatus = isPaid ? 'paid' : 'unpaid';

  dom.editPaySub.textContent = `${item.house_no || '-'} · ${item.owner_name || '-'}`;
  dom.editPayError.style.display = 'none';

  dom.editOptPaid.classList.toggle('active-paid', isPaid);
  dom.editOptUnpaid.classList.toggle('active-unpaid', !isPaid);

  dom.editPayOverlay.classList.add('show');
  dom.editPaySheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

/* ════════════════════════════════
RECEIPT & QR CODE HELPERS
════════════════════════════════ */

// อัปเดตข้อมูลใบเสร็จ (แทนที่ populateReceipt เดิม)
function populateReceipt(house, meter, saved) {
  document.getElementById('rNo').textContent    = `ใบเสร็จ #${saved.receipt_no || '---'}`;
  document.getElementById('rDate').textContent  = `วันที่: ${formatDateTH(new Date(saved.read_date))}`;
  document.getElementById('rName').textContent  = house.name || '---';
  document.getElementById('rAddr').textContent  = house.addr || house.address || house.num || '---';
  document.getElementById('rMeter').textContent = meter.label || 'มิเตอร์ 1';
  document.getElementById('rMonth').textContent = formatMonthTH(new Date(saved.read_date));
  document.getElementById('rPrev').textContent  = Number(saved.prev_reading || 0).toLocaleString();
  document.getElementById('rCurr').textContent  = Number(saved.current_reading || 0).toLocaleString();
  document.getElementById('rUnits').textContent = Number(saved.units_used || 0).toLocaleString();
  document.getElementById('rWater').textContent = `${Number(saved.water_cost || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`;
  document.getElementById('rTotal').textContent = `${Number(saved.total_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`;
  
  // สถานะ
  const statusEl = document.getElementById('rStatus');
  if (saved.payment_status === 'unpaid') {
    statusEl.className = 'receipt-status unpaid';
    statusEl.textContent = '🕐 ยังไม่ชำระ';
  } else {
    statusEl.className = 'receipt-status paid';
    statusEl.textContent = '✅ ชำระแล้ว';
  }

  // ซ่อน QR ถ้ายังไม่ได้ตั้งค่า (หรือแสดงเมื่อพร้อม)
  updateQrDisplay(saved.payment_status === 'paid', saved.total_amount);
}

// จัดการแสดงผล QR Code
function updateQrDisplay(isPaid, amount) {
  const qrEl = document.getElementById('rQrCode');
  if (!isPaid) {
    qrEl.innerHTML = `
      <div class="qr-icon">💳</div>
      <div class="qr-text">ชำระเงินที่สำนักงาน</div>
      <div class="qr-sub">หรือสแกนพร้อมเพย์</div>
    `;
    return;
  }
  
  // Placeholder สำหรับ PromptPay ในอนาคต
  // เมื่อมี API หรือเลขพร้อมเพย์ ให้แทนที่ตรงนี้
  qrEl.innerHTML = `
    <div class="qr-icon">📱</div>
    <div class="qr-text">สแกนเพื่อชำระเงิน</div>
    <div class="qr-sub">พร้อมเพย์ (PromptPay)</div>
    ${amount ? `<div class="qr-amount" style="font-size:10px;font-weight:700;margin-top:4px">${Number(amount).toLocaleString()} ฿</div>` : ''}
  `;
}

// ฟังก์ชันเตรียมสร้าง QR PromptPay (สำหรับใช้ในอนาคต)
// ต้องเพิ่มไลบรารีเช่น qrcode.min.js หรือใช้ API ภายนอก
function generatePromptPayQR(phone, amount, callback) {
  // ตัวอย่าง: ใช้ API ของธนาคารหรือไลบรารีสร้าง QR
  // const qrData = createPromptPayPayload(phone, amount);
  // QRCode.toCanvas(document.getElementById('rQrCode'), qrData, callback);
  console.log('📱 PromptPay QR: โทรศัพท์=' + phone + ', จำนวน=' + amount);
}

// พิมพ์ใบเสร็จ
function printReceipt() {
  // iOS/Android Bluetooth Printers รองรับการพิมพ์ผ่าน window.print()
  window.print();
}