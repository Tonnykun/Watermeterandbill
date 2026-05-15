// Supabase Edge Function: water-meter-api
// Deploy this file as: supabase/functions/water-meter-api/index.ts
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Optional secret:
//   WATER_API_TOKEN  (if set, the web app must send Authorization: Bearer <token>)

const DEFAULT_RATE_PER_UNIT = 3;
const DEFAULT_SERVICE_FEE = 0;
const ZERO_USAGE_SERVICE_FEE = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type JsonMap = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    assertAuthorized(req);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = String(url.searchParams.get("action") || "").trim();

      if (action === "bootstrap") {
        return json({ ok: true, houses: await getBootstrapData() });
      }

      if (action === "history") {
        const limit = Number(url.searchParams.get("limit") || 1000);
        const month = String(url.searchParams.get("month") || "").trim();
        return json({ ok: true, items: await getHistoryData(limit, month) });
      }

      if (action === "summary") {
        const month = String(url.searchParams.get("month") || "").trim();
        return json({ ok: true, summary: await getMonthlySummary(month) });
      }

      if (action === "ping") {
        return json({ ok: true, message: "pong", source: "supabase-edge" });
      }

      return json({ ok: false, error: "Unknown GET action" }, 400);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = String(body.action || "").trim();

      if (action === "login") {
        return json(await login(body));
      }

      if (action === "logout") {
        await logLogin(body.username || "", body.displayName || body.display_name || "", body.reason === "auto_logout" ? "auto_logout" : "logout", "");
        return json({ ok: true });
      }

      if (action === "saveReading") {
        return json(await runActionWithTransactionLog(body, "saveReading", "reading_log", `${body.house_id || ""}/${body.meter_key || ""}`, saveReading));
      }

      if (action === "updatePaymentStatus") {
        return json(await runActionWithTransactionLog(body, "updatePaymentStatus", "reading_log", String(body.reading_id || ""), updatePaymentStatus));
      }

      if (action === "logReceiptPrint") {
        const result = {
          ok: true,
          message: "receipt print logged",
          reading_id: String(body.reading_id || ""),
          print_action: String(body.print_action || "printReceipt"),
          logged_at: new Date().toISOString(),
        };
        await logTransaction({
          request_id: body.request_id || `print-${result.reading_id}-${Date.now()}`,
          action: result.print_action,
          actor_username: body.actor_username || "",
          actor_display_name: body.actor_display_name || "",
          target_type: "receipt",
          target_id: result.reading_id,
          payload: body,
          result,
          status: "success",
          error_message: "",
        });
        return json(result);
      }

      return json({ ok: false, error: "Unknown POST action" }, 400);
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (err) {
    return json({ ok: false, error: errorMessage(err) || "เกิดข้อผิดพลาด" }, 500);
  }
});

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err || '');
}

function json(payload: JsonMap, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function assertAuthorized(req: Request) {
  const requiredToken = Deno.env.get("WATER_API_TOKEN") || "";
  if (!requiredToken) return;

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-token") || "";

  if (token !== requiredToken) {
    throw new Error("Unauthorized");
  }
}

function supabaseConfig() {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return { url, key };
}

async function supabaseRequest(path: string, method = "GET", payload?: JsonMap, prefer?: string) {
  const cfg = supabaseConfig();
  const headers: Record<string, string> = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
  };

  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }

  return data;
}

async function supabaseRpc(functionName: string, payload: JsonMap) {
  return supabaseRequest(`rpc/${functionName}`, "POST", payload || {}, "return=representation");
}

async function supabaseSingle(path: string) {
  const rows = await supabaseRequest(path, "GET");
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function supabasePatch(path: string, payload: JsonMap) {
  return supabaseRequest(path, "PATCH", payload, "return=representation");
}

function eq(value: any) {
  return encodeURIComponent(String(value ?? ""));
}

function normalizePaymentStatus(value: any) {
  return String(value || "").toLowerCase() === "unpaid" ? "unpaid" : "paid";
}

function normalizePaymentMethod(value: any) {
  return String(value || "").toLowerCase() === "transfer" ? "transfer" : "cash";
}

function isInactive(value: any) {
  const s = String(value ?? "").trim().toLowerCase();
  return ["inactive", "false", "0", "no", "n"].includes(s);
}

function bangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    y: map.year,
    m: map.month,
    d: map.day,
    date: `${map.year}-${map.month}-${map.day}`,
    month: `${map.year}-${map.month}`,
  };
}

function generateReceiptNo(date = new Date()) {
  const parts = bangkokDateParts(date);
  const yy = String(parts.y).slice(-2);
  const r = String(Math.floor(Math.random() * 900) + 100);
  return `${yy}${parts.m}-${r}`;
}

async function login(payload: JsonMap) {
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "");

  if (!username || !password) {
    return { ok: false, error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" };
  }

  try {
    const rows = await supabaseRpc("verify_app_login", {
      p_username: username,
      p_password: password,
    });

    const result = Array.isArray(rows) ? rows[0] : rows;

    if (!result || result.ok !== true) {
      await logLogin(username, "", "login_failed", result?.error || "login failed");
      return { ok: false, error: result?.error || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
    }

    await logLogin(result.username, result.display_name, "login_success", "");

    return {
      ok: true,
      user: {
        username: result.username,
        displayName: result.display_name,
        role: result.role || "staff",
      },
    };
  } catch (err) {
    await logLogin(username, "", "login_failed", errorMessage(err) || "");
    return { ok: false, error: errorMessage(err) || "เข้าสู่ระบบไม่สำเร็จ" };
  }
}

async function logLogin(username: string, displayName: string, action: string, note: string) {
  try {
    await supabaseRequest("login_logs", "POST", {
      username: username || "",
      display_name: displayName || "",
      action: action || "login_failed",
      note: note || "",
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[logLogin]", errorMessage(err) || err);
  }
}

async function getBootstrapData() {
  const houses = await supabaseRequest("houses?select=house_id,house_no,owner_name,address,status,note&order=house_no.asc&limit=1000", "GET") || [];
  const meters = await supabaseRequest("meters?select=house_id,meter_key,meter_code,meter_label,meter_type,last_reading,last_read_date,rate_per_unit,service_fee,active&order=house_id.asc,meter_label.asc&limit=1000", "GET") || [];

  const metersByHouse: Record<string, any[]> = {};
  meters.filter((m: JsonMap) => !isInactive(m.active)).forEach((m: JsonMap) => {
    const houseId = String(m.house_id || "").trim();
    if (!houseId) return;
    if (!metersByHouse[houseId]) metersByHouse[houseId] = [];

    metersByHouse[houseId].push({
      id: String(m.meter_label || "").replace("มิเตอร์ ", "M") || "M1",
      meterKey: String(m.meter_key || "").trim(),
      label: String(m.meter_label || "มิเตอร์ 1"),
      desc: buildMeterDesc(m),
      prev: Number(m.last_reading || 0),
      prevDate: m.last_read_date || "",
      rate_per_unit: m.rate_per_unit === null || m.rate_per_unit === "" ? DEFAULT_RATE_PER_UNIT : Number(m.rate_per_unit),
      service_fee: m.service_fee === null || m.service_fee === "" ? DEFAULT_SERVICE_FEE : Number(m.service_fee),
    });
  });

  Object.keys(metersByHouse).forEach(houseId => {
    metersByHouse[houseId].sort((a, b) => extractMeterOrder(a.label) - extractMeterOrder(b.label));
  });

  return houses
    .filter((h: JsonMap) => !isInactive(h.status))
    .map((h: JsonMap) => ({
      id: String(h.house_id || "").trim(),
      num: String(h.house_no || "").trim(),
      name: String(h.owner_name || "").trim(),
      addr: String(h.address || "").trim(),
      meters: metersByHouse[h.house_id] || [],
    }))
    .filter((h: JsonMap) => h.id && h.num && h.name && h.meters.length > 0)
    .sort(compareHouseNoNatural);
}

function getHouseSortParts(value: unknown) {
  const text = String(value || '').trim();
  const match = text.match(/d+/);

  return {
    number: match ? Number(match[0]) : Number.MAX_SAFE_INTEGER,
    suffix: match ? text.slice((match.index || 0) + match[0].length) : text,
    text,
  };
}

function compareHouseNoNatural(a: JsonMap, b: JsonMap) {
  const aa = getHouseSortParts(a?.num || a?.house_no || a);
  const bb = getHouseSortParts(b?.num || b?.house_no || b);

  if (aa.number !== bb.number) return aa.number - bb.number;

  const suffixCompare = aa.suffix.localeCompare(bb.suffix, 'th', {
    numeric: true,
    sensitivity: 'base',
  });

  if (suffixCompare !== 0) return suffixCompare;

  return aa.text.localeCompare(bb.text, 'th', {
    numeric: true,
    sensitivity: 'base',
  });
}

function buildMeterDesc(m: JsonMap) {
  const code = String(m.meter_code || "").trim();
  const type = String(m.meter_type || "").trim();
  return [type, code ? `หมายเลข ${code}` : ""].filter(Boolean).join(" · ");
}

function extractMeterOrder(label: string) {
  const match = String(label || "").match(/\d+/);
  return match ? Number(match[0]) : 999;
}

async function getHistoryData(limit: number, month: string) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit || 100)));
  let path = `reading_log?select=*&order=created_at.desc&limit=${safeLimit}`;
  if (month) path += `&read_month=eq.${eq(month)}`;

  const rows = await supabaseRequest(path, "GET") || [];

  return rows
    .filter((row: JsonMap) => String(row.reading_id || "").trim() !== "")
    .map((row: JsonMap) => ({
      reading_id: row.reading_id,
      created_at: row.created_at,
      read_date: row.read_date,
      house_id: String(row.house_id || "").trim(),
      house_no: String(row.house_no || ""),
      owner_name: String(row.owner_name || ""),
      address: String(row.house_address || row.address || ""),
      addr: String(row.house_address || row.address || ""),
      house_address: String(row.house_address || row.address || ""),
      meter_key: row.meter_key,
      meter_label: row.meter_label,
      meter_code: row.meter_code,
      prev_reading: Number(row.prev_reading || 0),
      current_reading: Number(row.current_reading || 0),
      units_used: Number(row.units_used || 0),
      rate_per_unit: Number(row.rate_per_unit || DEFAULT_RATE_PER_UNIT),
      water_cost: Number(row.water_cost || 0),
      service_fee: Number(row.service_fee || 0),
      total_amount: Number(row.total_amount || 0),
      payment_status: normalizePaymentStatus(row.payment_status),
      payment_method: normalizePaymentMethod(row.payment_method),
      paid_at: row.paid_at || "",
      reader_name: row.reader_name || "",
      receipt_no: row.receipt_no || "",
      remark: row.remark || "",
    }));
}

async function getMonthlySummary(month: string) {
  let path = "reading_log?select=reading_id,read_month,house_id,house_no,payment_status,payment_method,total_amount&limit=1000";
  if (month) path += `&read_month=eq.${eq(month)}`;

  const rows = await supabaseRequest(path, "GET") || [];
  const paidRows = rows.filter((row: JsonMap) => normalizePaymentStatus(row.payment_status) !== "unpaid");
  const cashRows = paidRows.filter((row: JsonMap) => normalizePaymentMethod(row.payment_method) === "cash");
  const transferRows = paidRows.filter((row: JsonMap) => normalizePaymentMethod(row.payment_method) === "transfer");

  return {
    month,
    recorded_meters: rows.length,
    cash_amount: sumAmount(cashRows),
    cash_houses: countUniqueHouses(cashRows),
    cash_meters: cashRows.length,
    transfer_amount: sumAmount(transferRows),
    transfer_houses: countUniqueHouses(transferRows),
    transfer_meters: transferRows.length,
    paid_meters: paidRows.length,
    unpaid_meters: rows.filter((row: JsonMap) => normalizePaymentStatus(row.payment_status) === "unpaid").length,
  };
}

function sumAmount(rows: JsonMap[]) {
  return rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
}

function countUniqueHouses(rows: JsonMap[]) {
  return new Set(rows.map(row => String(row.house_id || row.house_no || ""))).size;
}

async function saveReading(payload: JsonMap) {
  const houseId = String(payload.house_id || "").trim();
  const meterKey = String(payload.meter_key || "").trim();
  const currentReading = Number(payload.current_reading);
  const paymentStatus = normalizePaymentStatus(payload.payment_status);
  const paymentMethod = paymentStatus === "paid" ? normalizePaymentMethod(payload.payment_method) : "";
  const readerName = String(payload.reader_name || "").trim() || "เจ้าหน้าที่";
  const remark = String(payload.remark || "").trim();

  if (!houseId || !meterKey || !Number.isInteger(currentReading)) {
    throw new Error("ข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง");
  }

  const house = await supabaseSingle(`houses?house_id=eq.${eq(houseId)}&select=house_id,house_no,owner_name,address,status&limit=1`);
  if (!house) throw new Error("ไม่พบบ้านที่เลือก");

  const meter = await supabaseSingle(`meters?house_id=eq.${eq(houseId)}&meter_key=eq.${eq(meterKey)}&select=*&limit=1`);
  if (!meter) throw new Error("ไม่พบมิเตอร์ที่เลือก");

  const prevReading = Number(meter.last_reading || 0);
  const ratePerUnit = Number(meter.rate_per_unit || DEFAULT_RATE_PER_UNIT);
  const baseServiceFee = meter.service_fee === null || meter.service_fee === "" ? DEFAULT_SERVICE_FEE : Number(meter.service_fee);

  if (currentReading < prevReading) {
    throw new Error(`ยอดใหม่ต้องไม่น้อยกว่ายอดเดิม (${prevReading})`);
  }

  const unitsUsed = currentReading - prevReading;
  const serviceFee = unitsUsed === 0 ? ZERO_USAGE_SERVICE_FEE : baseServiceFee;
  const waterCost = unitsUsed * ratePerUnit;
  const totalAmount = waterCost + serviceFee;
  const now = new Date();
  const createdAt = now.toISOString();
  const parts = bangkokDateParts(now);

  const existing = await supabaseSingle(`reading_log?house_id=eq.${eq(houseId)}&meter_key=eq.${eq(meterKey)}&read_month=eq.${eq(parts.month)}&select=reading_id&limit=1`);
  if (existing) {
    throw new Error(`บ้านเลขที่ ${house.house_no || houseId} / ${meter.meter_label || meterKey} บันทึกของเดือนนี้แล้ว หากต้องการเปลี่ยนสถานะ ให้ใช้ปุ่มแก้ไขในประวัติย้อนหลัง`);
  }

  const isPaid = paymentStatus === "paid";
  const paidAt = isPaid ? createdAt : null;
  const receiptNo = isPaid ? generateReceiptNo(now) : "";
  const readingId = `R-${Date.now()}`;

  const insertPayload = {
    reading_id: readingId,
    created_at: createdAt,
    read_date: parts.date,
    read_month: parts.month,
    house_id: houseId,
    house_no: String(house.house_no || ""),
    owner_name: String(house.owner_name || ""),
    house_address: String(house.address || ""),
    meter_key: meterKey,
    meter_label: String(meter.meter_label || ""),
    meter_code: String(meter.meter_code || ""),
    prev_reading: prevReading,
    current_reading: currentReading,
    units_used: unitsUsed,
    rate_per_unit: ratePerUnit,
    water_cost: waterCost,
    service_fee: serviceFee,
    total_amount: totalAmount,
    payment_status: paymentStatus,
    payment_method: paymentMethod,
    paid_at: paidAt,
    reader_name: readerName,
    receipt_no: receiptNo,
    remark,
  };

  await supabaseRequest("reading_log", "POST", insertPayload, "return=representation");
  await supabasePatch(`meters?house_id=eq.${eq(houseId)}&meter_key=eq.${eq(meterKey)}`, {
    last_reading: currentReading,
    last_read_date: parts.date,
  });

  return {
    ok: true,
    data: {
      ...insertPayload,
      address: insertPayload.house_address,
      addr: insertPayload.house_address,
    },
  };
}

async function updatePaymentStatus(payload: JsonMap) {
  const readingId = String(payload.reading_id || "").trim();
  const newStatus = normalizePaymentStatus(payload.payment_status);
  const paymentMethod = newStatus === "paid" ? normalizePaymentMethod(payload.payment_method) : "";
  const editorName = String(payload.editor_name || "").trim() || "เจ้าหน้าที่";

  if (!readingId) throw new Error("ไม่พบ reading_id");

  const oldItem = await supabaseSingle(`reading_log?reading_id=eq.${eq(readingId)}&select=*&limit=1`);
  if (!oldItem) throw new Error("ไม่พบรายการที่ต้องการแก้ไข");

  const updatePayload: JsonMap = {};
  const hasReadingEdit = payload.current_reading !== undefined && payload.current_reading !== null && String(payload.current_reading).trim() !== "";

  if (hasReadingEdit) {
    const currentReading = Number(payload.current_reading);
    const prevReading = Number(oldItem.prev_reading || 0);

    if (!Number.isInteger(currentReading)) throw new Error("ยอดมิเตอร์ใหม่ไม่ถูกต้อง");
    if (currentReading < prevReading) throw new Error(`ยอดใหม่ต้องไม่น้อยกว่ายอดก่อนหน้า (${prevReading})`);

    const meter = await supabaseSingle(`meters?house_id=eq.${eq(oldItem.house_id)}&meter_key=eq.${eq(oldItem.meter_key)}&select=*&limit=1`);
    const ratePerUnit = Number(oldItem.rate_per_unit || DEFAULT_RATE_PER_UNIT);
    const baseServiceFee = meter && meter.service_fee !== null && meter.service_fee !== "" ? Number(meter.service_fee) : DEFAULT_SERVICE_FEE;
    const unitsUsed = currentReading - prevReading;
    const serviceFee = unitsUsed === 0 ? ZERO_USAGE_SERVICE_FEE : baseServiceFee;
    const waterCost = unitsUsed * ratePerUnit;
    const totalAmount = waterCost + serviceFee;

    Object.assign(updatePayload, {
      current_reading: currentReading,
      units_used: unitsUsed,
      rate_per_unit: ratePerUnit,
      water_cost: waterCost,
      service_fee: serviceFee,
      total_amount: totalAmount,
    });

    await supabasePatch(`meters?house_id=eq.${eq(oldItem.house_id)}&meter_key=eq.${eq(oldItem.meter_key)}`, {
      last_reading: currentReading,
      last_read_date: oldItem.read_date || bangkokDateParts().date,
    });
  }

  const now = new Date();
  updatePayload.payment_status = newStatus;
  updatePayload.payment_method = paymentMethod;
  updatePayload.paid_at = newStatus === "paid" ? now.toISOString() : null;
  updatePayload.reader_name = editorName;

  if (newStatus === "paid" && !oldItem.receipt_no) {
    updatePayload.receipt_no = generateReceiptNo(now);
  }

  const updatedRows = await supabasePatch(`reading_log?reading_id=eq.${eq(readingId)}`, updatePayload);
  const updated = Array.isArray(updatedRows) && updatedRows.length > 0 ? updatedRows[0] : { ...oldItem, ...updatePayload };

  return {
    ok: true,
    data: {
      ...updated,
      address: updated.house_address || updated.address || "",
      addr: updated.house_address || updated.address || "",
    },
  };
}

async function getExistingTransaction(requestId: string) {
  if (!requestId) return null;
  try {
    return await supabaseSingle(`transaction_logs?request_id=eq.${eq(requestId)}&select=request_id,action,status,result,error_message&limit=1`);
  } catch (err) {
    console.warn("[getExistingTransaction]", errorMessage(err) || err);
    return null;
  }
}

async function logTransaction(payload: JsonMap) {
  try {
    await supabaseRequest("transaction_logs", "POST", {
      request_id: payload.request_id || null,
      action: String(payload.action || ""),
      actor_username: String(payload.actor_username || ""),
      actor_display_name: String(payload.actor_display_name || ""),
      target_type: String(payload.target_type || ""),
      target_id: String(payload.target_id || ""),
      payload: payload.payload || {},
      result: payload.result || {},
      status: String(payload.status || "success"),
      error_message: String(payload.error_message || ""),
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[logTransaction]", errorMessage(err) || err);
  }
}

async function runActionWithTransactionLog(body: JsonMap, actionName: string, targetType: string, targetId: string, actionFn: (payload: JsonMap) => Promise<JsonMap>) {
  const requestId = String(body.request_id || "").trim();

  if (requestId) {
    const existing = await getExistingTransaction(requestId);
    if (existing && existing.status === "success" && existing.result) return existing.result;
    if (existing && existing.status === "failed") {
      return { ok: false, error: existing.error_message || "คำขอนี้เคยทำรายการไม่สำเร็จแล้ว" };
    }
  }

  try {
    const result = await actionFn(body);
    await logTransaction({
      request_id: requestId,
      action: actionName,
      actor_username: body.actor_username || "",
      actor_display_name: body.actor_display_name || body.reader_name || body.editor_name || "",
      target_type: targetType,
      target_id: targetId,
      payload: body,
      result,
      status: result && result.ok === false ? "failed" : "success",
      error_message: result && result.error ? result.error : "",
    });
    return result;
  } catch (err) {
    const errorResult = { ok: false, error: errorMessage(err) || "เกิดข้อผิดพลาด" };
    await logTransaction({
      request_id: requestId,
      action: actionName,
      actor_username: body.actor_username || "",
      actor_display_name: body.actor_display_name || body.reader_name || body.editor_name || "",
      target_type: targetType,
      target_id: targetId,
      payload: body,
      result: errorResult,
      status: "failed",
      error_message: errorMessage(err) || "",
    });
    return errorResult;
  }
}
