/* ═══════════════════════════════════════════
   WATER METER APP — Logic & State v4
   app.js
   ═══════════════════════════════════════════ */

'use strict';

/* ── Config ── */
let HOUSES   = [];
let HOUSE_MAP = new Map();
const APP_CONFIG = {
  appTitle: 'ระบบประปา',
  loginTitle: 'ระบบบันทึกมิเตอร์ประปาหมู่บ้าน',
  orgName: 'การประปาหมู่บ้านแสนสุข',
  villageName: 'บ้านแสนสุข หมู่ 4',
  contact: '0XX-XXX-XXXX',

  bankName: 'ธนาคารกรุงไทย',
  bankAccountNo: '519-0-58775-4',
  bankAccountName: 'กองทุนประปาป่าบ้านไผ่หมู่ 8',

  ratePerUnit: 3,
  serviceFee: 0,

  apiUrl: 'https://script.google.com/macros/s/AKfycbwDYBiYgoew9Cq1o6J0tSjO5Or8oWgUPqcswr6h0n3HDj76SVRKwRx8tlaxMw8k-a-b/exec',
};

// คงชื่อตัวแปรเดิมไว้ เพื่อไม่ต้องแก้โค้ดทั้งไฟล์
const API_URL             = APP_CONFIG.apiUrl;
const RATE_PER_UNIT       = APP_CONFIG.ratePerUnit;
const SERVICE_FEE         = APP_CONFIG.serviceFee;
const PROMPTPAY_ID        = APP_CONFIG.promptPayId;
const PROMPTPAY_NAME      = APP_CONFIG.promptPayName;

const BOOTSTRAP_CACHE_KEY = 'wm_bootstrap_cache_v1';
const BOOTSTRAP_CACHE_TTL = 5 * 60 * 1000;
const SESSION_KEY         = 'wm_session';
const IDLE_TIMEOUT_MS     = 10 * 60 * 1000; // 10 นาที
let idleTimer = null;
let idleEventsBound = false;
let receiptImageBlob = null;
let receiptImageUrl = '';
let summaryImageBlob = null;
let summaryImageUrl = '';
let isSharingReceiptImage = false;
let shareRecoveryTimer = null;
let currentReceiptReadingId = '';
let bprintFallbackTimer = null;

const VALID_USERS = [
  { username: 'admin', password: 'water12345', displayName: 'ผู้ดูแลระบบ' },
  { username: 'staff', password: 'staff12345',      displayName: 'เจ้าหน้าที่' },
];

/* ── State ── */
let state = {
  selectedHouse:  null,
  selectedMeter:  0,
  currentReading: null,
  isValid:        false,
  paymentStatus:  'paid',
  paymentMethod:  'cash',
  historyItems:   [],
  historyFilter:  'all',      // 'all' | 'paid' | 'unpaid'  ← NEW
  selectedMonth:  '',         // 'YYYY-MM'  ← NEW
  currentUser:    null,
  editingItem:    null,       // history item being edited  ← NEW
  editingStatus: null,
  editingPaymentMethod: 'cash',
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
    payMethodWrap: $('payMethodWrap'),
    payMethodCash: $('payMethodCash'),
    payMethodTransfer: $('payMethodTransfer'),

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
    editPayMethodWrap: $('editPayMethodWrap'),
    editPayMethodCash: $('editPayMethodCash'),
    editPayMethodTransfer: $('editPayMethodTransfer'),

    summaryBtn: $('summaryBtn'),
    summaryOverlay: $('summaryOverlay'),
    summarySheet: $('summarySheet'),
    summaryMonthLabel: $('summaryMonthLabel'),
    sumRecordedMeters: $('sumRecordedMeters'),
    sumCashAmount: $('sumCashAmount'),
    sumCashHouses: $('sumCashHouses'),
    sumCashMeters: $('sumCashMeters'),
    sumTransferAmount: $('sumTransferAmount'),
    sumTransferHouses: $('sumTransferHouses'),
    sumTransferMeters: $('sumTransferMeters'),
    summarySlip: $('summarySlip'),
    summaryGeneratedAt: $('summaryGeneratedAt'),
    summaryUserName: $('summaryUserName'),
    sumGrandTotal: $('sumGrandTotal'),
    saveSummaryImageBtn: $('saveSummaryImageBtn'),
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

function bindIdleEvents() {
  if (idleEventsBound) return;
  idleEventsBound = true;

  ['click', 'touchstart', 'keydown', 'scroll', 'mousemove'].forEach(eventName => {
    document.addEventListener(eventName, resetIdleTimer, { passive: true });
  });
}

function resetIdleTimer() {
  if (!state.currentUser) return;

  clearTimeout(idleTimer);

  idleTimer = setTimeout(() => {
    autoLogoutDueToIdle();
  }, IDLE_TIMEOUT_MS);
}

function autoLogoutDueToIdle() {
  if (!state.currentUser) return;

  clearTimeout(idleTimer);
  idleTimer = null;

  // ปิด popup/sheet ที่อาจเปิดค้างอยู่
  try { closeSheet(); } catch (e) {}
  try { closeHistorySheet(); } catch (e) {}
  try { closeEditPaySheet(); } catch (e) {}
  try { cancelLogout(); } catch (e) {}

  // ใช้ระบบ logout เดิม
  confirmLogout();

  // แจ้งเหตุผลบนหน้า login
  showLoginError('ออกจากระบบอัตโนมัติ เนื่องจากไม่ได้ใช้งานเกิน 10 นาที');
}

function isAdminUser() {
  return state.currentUser?.username === 'admin';
}

function updateAdminVisibility() {
  if (dom.summaryBtn) {
    dom.summaryBtn.style.display = isAdminUser() ? 'flex' : 'none';
  }
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
    buildMonthOptions();
    updateAdminVisibility();
    resetIdleTimer();

    Promise.all([
      loadBootstrap(false),
      loadHistory(true)
    ])
      .then(() => refreshStatBar())
      .catch(err => {
        console.error('[enterApp]', err);
        refreshStatBar();
      });

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
  clearTimeout(idleTimer);
  idleTimer = null;

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

  if (dom.summaryBtn) {
  dom.summaryBtn.style.display = 'none';
  }
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

function normalizePaymentMethod(method) {
  return method === 'transfer' ? 'transfer' : 'cash';
}

function getPaymentMethodLabel(method) {
  return method === 'transfer' ? 'เงินโอน' : 'เงินสด';
}

function selectPaymentMethod(method) {
  state.paymentMethod = normalizePaymentMethod(method);

  if (dom.payMethodCash) {
    dom.payMethodCash.classList.toggle('active', state.paymentMethod === 'cash');
  }

  if (dom.payMethodTransfer) {
    dom.payMethodTransfer.classList.toggle('active', state.paymentMethod === 'transfer');
  }
}

function setPaymentMethodEnabled(enabled) {
  if (dom.payMethodWrap) {
    dom.payMethodWrap.classList.toggle('disabled', !enabled);
  }

  [dom.payMethodCash, dom.payMethodTransfer].forEach(btn => {
    if (btn) btn.disabled = !enabled;
  });
}

function selectEditPaymentMethod(method) {
  state.editingPaymentMethod = normalizePaymentMethod(method);

  if (dom.editPayMethodCash) {
    dom.editPayMethodCash.classList.toggle('active', state.editingPaymentMethod === 'cash');
  }

  if (dom.editPayMethodTransfer) {
    dom.editPayMethodTransfer.classList.toggle('active', state.editingPaymentMethod === 'transfer');
  }
}

function setEditPaymentMethodEnabled(enabled) {
  if (dom.editPayMethodWrap) {
    dom.editPayMethodWrap.classList.toggle('disabled', !enabled);
  }

  [dom.editPayMethodCash, dom.editPayMethodTransfer].forEach(btn => {
    if (btn) btn.disabled = !enabled;
  });
}

/* ════════════════════════════════
   PAYMENT STATUS
════════════════════════════════ */
function selectPayment(status) {
  state.paymentStatus = status;

  dom.payOptPaid.classList.toggle('active', status === 'paid');
  dom.payOptUnpaid.classList.toggle('active', status === 'unpaid');

  if (status === 'paid') {
    dom.saveBtnLabel.textContent = 'บันทึก + ออกใบเสร็จ';
    dom.saveBtn.classList.remove('unpaid-mode');

    setPaymentMethodEnabled(true);

    if (!state.paymentMethod) {
      selectPaymentMethod('cash');
    }
  } else {
    dom.saveBtnLabel.textContent = 'บันทึกยอดมิเตอร์+พิมพ์ใบค้างชำระ';
    dom.saveBtn.classList.add('unpaid-mode');

    setPaymentMethodEnabled(false);
  }
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
        payment_method: isPaid ? state.paymentMethod : '',
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

    // ใช้ข้อมูลเต็มจากประวัติย้อนหลัง ถ้ามี
    const fullItem = state.historyItems.find(item =>
      String(item.reading_id || '') === String(saved.reading_id || '')
    );

    if (fullItem) {
      openReceiptFromHistoryItem(fullItem, 600);
    } else {
      // fallback เผื่อ history ยังโหลดไม่ทัน
      populateReceipt(house, meter, saved);
      setTimeout(() => openSheet(), 600);
    }

    if (isPaid) {
      showToast('บันทึก + ออกใบเสร็จสำเร็จ!');
    } else {
      showToast('บันทึก + ออกใบแจ้งค้างชำระสำเร็จ!');
    }
  } catch (err) {
    dom.errorText.textContent = err.message || 'เกิดข้อผิดพลาด'; dom.errorBox.style.display = 'flex';
  } finally { dom.saveBtn.disabled = false; }
}

function openSheet() {
  dom.sheetOverlay.classList.add('show');
  dom.receiptSheet.classList.add('open');
  document.body.style.overflow = 'hidden';

  // สร้างรูปใบเสร็จอัตโนมัติหลังใบเสร็จเด้ง
  setTimeout(() => {
    generateReceiptImage();
  }, 450);
}

function closeSheet() { dom.sheetOverlay.classList.remove('show'); dom.receiptSheet.classList.remove('open'); document.body.style.overflow = ''; }


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
        <div class="history-item" id="hi-${idx}" data-idx="${realIdx}">
          <div class="history-top">
            <div>
              <div class="history-house">${item.house_no || '-'} · ${item.meter_label || '-'}</div>
              <div class="history-name">${item.owner_name || '-'}</div>
            </div>

            <div class="history-top-right">
              <span class="history-badge ${paidClass}">${paidLabel}</span>

              ${item.payment_status !== 'unpaid' && item.payment_method ? `
                <span class="history-paymethod-badge">
                  ${getPaymentMethodLabel(item.payment_method)}
                </span>
              ` : ''}

              <button
                type="button"
                class="history-reprint-btn"
                onclick="event.stopPropagation(); reprintHistoryReceiptById('${item.reading_id || ''}')"
              >
                🖨️ พิมพ์ซ้ำ
              </button>

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
    </div>`;
  }).join('');

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
  if (dom.editPayOverlay) {
    dom.editPayOverlay.classList.remove('show');
  }

  if (dom.editPaySheet) {
    dom.editPaySheet.classList.remove('open');
  }

  document.body.style.overflow = '';

  state.editingItem = null;
  state.editingStatus = null;
}

function selectEditPaymentStatus(status) {
  state.editingStatus = status;

  dom.editOptPaid.classList.toggle('active-paid', status === 'paid');
  dom.editOptUnpaid.classList.toggle('active-unpaid', status === 'unpaid');

  setEditPaymentMethodEnabled(status === 'paid');

  if (status === 'paid' && !state.editingPaymentMethod) {
    selectEditPaymentMethod('cash');
  }

  dom.editPayError.style.display = 'none';
}

function saveEditPayment() {
  if (!state.editingItem) return;
  submitEditPayment(state.editingStatus || 'paid');
}

async function submitEditPayment(newStatus) {
  const item = state.editingItem;
  if (!item) return;

  const oldStatus = item.payment_status === 'unpaid' ? 'unpaid' : 'paid';
  const shouldOpenReceipt = true;

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
        payment_method: newStatus === 'paid' ? state.editingPaymentMethod : '',
        editor_name: state.currentUser?.displayName || 'เจ้าหน้าที่',
      })
    });

    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'อัปเดตไม่สำเร็จ');

    const updatedData = json.data || {};
    Object.assign(item, updatedData);

    item.payment_status = newStatus;

    historyLoaded = false;
    refreshStatBar();
    renderHistoryList(dom.historySearchInput.value);

    const msg = newStatus === 'paid'
      ? '✅ อัปเดตเป็นชำระแล้ว'
      : '🕐 อัปเดตเป็นยังไม่ชำระ';

    showToast(msg);

    if (shouldOpenReceipt) {
      const receiptHouse = {
        name: item.owner_name || item.name || '-',
        num: item.house_no || '-',
        addr: item.house_no || item.addr || '-',
        address: item.house_no || item.address || '-',
      };

      const receiptMeter = {
        label: item.meter_label || item.meter_key || 'มิเตอร์ 1',
      };

      const receiptSaved = {
        reading_id: item.reading_id || '',
        receipt_no: item.receipt_no || item.reading_id || '---',
        read_date: item.read_date || item.created_at || new Date().toISOString(),
        payment_status: newStatus,
        prev_reading: Number(item.prev_reading || 0),
        current_reading: Number(item.current_reading || 0),
        units_used: Number(item.units_used || 0),
        water_cost: Number(item.water_cost || 0),
        service_fee: Number(item.service_fee || SERVICE_FEE),
        total_amount: Number(item.total_amount || 0),
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

function applyAppConfig() {
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('cfgLoginTitle', APP_CONFIG.loginTitle);
  setText('cfgLoginSub', APP_CONFIG.villageName);

  setText('cfgNavTitle', APP_CONFIG.appTitle);
  setText('cfgNavSub', APP_CONFIG.villageName);

  setText('cfgReceiptOrg', APP_CONFIG.orgName);
  setText('cfgReceiptSub', APP_CONFIG.villageName);
  setText('cfgReceiptContact', `สอบถาม: ${APP_CONFIG.contact}`);

  document.title = APP_CONFIG.appTitle;
}

/* ════════════════════════════════
   INIT
════════════════════════════════ */
(async function init() {
  buildDomRefs();
  applyAppConfig();
  bindMainEvents();
  bindIdleEvents();
  dom.todayDate.textContent = formatDateTH(new Date());

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheet(); closeHistorySheet(); cancelLogout(); closeEditPaySheet(); }
  });

  checkSavedSession();

})();

const _enterApp = enterApp;
window.enterApp = function(displayName) {
  _enterApp(displayName);
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

function printUnpaidNoticeById(readingId) {
  const item = state.historyItems.find(
    x => String(x.reading_id || '') === String(readingId || '')
  );

  if (!item) {
    showToast('ไม่พบรายการค้างชำระ');
    return;
  }

  const receiptHouse = {
    name: item.owner_name || item.name || '-',
    num: item.house_no || '-',
    addr: item.house_no || item.addr || '-',
    address: item.house_no || item.address || '-',
  };

  const receiptMeter = {
    label: item.meter_label || item.meter_key || 'มิเตอร์ 1',
  };

  const receiptSaved = {
    receipt_no: item.receipt_no || item.reading_id || '---',
    reading_id: item.reading_id || '',
    read_date: item.read_date || new Date().toISOString(),
    payment_status: 'unpaid',
    prev_reading: item.prev_reading,
    current_reading: item.current_reading,
    units_used: item.units_used,
    water_cost: item.water_cost,
    total_amount: item.total_amount,
  };

  closeHistorySheet();
  populateReceipt(receiptHouse, receiptMeter, receiptSaved);

  setTimeout(() => {
    openSheet();
  }, 180);
}

function openReceiptFromHistoryItem(item, delay = 180) {
  if (!item) {
    showToast('ไม่พบข้อมูลใบเสร็จ');
    return;
  }

  const receiptHouse = {
    name: item.owner_name || item.name || '-',
    num: item.house_no || '-',
    addr: item.house_no || item.addr || '-',
    address: item.house_no || item.address || '-',
  };

  const receiptMeter = {
    label: item.meter_label || item.meter_key || 'มิเตอร์ 1',
  };

  const isUnpaid = item.payment_status === 'unpaid';

  const receiptSaved = {
    reading_id: item.reading_id || '',
    receipt_no: item.receipt_no || item.reading_id || '---',
    read_date: item.read_date || item.created_at || new Date().toISOString(),
    payment_status: isUnpaid ? 'unpaid' : 'paid',
    payment_method: item.payment_method || '',
    prev_reading: Number(item.prev_reading || 0),
    current_reading: Number(item.current_reading || 0),
    units_used: Number(item.units_used || 0),
    rate_per_unit: Number(item.rate_per_unit || RATE_PER_UNIT),
    water_cost: Number(item.water_cost || 0),
    service_fee: Number(item.service_fee || SERVICE_FEE),
    total_amount: Number(item.total_amount || 0),
  };

  populateReceipt(receiptHouse, receiptMeter, receiptSaved);

  setTimeout(() => {
    openSheet();
  }, delay);
}

function reprintHistoryReceiptById(readingId) {
  const item = state.historyItems.find(
    x => String(x.reading_id || '') === String(readingId || '')
  );

  if (!item) {
    showToast('ไม่พบรายการสำหรับพิมพ์ซ้ำ');
    return;
  }

  closeHistorySheet();
  openReceiptFromHistoryItem(item, 180);
}

function openReceiptFromHistoryItem(item, delay = 180) {
  if (!item) {
    showToast('ไม่พบข้อมูลใบเสร็จ');
    return;
  }

  const receiptHouse = {
    name: item.owner_name || item.name || '-',
    num: item.house_no || '-',
    addr: item.house_no || item.addr || '-',
    address: item.house_no || item.address || '-',
  };

  const receiptMeter = {
    label: item.meter_label || item.meter_key || 'มิเตอร์ 1',
  };

  const isUnpaid = item.payment_status === 'unpaid';

  const receiptSaved = {
    reading_id: item.reading_id || '',
    receipt_no: item.receipt_no || item.reading_id || '---',
    read_date: item.read_date || item.created_at || new Date().toISOString(),
    payment_status: isUnpaid ? 'unpaid' : 'paid',
    prev_reading: Number(item.prev_reading || 0),
    current_reading: Number(item.current_reading || 0),
    units_used: Number(item.units_used || 0),
    rate_per_unit: Number(item.rate_per_unit || RATE_PER_UNIT),
    water_cost: Number(item.water_cost || 0),
    service_fee: Number(item.service_fee || SERVICE_FEE),
    total_amount: Number(item.total_amount || 0),
  };

  populateReceipt(receiptHouse, receiptMeter, receiptSaved);

  setTimeout(() => {
    openSheet();
  }, delay);
}

function openEditPaySheetById(readingId) {
  const item = state.historyItems.find(
    x => String(x.reading_id || '') === String(readingId || '')
  );

  if (!item) return;

  state.editingItem = item;
  const isPaid = item.payment_status !== 'unpaid';
  state.editingStatus = isPaid ? 'paid' : 'unpaid';
  state.editingPaymentMethod = item.payment_method
  ? normalizePaymentMethod(item.payment_method)
  : 'cash';

  dom.editPaySub.textContent = `${item.house_no || '-'} · ${item.owner_name || '-'}`;
  dom.editPayError.style.display = 'none';

  dom.editOptPaid.classList.toggle('active-paid', isPaid);
  dom.editOptUnpaid.classList.toggle('active-unpaid', !isPaid);

  selectEditPaymentMethod(state.editingPaymentMethod);
  setEditPaymentMethodEnabled(isPaid);

  dom.editPayOverlay.classList.add('show');
  dom.editPaySheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function crc16ccitt(str) {
  let crc = 0xFFFF;

  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;

    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }

      crc &= 0xFFFF;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function formatPromptPayId(id) {
  const clean = String(id).replace(/\D/g, '');

  // เบอร์มือถือไทย 10 หลัก เช่น 0812345678
  if (clean.length === 10 && clean.startsWith('0')) {
    return `0066${clean.substring(1)}`;
  }

  // เลขบัตรประชาชน / เลขผู้เสียภาษี 13 หลัก
  return clean;
}

function buildPromptPayPayload(promptPayId, amount) {
  const formattedId = formatPromptPayId(promptPayId);
  const amountNumber = Number(amount || 0);
  const amountText = amountNumber.toFixed(2);

  const merchantAccountInfo =
    emvField('00', 'A000000677010111') +
    emvField('01', formattedId);

  let payload =
    emvField('00', '01') +
    emvField('01', '12') +
    emvField('29', merchantAccountInfo) +
    emvField('53', '764') +
    emvField('54', amountText) +
    emvField('58', 'TH');

  payload += '6304';
  payload += crc16ccitt(payload);

  return payload;
}

/* ════════════════════════════════
RECEIPT & QR CODE HELPERS
════════════════════════════════ */

// อัปเดตข้อมูลใบเสร็จ (แทนที่ populateReceipt เดิม)
function populateReceipt(house, meter, saved) {
  const isUnpaid = saved.payment_status === 'unpaid';

  currentReceiptReadingId = saved.reading_id || saved.receipt_no || '';

  const receiptContent = document.getElementById('receiptContent');
  const titleEl = document.getElementById('receiptTitle');
  const warningEl = document.getElementById('receiptWarning');

  if (receiptContent) {
    receiptContent.classList.toggle('receipt-is-unpaid', isUnpaid);
    receiptContent.classList.toggle('receipt-is-paid', !isUnpaid);
  }

  if (titleEl) {
    titleEl.textContent = isUnpaid
      ? 'ใบแจ้งยอดค้างชำระค่าน้ำประปา'
      : 'ใบเสร็จรับเงินค่าน้ำประปา';
  }

  if (warningEl) {
    warningEl.style.display = 'none';
  }

  document.getElementById('rNo').textContent = isUnpaid
    ? `ใบแจ้ง #${saved.receipt_no || saved.reading_id || '---'}`
    : `ใบเสร็จ #${saved.receipt_no || '---'}`;
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

  let payMethodEl = document.getElementById('rPayMethod');

  if (!payMethodEl && statusEl) {
    payMethodEl = document.createElement('div');
    payMethodEl.id = 'rPayMethod';
    payMethodEl.className = 'receipt-pay-method';
    statusEl.insertAdjacentElement('afterend', payMethodEl);
  }

  if (payMethodEl) {
    if (isUnpaid) {
      payMethodEl.style.display = 'none';
      payMethodEl.textContent = '';
    } else {
      const methodLabel = getPaymentMethodLabel(saved.payment_method || 'cash');
      payMethodEl.style.display = 'block';
      payMethodEl.textContent = `วิธีชำระ: ${methodLabel}`;
    }
  }

  if (statusEl) {
    if (isUnpaid) {
      statusEl.className = 'receipt-status unpaid';
      statusEl.textContent = '⚠️ ยังไม่ชำระ';
    } else {
      statusEl.className = 'receipt-status paid';
      statusEl.textContent = '✅ ชำระแล้ว';
    }
  }
    // แสดง QR PromptPay ทั้งใบเสร็จและใบแจ้งค้างชำระ
  updateQrDisplay(true, saved.total_amount);
}

// จัดการแสดงผล QR Code
function updateQrDisplay(showInfo, amount) {
  const qrBox = document.getElementById('qrCode');
  const qrSection = document.getElementById('qrSection');
  const qrNote = document.getElementById('qrNote');

  if (!qrBox) {
    console.warn('ไม่พบ element id="qrCode"');
    return;
  }

  qrBox.innerHTML = '';

  if (qrSection) {
    qrSection.style.display = showInfo ? 'block' : 'none';
  }

  if (!showInfo) {
    return;
  }

  qrBox.innerHTML = `
    <div class="bank-transfer-box">
      <div class="bank-transfer-title">โอนเข้าบัญชี</div>
      <div class="bank-transfer-line">${APP_CONFIG.bankName || '-'}</div>
      <div class="bank-transfer-account">${APP_CONFIG.bankAccountNo || '-'}</div>
      <div class="bank-transfer-line">${APP_CONFIG.bankAccountName || '-'}</div>
    </div>
  `;

  if (qrNote) {
    qrNote.textContent = `ยอดชำระ ${Number(amount || 0).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} บาท`;
  }
}

// ฟังก์ชันเตรียมสร้าง QR PromptPay (สำหรับใช้ในอนาคต)
// ต้องเพิ่มไลบรารีเช่น qrcode.min.js หรือใช้ API ภายนอก
function generatePromptPayQR(phone, amount, callback) {
  // ตัวอย่าง: ใช้ API ของธนาคารหรือไลบรารีสร้าง QR
  // const qrData = createPromptPayPayload(phone, amount);
  // QRCode.toCanvas(document.getElementById('rQrCode'), qrData, callback);
  console.log('📱 PromptPay QR: โทรศัพท์=' + phone + ', จำนวน=' + amount);
}

// พิมพ์ใบเสร็จผ่าน Bluetooth Print / Web Print
function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

function buildBluetoothPrintResponseUrl(readingId) {
  const id = String(readingId || '').trim();

  if (!id) {
    return '';
  }

  return `${API_URL}?action=bprintReceipt&reading_id=${encodeURIComponent(id)}`;
}

function closeReceiptPopupAfterExternalPrint() {
  document.body.classList.remove('printing-receipt');
  document.body.classList.remove('printing-summary');

  const receiptSheet = document.getElementById('receiptSheet');
  const sheetOverlay = document.getElementById('sheetOverlay');

  if (receiptSheet) {
    receiptSheet.classList.remove('open');
  }

  if (sheetOverlay) {
    sheetOverlay.classList.remove('show');
  }

  document.body.style.overflow = '';
  document.documentElement.style.pointerEvents = '';
  document.body.style.pointerEvents = '';

  try {
    resetIdleTimer();
  } catch (e) {}
}

function openBrowserPrintFallback() {
  document.body.classList.add('printing-receipt');

  setTimeout(() => {
    window.print();
  }, 120);

  setTimeout(() => {
    closeReceiptPopupAfterExternalPrint();
  }, 1500);
}

let isExternalPrinting = false;

function handleReturnToWebApp() {
  if (isSharingReceiptImage) {
    setTimeout(recoverAfterShareImage, 250);
  }

  if (isExternalPrinting) {
    setTimeout(() => {
      closeReceiptPopupAfterExternalPrint();
      isExternalPrinting = false;
    }, 250);
  }
}

window.addEventListener('pageshow', handleReturnToWebApp);
window.addEventListener('focus', handleReturnToWebApp);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    handleReturnToWebApp();
  }
});

window.addEventListener('afterprint', () => {
  closeReceiptPopupAfterExternalPrint();
});

function escapeBluetoothHtml(html) {
  // ใช้สำหรับข้อความธรรมดาเท่านั้น — HTML print ต้องส่ง tag จริง ไม่ใช่ &lt;div&gt;
  return String(html || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeBluetoothHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildAndroidReceiptHtmlFromScreen() {
  const getTextRaw = id => document.getElementById(id)?.textContent?.trim() || '-';

  const clean = value => String(value ?? '')
    .replace(/✅|⚠️|฿/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const safe = value => safeBluetoothHtmlText(clean(value));

  const receiptTitleRaw =
    document.getElementById('receiptTitle')?.textContent?.trim() ||
    'ใบเสร็จรับเงินค่าน้ำประปา';

  const statusRaw = clean(getTextRaw('rStatus'));
  const payMethodRaw = clean(document.getElementById('rPayMethod')?.textContent?.trim() || '');

  const isUnpaid = statusRaw.includes('ยังไม่ชำระ');
  const shouldShowBank = isUnpaid || payMethodRaw.includes('เงินโอน');

  const moneyText = id => {
    const raw = clean(getTextRaw(id)).replace(/บาท/g, '').trim();
    return `${raw} บาท`;
  };

  const row = (label, value, bold = false) => `
    <div class="r-row">
      <span class="r-label">${safe(label)}:</span>
      <span class="r-value ${bold ? 'b' : ''}">${safe(value)}</span>
    </div>
  `;

  const bankHtml = shouldShowBank ? `
    <div class="dash"></div>
    <div class="center b">ข้อมูลบัญชีรับโอน</div>
    ${row('ธนาคาร', APP_CONFIG.bankName || '-')}
    ${row('เลขบัญชี', APP_CONFIG.bankAccountNo || '-', true)}
    ${row('ชื่อบัญชี', APP_CONFIG.bankAccountName || '-')}
  ` : '';

  const payMethodHtml = payMethodRaw
    ? `<div class="center b small">วิธีชำระ: ${safe(payMethodRaw)}</div>`
    : '';

  // HTML-V3: บังคับใบเสร็จให้เป็นคอลัมน์เดียว ไม่ใช้ตาราง/กริด เพื่อกันด้านขวาถูกตัด
  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 36mm !important;
    min-width: 36mm !important;
    max-width: 36mm !important;
    background: #fff !important;
    color: #000 !important;
  }

  * {
    box-sizing: border-box !important;
  }

  body {
    font-family: Tahoma, Arial, sans-serif !important;
    font-size: 8.5px !important;
    line-height: 1.12 !important;
    -webkit-text-size-adjust: 100% !important;
  }

  .receipt {
    width: 36mm !important;
    max-width: 36mm !important;
    margin: 0 !important;
    padding: 0 0.5mm !important;
    overflow: hidden !important;
  }

  .center { text-align: center !important; }
  .b { font-weight: 800 !important; }

  .org {
    font-size: 10px !important;
    line-height: 1.05 !important;
  }

  .sub {
    font-size: 8px !important;
    line-height: 1.05 !important;
    margin-top: 1px !important;
  }

  .title {
    font-size: 10px !important;
    line-height: 1.05 !important;
    margin-top: 2px !important;
  }

  .meta {
    font-size: 8px !important;
    line-height: 1.05 !important;
    margin-top: 1px !important;
  }

  .dash {
    border-top: 1px dashed #000 !important;
    margin: 2px 0 !important;
    height: 0 !important;
  }

  .solid {
    border-top: 2px solid #000 !important;
    margin: 3px 0 !important;
    height: 0 !important;
  }

  .r-row {
    display: block !important;
    width: 100% !important;
    padding: 1px 0 !important;
    white-space: normal !important;
    overflow: hidden !important;
  }

  .r-label { font-weight: 400 !important; }
  .r-value { font-weight: 700 !important; }

  .meter-line {
    text-align: center !important;
    font-size: 8.5px !important;
    line-height: 1.05 !important;
    margin-top: 2px !important;
  }

  .meter-num {
    text-align: center !important;
    font-size: 12px !important;
    line-height: 1.05 !important;
    font-weight: 800 !important;
    margin: 1px 0 2px !important;
  }

  .unit-box {
    border: 1px solid #000 !important;
    padding: 2px !important;
    margin: 2px 0 !important;
    font-size: 9px !important;
    font-weight: 800 !important;
    text-align: center !important;
  }

  .total-label {
    font-size: 9px !important;
    line-height: 1 !important;
  }

  .total {
    font-size: 15px !important;
    line-height: 1.05 !important;
    font-weight: 900 !important;
  }

  .small {
    font-size: 8px !important;
    line-height: 1.05 !important;
  }

  .tiny {
    font-size: 6.5px !important;
    line-height: 1 !important;
  }
</style>
</head>
<body>
  <div class="receipt">
    <div class="center b org">${safe(APP_CONFIG.orgName)}</div>
    <div class="center sub">${safe(APP_CONFIG.villageName)}</div>

    <div class="dash"></div>

    <div class="center b title">${safe(receiptTitleRaw)}</div>
    <div class="center b meta">${safe(getTextRaw('rNo'))}</div>
    <div class="center meta">${safe(getTextRaw('rDate'))}</div>

    <div class="dash"></div>

    ${row('ชื่อลูกค้า', getTextRaw('rName'), true)}
    ${row('บ้านเลขที่', getTextRaw('rAddr'), true)}
    ${row('มิเตอร์', getTextRaw('rMeter'), true)}
    ${row('ประจำเดือน', getTextRaw('rMonth'), true)}

    <div class="dash"></div>

    <div class="meter-line b">ยอดก่อนหน้า &gt; ยอดปัจจุบัน</div>
    <div class="meter-num">${safe(getTextRaw('rPrev'))} &gt; ${safe(getTextRaw('rCurr'))}</div>
    <div class="unit-box">หน่วยที่ใช้: ${safe(getTextRaw('rUnits'))}</div>

    <div class="dash"></div>

    ${row('ค่าน้ำประปา', moneyText('rWater'), true)}
    ${row('ค่าบริการรายเดือน', '0.00 บาท', true)}

    <div class="solid"></div>
    <div class="center total-label b">จำนวนเงินทั้งสิ้น</div>
    <div class="center total">${safe(moneyText('rTotal'))}</div>
    <div class="solid"></div>

    <div class="center b">สถานะ: ${safe(statusRaw)}</div>
    ${payMethodHtml}
    ${bankHtml}

    <div class="dash"></div>

    <div class="center b small">ขอบคุณที่ใช้บริการ</div>
    <div class="center small">สอบถาม: ${safe(APP_CONFIG.contact)}</div>
    <div class="center tiny">${isUnpaid ? 'เอกสารนี้ยังไม่ใช่หลักฐานการชำระเงิน' : 'ใบเสร็จนี้ใช้เป็นหลักฐานการชำระเงิน'}</div>
    <div class="center tiny">HTML-V3</div>
  </div>
</body>
</html>
  `;
}

async function printReceiptByAndroidShare() {
  try {
    const html = buildAndroidReceiptHtmlFromScreen();

    // Bluetooth Print HTML mode
    const printPayload = '<HTML>' + html;

    if (!navigator.share) {
      showToast('Android เครื่องนี้ไม่รองรับ Share Print');
      return;
    }

    await navigator.share({
      title: 'ใบเสร็จค่าน้ำประปา',
      text: printPayload
    });

    setTimeout(() => {
      closeReceiptPopupAfterExternalPrint();
    }, 300);

  } catch (err) {
    console.error('[printReceiptByAndroidShare]', err);

    if (err && err.name === 'AbortError') {
      return;
    }

    showToast('แชร์ไปแอปปริ้นท์ไม่สำเร็จ');
  }
}

window.testAndroidHtmlPrint = async function testAndroidHtmlPrint() {
  return printReceiptByAndroidShare();
};

function printReceipt() {
  if (!currentReceiptReadingId) {
    showToast('ไม่พบเลขอ้างอิงใบเสร็จสำหรับพิมพ์');
    return;
  }

  if (isAndroidDevice()) {
    printReceiptByAndroidShare();
    return;
  }

  const responseUrl = buildBluetoothPrintResponseUrl(currentReceiptReadingId);

  if (!responseUrl) {
    showToast('สร้างลิงก์พิมพ์ไม่สำเร็จ');
    return;
  }

  const bprintUrl = `bprint://${responseUrl}`;

  let appOpened = false;

  const markAppOpened = () => {
    appOpened = true;

    if (bprintFallbackTimer) {
      clearTimeout(bprintFallbackTimer);
      bprintFallbackTimer = null;
    }

    window.removeEventListener('pagehide', markAppOpened);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      markAppOpened();
    }
  };

  window.addEventListener('pagehide', markAppOpened, { once: true });
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ปิด popup ก่อนออกไปแอปปริ้นท์ ป้องกันจอดำตอนกลับมา
  isExternalPrinting = true;
  closeReceiptPopupAfterExternalPrint();

  setTimeout(() => {
    window.location.href = bprintUrl;
  }, 120);

  // Android ถ้าเปิด bprint ไม่ได้ ให้ fallback เป็น browser print
  if (isAndroidDevice()) {
    bprintFallbackTimer = setTimeout(() => {
      if (!appOpened) {
        window.removeEventListener('pagehide', markAppOpened);
        document.removeEventListener('visibilitychange', onVisibilityChange);

        showToast('ไม่พบแอป Web Print / Bluetooth Print ที่รองรับลิงก์นี้');
        closeReceiptPopupAfterExternalPrint();
      }
    }, 1800);
    return;
  }

  // iPhone/iPad ถ้าไม่เปิดแอป ให้ใช้ปุ่มบันทึก/แชร์รูปแทน
  if (isIOSDevice()) {
    bprintFallbackTimer = setTimeout(() => {
      if (!appOpened) {
        window.removeEventListener('pagehide', markAppOpened);
        document.removeEventListener('visibilitychange', onVisibilityChange);

        showToast('ถ้าไม่เปิดแอป Bluetooth Print ให้ใช้ปุ่มบันทึก/แชร์รูป');
        closeReceiptPopupAfterExternalPrint();
      }
    }, 1400);
    return;
  }

  bprintFallbackTimer = setTimeout(() => {
    if (!appOpened) {
      openBrowserPrintFallback();
    }
  }, 1400);
}

function openSummarySheetAndLoad() {
  if (!isAdminUser()) {
    showToast('เฉพาะผู้ดูแลระบบเท่านั้นที่ดูสรุปยอดได้');
    return;
  }

  openSummarySheet();
  loadAdminSummary(true);
}

function openSummarySheet() {
  if (!dom.summaryOverlay || !dom.summarySheet) return;

  dom.summaryOverlay.classList.add('show');
  dom.summarySheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSummarySheet() {
  if (dom.summaryOverlay) dom.summaryOverlay.classList.remove('show');
  if (dom.summarySheet) dom.summarySheet.classList.remove('open');
  document.body.style.overflow = '';
}

async function loadAdminSummary(force = false) {
  if (!isAdminUser()) {
    showToast('เฉพาะผู้ดูแลระบบเท่านั้นที่ดูสรุปยอดได้');
    return;
  }

  try {
    const month = state.selectedMonth || '';

    if (dom.summaryMonthLabel) {
      dom.summaryMonthLabel.textContent = `ประจำเดือน ${getSelectedMonthLabel()}`;
    }

    setSummaryLoading();

    const res = await fetch(`${API_URL}?action=summary&month=${encodeURIComponent(month)}`);
    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error || 'โหลดสรุปยอดไม่สำเร็จ');
    }

    renderAdminSummary(json.summary || {});

  } catch (err) {
    showToast(err.message || 'โหลดสรุปยอดไม่สำเร็จ');
    setSummaryError();
  }
}

function getSelectedMonthLabel() {
  if (!dom.monthSelect) return state.selectedMonth || '—';

  const opt = dom.monthSelect.options[dom.monthSelect.selectedIndex];
  return opt ? opt.textContent : state.selectedMonth || '—';
}

function setSummaryLoading() {
  [
    dom.sumRecordedMeters,
    dom.sumCashAmount,
    dom.sumCashHouses,
    dom.sumCashMeters,
    dom.sumTransferAmount,
    dom.sumTransferHouses,
    dom.sumTransferMeters,
    dom.sumGrandTotal
  ].forEach(el => {
    if (el) el.textContent = '...';
  });
}

function setSummaryError() {
  if (dom.sumRecordedMeters) dom.sumRecordedMeters.textContent = '—';
  if (dom.sumCashAmount) dom.sumCashAmount.textContent = '—';
  if (dom.sumCashHouses) dom.sumCashHouses.textContent = '—';
  if (dom.sumCashMeters) dom.sumCashMeters.textContent = '—';
  if (dom.sumTransferAmount) dom.sumTransferAmount.textContent = '—';
  if (dom.sumTransferHouses) dom.sumTransferHouses.textContent = '—';
  if (dom.sumTransferMeters) dom.sumTransferMeters.textContent = '—';
  if (dom.sumGrandTotal) dom.sumGrandTotal.textContent = '—';
}

function formatSummaryMoney(value) {
  return `${Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} บาท`;
}

function renderAdminSummary(summary) {
  const cashAmount = Number(summary.cash_amount || 0);
  const transferAmount = Number(summary.transfer_amount || 0);
  const grandTotal = cashAmount + transferAmount;

  if (dom.summaryGeneratedAt) {
    dom.summaryGeneratedAt.textContent = `วันที่สรุป: ${formatDateTH(new Date())}`;
  }

  if (dom.summaryUserName) {
    dom.summaryUserName.textContent = state.currentUser?.displayName || 'ผู้ดูแลระบบ';
  }

  if (dom.sumRecordedMeters) {
    dom.sumRecordedMeters.textContent = Number(summary.recorded_meters || 0).toLocaleString();
  }

  if (dom.sumCashAmount) {
    dom.sumCashAmount.textContent = formatSummaryMoney(cashAmount);
  }

  if (dom.sumCashHouses) {
    dom.sumCashHouses.textContent = Number(summary.cash_houses || 0).toLocaleString();
  }

  if (dom.sumCashMeters) {
    dom.sumCashMeters.textContent = Number(summary.cash_meters || 0).toLocaleString();
  }

  if (dom.sumTransferAmount) {
    dom.sumTransferAmount.textContent = formatSummaryMoney(transferAmount);
  }

  if (dom.sumTransferHouses) {
    dom.sumTransferHouses.textContent = Number(summary.transfer_houses || 0).toLocaleString();
  }

  if (dom.sumTransferMeters) {
    dom.sumTransferMeters.textContent = Number(summary.transfer_meters || 0).toLocaleString();
  }

  if (dom.sumGrandTotal) {
    dom.sumGrandTotal.textContent = formatSummaryMoney(grandTotal);
  }

  setTimeout(() => {
    generateSummaryImage();
  }, 250);
}

async function generateReceiptImage() {
  const receiptEl = document.getElementById('receiptContent');
  const btn = document.getElementById('saveReceiptImageBtn');

  if (!receiptEl) {
    showToast('ไม่พบใบเสร็จสำหรับสร้างรูป');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '🖼️ กำลังสร้างรูป...';
  }

  try {
    if (receiptImageUrl) {
      URL.revokeObjectURL(receiptImageUrl);
      receiptImageUrl = '';
    }

    receiptImageBlob = null;

    if (typeof html2canvas === 'undefined') {
      throw new Error('โหลดตัวสร้างรูปไม่สำเร็จ');
    }

    // รอให้ QR render เสร็จก่อน
    await new Promise(resolve => setTimeout(resolve, 300));

    const canvas = await html2canvas(receiptEl, {
      backgroundColor: '#ffffff',
      scale: 3,
      useCORS: true,
      logging: false
    });

    // ขนาดเหมาะกับเครื่อง thermal 58mm ส่วนมาก = 384px
    const targetWidth = 384;
    const ratio = targetWidth / canvas.width;
    const targetHeight = Math.ceil(canvas.height * ratio);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = targetWidth;
    outputCanvas.height = targetHeight;

    const ctx = outputCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

    receiptImageBlob = await new Promise(resolve => {
      outputCanvas.toBlob(resolve, 'image/png', 1);
    });

    if (!receiptImageBlob) {
      throw new Error('สร้างรูปไม่สำเร็จ');
    }

    receiptImageUrl = URL.createObjectURL(receiptImageBlob);

    if (btn) {
      btn.disabled = false;
      btn.textContent = '🖼️ บันทึก/แชร์รูปใบเสร็จ';
    }

  } catch (err) {
    console.error('[generateReceiptImage]', err);

    if (btn) {
      btn.disabled = false;
      btn.textContent = '🖼️ สร้างรูปอีกครั้ง';
    }

    showToast(err.message || 'สร้างรูปใบเสร็จไม่สำเร็จ');
  }
}

function buildReceiptImageFileName() {
  const noText = document.getElementById('rNo')?.textContent || 'receipt';
  const cleanNo = noText
    .replace(/[^\wก-๙-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const dateText = new Date().toISOString().slice(0, 10);

  return `${cleanNo || 'receipt'}-${dateText}.png`;
}

async function saveReceiptImage() {
  const btn = document.getElementById('saveReceiptImageBtn');

  try {
    isSharingReceiptImage = true;

    if (btn) {
      btn.disabled = true;
      btn.textContent = '🖼️ กำลังเปิดแชร์...';
    }

    if (!receiptImageBlob) {
      await generateReceiptImage();
    }

    if (!receiptImageBlob) {
      showToast('ยังไม่มีรูปใบเสร็จ');
      recoverAfterShareImage();
      return;
    }

    const fileName = buildReceiptImageFileName();
    const file = new File([receiptImageBlob], fileName, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      shareRecoveryTimer = setTimeout(() => {
        recoverAfterShareImage();
      }, 2500);

      await navigator.share({
        files: [file],
        title: 'ใบเสร็จค่าน้ำประปา',
        text: 'รูปใบเสร็จค่าน้ำประปา'
      });

      recoverAfterShareImage();
      return;
    }

    const a = document.createElement('a');
    a.href = receiptImageUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    recoverAfterShareImage();

  } catch (err) {
    console.error('[saveReceiptImage]', err);

    if (err && err.name === 'AbortError') {
      recoverAfterShareImage();
      return;
    }

    showToast('บันทึก/แชร์รูปไม่สำเร็จ');
    recoverAfterShareImage();
  }
}

function recoverAfterShareImage() {
  isSharingReceiptImage = false;

  if (shareRecoveryTimer) {
    clearTimeout(shareRecoveryTimer);
    shareRecoveryTimer = null;
  }

  document.body.classList.remove('printing-receipt');
  document.documentElement.style.pointerEvents = '';
  document.body.style.pointerEvents = '';

  const receiptSheet = document.getElementById('receiptSheet');
  const btn = document.getElementById('saveReceiptImageBtn');

  if (receiptSheet && receiptSheet.classList.contains('open')) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }

  if (btn) {
    btn.disabled = !receiptImageBlob;
    btn.textContent = receiptImageBlob
      ? '🖼️ บันทึก/แชร์รูปใบเสร็จ'
      : '🖼️ สร้างรูปอีกครั้ง';
  }

  try {
    resetIdleTimer();
  } catch (e) {}
}

async function generateSummaryImage() {
  const slipEl = document.getElementById('summarySlip');
  const btn = document.getElementById('saveSummaryImageBtn');

  if (!slipEl) {
    showToast('ไม่พบสลิปสรุปยอด');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '🖼️ กำลังสร้างรูป...';
    }

    if (summaryImageUrl) {
      URL.revokeObjectURL(summaryImageUrl);
      summaryImageUrl = '';
    }

    summaryImageBlob = null;

    if (typeof html2canvas === 'undefined') {
      throw new Error('โหลดตัวสร้างรูปไม่สำเร็จ');
    }

    await new Promise(resolve => setTimeout(resolve, 200));

    const canvas = await html2canvas(slipEl, {
      backgroundColor: '#ffffff',
      scale: 3,
      useCORS: true,
      logging: false
    });

    const targetWidth = 384;
    const ratio = targetWidth / canvas.width;
    const targetHeight = Math.ceil(canvas.height * ratio);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = targetWidth;
    outputCanvas.height = targetHeight;

    const ctx = outputCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

    summaryImageBlob = await new Promise(resolve => {
      outputCanvas.toBlob(resolve, 'image/png', 1);
    });

    if (!summaryImageBlob) {
      throw new Error('สร้างรูปสรุปยอดไม่สำเร็จ');
    }

    summaryImageUrl = URL.createObjectURL(summaryImageBlob);

    if (btn) {
      btn.disabled = false;
      btn.textContent = '🖼️ บันทึก/แชร์รูปสรุปยอด';
    }

  } catch (err) {
    console.error('[generateSummaryImage]', err);

    if (btn) {
      btn.disabled = false;
      btn.textContent = '🖼️ สร้างรูปอีกครั้ง';
    }

    showToast(err.message || 'สร้างรูปสรุปยอดไม่สำเร็จ');
  }
}

function buildSummaryImageFileName() {
  const month = state.selectedMonth || new Date().toISOString().slice(0, 7);
  return `summary-${month}.png`;
}

async function saveSummaryImage() {
  try {
    if (!summaryImageBlob) {
      await generateSummaryImage();
    }

    if (!summaryImageBlob) {
      showToast('ยังไม่มีรูปสรุปยอด');
      return;
    }

    const fileName = buildSummaryImageFileName();
    const file = new File([summaryImageBlob], fileName, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'สลิปสรุปยอดรับชำระ',
        text: 'สลิปสรุปยอดรับชำระค่าน้ำประปา'
      });
      return;
    }

    const a = document.createElement('a');
    a.href = summaryImageUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

  } catch (err) {
    console.error('[saveSummaryImage]', err);

    if (summaryImageUrl) {
      window.open(summaryImageUrl, '_blank');
      return;
    }

    showToast('บันทึก/แชร์รูปสรุปยอดไม่สำเร็จ');
  }
}

function printSummarySlip() {
  document.body.classList.add('printing-summary');

  setTimeout(() => {
    window.print();
  }, 120);

  setTimeout(() => {
    document.body.classList.remove('printing-summary');
  }, 1500);
}

function closeReceiptPopupAfterExternalPrint() {
  document.body.classList.remove('printing-receipt');
  document.body.classList.remove('printing-summary');

  const receiptSheet = document.getElementById('receiptSheet');
  const sheetOverlay = document.getElementById('sheetOverlay');

  if (receiptSheet) {
    receiptSheet.classList.remove('open');
  }

  if (sheetOverlay) {
    sheetOverlay.classList.remove('show');
  }

  document.body.style.overflow = '';

  document.documentElement.style.pointerEvents = '';
  document.body.style.pointerEvents = '';

  try {
    resetIdleTimer();
  } catch (e) {}
}

window.addEventListener('pageshow', () => {
  setTimeout(closeReceiptPopupAfterExternalPrint, 250);
});

window.addEventListener('focus', () => {
  setTimeout(closeReceiptPopupAfterExternalPrint, 250);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    setTimeout(closeReceiptPopupAfterExternalPrint, 250);
  }
});