/* ═══════════════════════════════════════════
   WATER METER APP — Logic & State v3
   app.js
   ═══════════════════════════════════════════ */

'use strict';

/* ── Config ── */
let HOUSES = [];
let HOUSE_MAP = new Map();
const API_URL       = 'https://script.google.com/macros/s/AKfycbwDYBiYgoew9Cq1o6J0tSjO5Or8oWgUPqcswr6h0n3HDj76SVRKwRx8tlaxMw8k-a-b/exec';
const RATE_PER_UNIT = 3;
const SERVICE_FEE   = 20;
const BOOTSTRAP_CACHE_KEY = 'wm_bootstrap_cache_v1';
const BOOTSTRAP_CACHE_TTL = 5 * 60 * 1000; // 5 นาที

/* ── Auth Config (แก้ตรงนี้) ──
   สำหรับ Production ควรตรวจสอบฝั่ง server แทน */
const VALID_USERS = [
  { username: 'admin',  password: 'water1234', displayName: 'ผู้ดูแลระบบ' },
  { username: 'staff',  password: '0000', displayName: 'เจ้าหน้าที่' },
];
const SESSION_KEY  = 'wm_session';   // localStorage key

/* ── State ── */
let state = {
  selectedHouse:  null,
  selectedMeter:  0,
  currentReading: null,
  isValid:        false,
  paymentStatus:  'paid',
  historyItems:   [],
  currentUser:    null,   // { username, displayName }
};

let historyLoaded = false;

/* ── DOM refs ── */
let dom = {};

function buildDomRefs() {
  const $ = id => document.getElementById(id);
  dom = {
    /* Login */
    loginScreen:      $('loginScreen'),
    loginUsername:    $('loginUsername'),
    loginPassword:    $('loginPassword'),
    loginEyeBtn:      $('loginEyeBtn'),
    eyeIconShow:      $('eyeIconShow'),
    eyeIconHide:      $('eyeIconHide'),
    rememberToggle:   $('rememberToggle'),
    rememberThumb:    $('rememberThumb'),
    loginError:       $('loginError'),
    loginErrorText:   $('loginErrorText'),
    loginBtn:         $('loginBtn'),
    loginBtnLabel:    $('loginBtnLabel'),

    /* App */
    appScreen:        $('appScreen'),
    navInfoDate:      $('navInfoDate'),
    navInfoUser:      $('navInfoUser'),
    navAvatar:        $('navAvatar'),

    /* Dropdown */
    dropdownTrigger:  $('dropdownTrigger'),
    dropdownChevron:  $('dropdownChevron'),
    dropdownPanel:    $('dropdownPanel'),
    dropdownSearch:   $('dropdownSearch'),
    dropdownList:     $('dropdownList'),
    dropdownDisplay:  $('dropdownDisplay'),
    dropdownWrapper:  $('dropdownWrapper'),

    houseInfoRow:     $('houseInfoRow'),
    houseInfoName:    $('houseInfoName'),
    changeHouseBtn:   $('changeHouseBtn'),

    /* Meter */
    sectionMeter:     $('sectionMeter'),
    sectionReadings:  $('sectionReadings'),
    sectionCost:      $('sectionCost'),
    segThumb:         $('segThumb'),
    meterDesc:        $('meterDesc'),

    prevDate:         $('prevDate'),
    prevDigits:       $('prevDigits'),
    todayDate:        $('todayDate'),
    currentInput:     $('currentMeterInput'),
    inputHint:        $('inputHint'),

    unitsUsed:        $('unitsUsed'),
    waterCost:        $('waterCost'),
    totalAmount:      $('totalAmount'),
    errorBox:         $('errorBox'),
    errorText:        $('errorText'),
    saveBtn:          $('saveBtn'),
    saveBtnLabel:     $('saveBtnLabel'),

    /* Toast */
    toast:            $('successToast'),
    toastMsg:         $('toastMsg'),

    /* Sheets */
    sheetOverlay:     $('sheetOverlay'),
    receiptSheet:     $('receiptSheet'),
    lastSaveWarning:  $('lastSaveWarning'),
    lastSavedDate:    $('lastSavedDate'),
    payOptPaid:       $('payOptPaid'),
    payOptUnpaid:     $('payOptUnpaid'),

    historyOverlay:     $('historyOverlay'),
    historySheet:       $('historySheet'),
    historySearchInput: $('historySearchInput'),
    historyList:        $('historyList'),
    historySummary:     $('historySummary'),

    logoutOverlay:    $('logoutOverlay'),
    logoutConfirm:    $('logoutConfirm'),
  };
}

/* ════════════════════════════════
   LOGIN / LOGOUT
════════════════════════════════ */
let rememberMe = false;

function toggleRemember() {
  rememberMe = !rememberMe;
  dom.rememberToggle.classList.toggle('on', rememberMe);
}

function togglePassword() {
  const input = dom.loginPassword;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  dom.eyeIconShow.style.display = isPass ? 'none' : '';
  dom.eyeIconHide.style.display = isPass ? '' : 'none';
}

function handleLogin() {
  const username = dom.loginUsername.value.trim();
  const password = dom.loginPassword.value;

  if (!username || !password) {
    showLoginError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    return;
  }

  const user = VALID_USERS.find(u => u.username === username && u.password === password);

  if (!user) {
    showLoginError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    // Shake animation
    dom.loginBtnLabel.textContent = 'ไม่ถูกต้อง';
    setTimeout(() => { dom.loginBtnLabel.textContent = 'เข้าสู่ระบบ'; }, 1500);
    return;
  }

  // Success
  dom.loginError.style.display = 'none';
  state.currentUser = { username: user.username, displayName: user.displayName };

  if (rememberMe) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(state.currentUser));
    } catch (e) {}
  }

  enterApp(user.displayName);
}

function showLoginError(msg) {
  dom.loginErrorText.textContent = msg;
  dom.loginError.style.display   = 'flex';
}

function applyNavAvatarRole() {
  const username = state.currentUser?.username || '';

  dom.navAvatar.classList.remove('role-admin', 'role-staff', 'role-default');

  if (username === 'admin') {
    dom.navAvatar.textContent = 'A';
    dom.navAvatar.classList.add('role-admin');
  } else if (username === 'staff') {
    dom.navAvatar.textContent = 'S';
    dom.navAvatar.classList.add('role-staff');
  } else {
    dom.navAvatar.textContent = 'U';
    dom.navAvatar.classList.add('role-default');
  }
}

function enterApp(displayName) {
  dom.loginScreen.style.transition = 'opacity 0.4s';
  dom.loginScreen.style.opacity    = '0';

  setTimeout(() => {
    dom.loginScreen.style.display = 'none';
    dom.appScreen.style.display   = 'block';

    dom.navInfoDate.textContent = formatDateTH(new Date());
    dom.navInfoUser.textContent = displayName;

    applyNavAvatarRole();
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
  // Clear session
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  state.currentUser = null;
  cancelLogout();

  // Fade back to login
  dom.appScreen.style.display = 'none';
  dom.loginScreen.style.opacity    = '0';
  dom.loginScreen.style.display    = 'flex';
  requestAnimationFrame(() => {
    dom.loginScreen.style.transition = 'opacity 0.35s';
    dom.loginScreen.style.opacity    = '1';
  });

  // Clear login form
  dom.loginUsername.value  = '';
  dom.loginPassword.value  = '';
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
        // Pre-fill username
        dom.loginUsername.value = user.username || '';
        rememberMe = true;
        dom.rememberToggle.classList.add('on');
        // Auto-login silently
        enterApp(user.displayName);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function saveBootstrapCache(data) {
  try {
    const payload = {
      ts: Date.now(),
      houses: data
    };
    sessionStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(payload));
  } catch (e) {}
}

function loadBootstrapCache() {
  try {
    const raw = sessionStorage.getItem(BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.houses)) return null;

    const isExpired = (Date.now() - Number(parsed.ts || 0)) > BOOTSTRAP_CACHE_TTL;
    if (isExpired) return null;

    return parsed.houses;
  } catch (e) {
    return null;
  }
}

/* ════════════════════════════════
   HISTORY — open helper for HTML onclick
════════════════════════════════ */
function openHistorySheetAndLoad() {
  openHistorySheet();
  loadHistory();
}

/* ════════════════════════════════
   DROPDOWN
════════════════════════════════ */
function renderList(query = '') {
  const q = query.trim().toLowerCase();
  const filtered = HOUSES.filter(h =>
    (h.num  || '').toLowerCase().includes(q) ||
    (h.name || '').toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    dom.dropdownList.innerHTML = `<li class="dropdown-empty">ไม่พบข้อมูล</li>`;
    return;
  }

  dom.dropdownList.innerHTML = filtered.map(h => `
    <li
      data-id="${h.id}"
      class="${state.selectedHouse?.id === h.id ? 'selected' : ''}"
      onclick="pickHouse('${h.id}')"
    >
      <span class="li-num">${h.num}</span>
      <span class="li-name">${h.name}</span>
      <svg class="li-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </li>
  `).join('');
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
      id:       'm1',
      label:    'มิเตอร์ 1',
      desc:     `หมายเลข ${house.meter_no || house.meterNo || 'M-???'}`,
      meterKey: house.meter_key || house.meterKey || 'meter1',
      prev:     Number(house.prev_reading ?? house.prevReading ?? 0),
      prevDate: house.prev_date || house.prevDate || null,
    }];
  }

  state.selectedHouse  = house;
  state.selectedMeter  = 0;
  state.currentReading = null;
  state.isValid        = false;

  dom.dropdownDisplay.textContent = `${house.num} · ${house.name}`;
  dom.dropdownDisplay.classList.add('selected');
  dom.houseInfoName.textContent = `${house.num} — ${house.name}`;
  dom.houseInfoRow.style.display = 'flex';
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
  document.addEventListener('click', e => {
    if (!dom.dropdownWrapper.contains(e.target)) closeDropdown();
  });

  dom.changeHouseBtn.addEventListener('click', () => {
    dom.dropdownDisplay.textContent = 'เลือกเลขที่บ้าน...';
    dom.dropdownDisplay.classList.remove('selected');
    dom.houseInfoRow.style.display = 'none';
    state.selectedHouse = null;
    state.currentReading = null;

    hideSection(dom.sectionMeter);
    hideSection(dom.sectionReadings);
    hideSection(dom.sectionCost);
    if (dom.lastSavedDate) dom.lastSavedDate.textContent = '—';
    if (dom.lastSaveWarning) dom.lastSaveWarning.style.display = 'none';

    dom.currentInput.value        = '';
    dom.segThumb.style.transform  = 'translateX(0)';
    document.querySelectorAll('.seg-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0);
      btn.disabled = false;
      btn.classList.remove('disabled');
    });
    openDropdown();
  });

  if (dom.historySearchInput) {
    dom.historySearchInput.addEventListener('input', () => renderHistoryList(dom.historySearchInput.value));
  }

  // Login: Enter key
  dom.loginPassword.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  dom.loginUsername.addEventListener('keydown', e => {
    if (e.key === 'Enter') dom.loginPassword.focus();
  });
}

/* ── Meter helpers ── */
function hasSecondMeter() {
  return !!(state.selectedHouse && Array.isArray(state.selectedHouse.meters) && state.selectedHouse.meters.length > 1);
}

function updateMeterSelectorUI() {
  const segBtns = document.querySelectorAll('.seg-btn');
  const canUse2 = hasSecondMeter();
  if (segBtns[1]) {
    segBtns[1].disabled = !canUse2;
    segBtns[1].classList.toggle('disabled', !canUse2);
  }
  if (!canUse2) {
    state.selectedMeter = 0;
    dom.segThumb.style.transform = 'translateX(0)';
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

  state.selectedMeter  = idx;
  state.currentReading = null;

  dom.segThumb.style.transform = idx === 0 ? 'translateX(0)' : 'translateX(100%)';
  document.querySelectorAll('.seg-btn').forEach((btn, i) => btn.classList.toggle('active', i === idx));

  dom.currentInput.value      = '';
  dom.inputHint.style.display = 'none';
  dom.saveBtn.disabled        = true;
  dom.errorBox.style.display  = 'none';

  refreshMeterView();
  resetCostDisplay();
}

function refreshMeterView() {
  if (!state.selectedHouse) return;
  const meter = state.selectedHouse.meters[state.selectedMeter];
  if (!meter) return;

  const displayDate = formatDisplayDate(meter.prevDate);
  dom.prevDigits.textContent = formatMeterDigits(meter.prev);
  dom.prevDate.textContent   = displayDate;
  dom.meterDesc.textContent  = meter.desc || '';

  if (meter.prevDate) {
    dom.lastSavedDate.textContent     = displayDate;
    dom.lastSaveWarning.style.display = 'block';
  } else {
    dom.lastSavedDate.textContent     = '—';
    dom.lastSaveWarning.style.display = 'none';
  }
}

/* ════════════════════════════════
   METER INPUT
════════════════════════════════ */
function onMeterInput() {
  const raw = dom.currentInput.value.replace(/\D/g, '');
  dom.currentInput.value = raw;

  const val   = raw === '' ? NaN : Number(raw);
  const meter = state.selectedHouse?.meters?.[state.selectedMeter];
  if (!meter) return;

  dom.errorBox.style.display = 'none';

  if (raw === '' || isNaN(val)) {
    state.isValid = false; state.currentReading = null;
    dom.inputHint.style.display = 'none'; dom.saveBtn.disabled = true;
    resetCostDisplay(); return;
  }
  if (val < meter.prev) {
    state.isValid = false; state.currentReading = null;
    dom.inputHint.className   = 'input-hint err';
    dom.inputHint.textContent = `⚠️ ต้องมากกว่ายอดก่อนหน้า (${Number(meter.prev).toLocaleString()})`;
    dom.inputHint.style.display = 'block'; dom.saveBtn.disabled = true;
    resetCostDisplay(); return;
  }

  state.isValid = true; state.currentReading = val;
  const units = val - meter.prev;
  dom.inputHint.className   = 'input-hint ok';
  dom.inputHint.textContent = units === 0 ? `✓ ไม่มีการใช้น้ำ (0 หน่วย)` : `✓ ใช้ไป ${units.toLocaleString()} หน่วย`;
  dom.inputHint.style.display = 'block';
  dom.saveBtn.disabled = false;
  updateCostDisplay(meter.prev, val);
}

/* ════════════════════════════════
   COST
════════════════════════════════ */
function updateCostDisplay(prev, curr) {
  const units = curr - prev;
  const water = units * RATE_PER_UNIT;
  const total = water + SERVICE_FEE;
  dom.unitsUsed.textContent   = `${units.toLocaleString()} หน่วย`;
  dom.waterCost.textContent   = `${water.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
  dom.totalAmount.textContent = `${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
}
function resetCostDisplay() {
  dom.unitsUsed.textContent = '— หน่วย';
  dom.waterCost.textContent = '— บาท';
  dom.totalAmount.textContent = '—';
}

/* ════════════════════════════════
   PAYMENT STATUS
════════════════════════════════ */
function selectPayment(status) {
  state.paymentStatus = status;
  dom.payOptPaid.classList.toggle('active',   status === 'paid');
  dom.payOptUnpaid.classList.toggle('active', status === 'unpaid');
  if (status === 'paid') {
    dom.saveBtnLabel.textContent = 'บันทึก + ออกใบเสร็จ';
    dom.saveBtn.classList.remove('unpaid-mode');
  } else {
    dom.saveBtnLabel.textContent = 'บันทึกยอดมิเตอร์';
    dom.saveBtn.classList.add('unpaid-mode');
  }
}

/* ════════════════════════════════
   SAVE
════════════════════════════════ */
async function handleSave() {
  if (!state.isValid || !state.selectedHouse) return;

  const house = state.selectedHouse;
  const meter = house.meters?.[state.selectedMeter];
  if (!meter) {
    dom.errorText.textContent  = 'ไม่พบข้อมูลมิเตอร์ กรุณาเลือกบ้านใหม่';
    dom.errorBox.style.display = 'flex';
    return;
  }

  const curr   = state.currentReading;
  const isPaid = state.paymentStatus === 'paid';

  dom.saveBtn.disabled       = true;
  dom.errorBox.style.display = 'none';

  try {
    const res = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action:          'saveReading',
        house_id:        house.id,
        meter_key:       meter.meterKey || meter.id || 'meter1',
        current_reading: curr,
        payment_status:  state.paymentStatus,
        reader_name:     state.currentUser?.displayName || 'เจ้าหน้าที่',
      })
    });

    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'บันทึกไม่สำเร็จ');

    const saved = json.data;
    meter.prev     = saved.current_reading;
    meter.prevDate = saved.read_date;

    state.currentReading        = null;
    state.isValid               = false;
    dom.currentInput.value      = '';
    dom.inputHint.style.display = 'none';
    refreshMeterView();
    resetCostDisplay();

    if (isPaid) {
      populateReceipt(house, meter, saved);
      showToast('บันทึก + ออกใบเสร็จสำเร็จ!');
      setTimeout(() => openSheet(), 600);
    } else {
      showToast('บันทึกสำเร็จ (ยังไม่ชำระ)');
    }
  } catch (err) {
    dom.errorText.textContent  = err.message || 'เกิดข้อผิดพลาด';
    dom.errorBox.style.display = 'flex';
  } finally {
    dom.saveBtn.disabled = false;
  }
}

/* ════════════════════════════════
   RECEIPT
════════════════════════════════ */
function populateReceipt(house, meter, saved) {
  document.getElementById('rNo').textContent    = `ใบเสร็จ #${saved.receipt_no}`;
  document.getElementById('rName').textContent  = house.name;
  document.getElementById('rAddr').textContent  = house.addr || house.address || house.num;
  document.getElementById('rMeter').textContent = meter.label || 'มิเตอร์ 1';
  document.getElementById('rMonth').textContent = formatMonthTH(new Date(saved.read_date));
  document.getElementById('rDate').textContent  = formatDateTH(new Date(saved.read_date));
  document.getElementById('rPrev').textContent  = Number(saved.prev_reading).toLocaleString();
  document.getElementById('rCurr').textContent  = Number(saved.current_reading).toLocaleString();
  document.getElementById('rUnits').textContent = Number(saved.units_used).toLocaleString();
  document.getElementById('rWater').textContent = `${Number(saved.water_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
  document.getElementById('rTotal').textContent = `${Number(saved.total_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
}

function openSheet()  { dom.sheetOverlay.classList.add('show'); dom.receiptSheet.classList.add('open'); document.body.style.overflow = 'hidden'; }
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
   HISTORY
════════════════════════════════ */
async function loadHistory(force = false) {
  if (historyLoaded && !force) { renderHistoryList(dom.historySearchInput.value); return; }
  try {
    dom.historySummary.textContent = 'กำลังโหลดข้อมูล...';
    const res  = await fetch(`${API_URL}?action=history&limit=100`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'โหลดประวัติไม่สำเร็จ');
    state.historyItems = Array.isArray(json.items) ? json.items : [];
    historyLoaded = true;
    dom.historySummary.textContent = `ทั้งหมด ${state.historyItems.length.toLocaleString()} รายการล่าสุด`;
    renderHistoryList(dom.historySearchInput.value);
  } catch (err) {
    dom.historySummary.textContent = 'โหลดข้อมูลไม่สำเร็จ';
    dom.historyList.innerHTML = `<div class="history-empty">${err.message || 'เกิดข้อผิดพลาด'}</div>`;
  }
}

function refreshHistory() { loadHistory(true); }

function renderHistoryList(query = '') {
  const q = String(query || '').trim().toLowerCase();
  const items = state.historyItems.filter(item => {
    const h = String(item.house_no  || '').toLowerCase();
    const n = String(item.owner_name || '').toLowerCase();
    return !q || h.includes(q) || n.includes(q);
  });
  if (items.length === 0) {
    dom.historyList.innerHTML = `<div class="history-empty">ไม่พบข้อมูลย้อนหลัง</div>`;
    return;
  }
  dom.historyList.innerHTML = items.map(item => {
    const paidClass = item.payment_status === 'unpaid' ? 'unpaid' : 'paid';
    const paidLabel = item.payment_status === 'unpaid' ? 'ยังไม่ชำระ' : 'ชำระแล้ว';
    return `
      <div class="history-item">
        <div class="history-top">
          <div>
            <div class="history-house">${item.house_no || '-'} · ${item.meter_label || '-'}</div>
            <div class="history-name">${item.owner_name || '-'}</div>
          </div>
          <span class="history-badge ${paidClass}">${paidLabel}</span>
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

function openHistorySheet()  { dom.historyOverlay.classList.add('show'); dom.historySheet.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeHistorySheet() { dom.historyOverlay.classList.remove('show'); dom.historySheet.classList.remove('open'); document.body.style.overflow = ''; }

/* ════════════════════════════════
   UI HELPERS
════════════════════════════════ */
function showSection(el) {
  if (!el) return;
  el.style.display   = 'block';
  el.style.animation = 'cardIn 0.35s cubic-bezier(0.22,1,0.36,1) both';
}
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
    if (e.key === 'Escape') { closeSheet(); closeHistorySheet(); cancelLogout(); }
  });

  // Check saved session → auto-login if found
  const autoLogged = checkSavedSession();

  if (autoLogged) {
    // Load bootstrap in background
    loadBootstrap().catch(err => console.error('[bootstrap]', err));
  } else {
    // Wait until user logs in, bootstrap is called after enterApp
    // Trigger bootstrap after login (patched in enterApp below)
  }
})();

/* Override enterApp to also load bootstrap */
const _enterApp = enterApp;
window.enterApp = function(displayName) {
  _enterApp(displayName);
  loadBootstrap().catch(err => {
    console.error('[bootstrap]', err);
  });
};

async function loadBootstrap(force = false) {
  if (!force) {
    const cached = loadBootstrapCache();
    if (cached) {
      HOUSES = cached;
      HOUSE_MAP = new Map(HOUSES.map(h => [String(h.id), h]));
      renderList();
      return;
    }
  }

  const res = await fetch(`${API_URL}?action=bootstrap`);
  const json = await res.json();

  if (!json.ok) {
    throw new Error(json.error || 'โหลดข้อมูลไม่สำเร็จ');
  }

  HOUSES = Array.isArray(json.houses) ? json.houses : [];
  HOUSE_MAP = new Map(HOUSES.map(h => [String(h.id), h]));

  saveBootstrapCache(HOUSES);
  renderList();
}