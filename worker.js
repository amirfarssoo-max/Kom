/**
 * 📚 استادیوم مطالعه — Study Arena
 * ربات + مینی‌اپ رقابت مطالعهٔ کنکوری، تک‌فایل، روی Cloudflare Workers + D1
 *
 * پیکربندی: BOT_TOKEN و WEBHOOK_SECRET با wrangler secret put
 *           BOT_USERNAME و APP_SHORT_NAME در wrangler.toml
 */

/* ============================ ثابت‌ها ============================ */

const SUBJECTS = [
  { c: 'mat', e: '📐', n: 'ریاضی',  col: '#60a5fa' },
  { c: 'phy', e: '🧲', n: 'فیزیک',  col: '#a78bfa' },
  { c: 'che', e: '⚗️', n: 'شیمی',   col: '#34d399' },
  { c: 'bio', e: '🧬', n: 'زیست',   col: '#4ade80' },
  { c: 'lit', e: '📖', n: 'ادبیات', col: '#fbbf24' },
  { c: 'ara', e: '🕌', n: 'عربی',   col: '#f472b6' },
  { c: 'rel', e: '☪️', n: 'دینی',   col: '#2dd4bf' },
  { c: 'eng', e: '🔤', n: 'زبان',   col: '#38bdf8' },
  { c: 'geo', e: '🌍', n: 'زمین',   col: '#c084fc' },
  { c: 'tst', e: '📝', n: 'تست/آزمون', col: '#fb923c' },
  { c: 'rev', e: '🔁', n: 'مرور',   col: '#94a3b8' },
  { c: 'oth', e: '📚', n: 'سایر',   col: '#cbd5e1' },
];
const subj = (c) => SUBJECTS.find((s) => s.c === c) || SUBJECTS[SUBJECTS.length - 1];

const ACHIEVEMENTS = [
  { c: 'first',  e: '🌱', n: 'اولین قدم',      d: 'اولین مطالعه را ثبت کردی' },
  { c: 'h10',    e: '📗', n: '۱۰ ساعت',        d: 'مجموع ۱۰ ساعت مطالعه' },
  { c: 'h50',    e: '📘', n: '۵۰ ساعت',        d: 'مجموع ۵۰ ساعت مطالعه' },
  { c: 'h100',   e: '📕', n: '۱۰۰ ساعت',       d: 'مجموع ۱۰۰ ساعت مطالعه' },
  { c: 'h300',   e: '🏛', n: '۳۰۰ ساعت',       d: 'مجموع ۳۰۰ ساعت مطالعه' },
  { c: 's3',     e: '🔥', n: 'سه روز پیوسته',  d: 'استریک ۳ روزه' },
  { c: 's7',     e: '🔥', n: 'یک هفته پیوسته', d: 'استریک ۷ روزه' },
  { c: 's30',    e: '🌋', n: 'یک ماه پیوسته',  d: 'استریک ۳۰ روزه' },
  { c: 's100',   e: '💎', n: 'صد روز پیوسته',  d: 'استریک ۱۰۰ روزه' },
  { c: 'mara',   e: '🏃', n: 'ماراتن',          d: '۶ ساعت در یک روز' },
  { c: 'iron',   e: '🛡', n: 'آهنین',           d: '۱۰ ساعت در یک روز' },
  { c: 'owl',    e: '🦉', n: 'شب‌زنده‌دار',     d: 'مطالعه بعد از نیمه‌شب' },
  { c: 'lark',   e: '🌅', n: 'سحرخیز',          d: 'مطالعه قبل از ۶:۳۰ صبح' },
  { c: 'goal10', e: '🎯', n: 'هدف‌زن',          d: '۱۰ روز رسیدن به هدف روزانه' },
  { c: 'gold',   e: '🥇', n: 'قهرمان روز',      d: 'نفر اول جدول روزانهٔ گروه' },
  { c: 'week',   e: '👑', n: 'قهرمان هفته',     d: 'نفر اول جدول هفتگی گروه' },
  { c: 'social', e: '🤝', n: 'رفیق‌آور',        d: 'یک نفر با لینک تو عضو شد' },
];

const CFG = {
  TIMER_CAP_MIN: 14 * 60,   // سقف تایمر فراموش‌شده
  STREAK_MIN: 30,           // حداقل دقیقهٔ روز برای حفظ استریک
  MAX_LOG: 1440,
  OUTBOX_BATCH: 30,         // سقف ارسال در هر اجرای cron (محدودیت subrequest)
};

/* ============================ ابزار زمان ============================ */

const TEHRAN = 210 * 60 * 1000; // UTC+03:30 (ایران DST ندارد)

function tParts(ms = Date.now()) {
  const d = new Date(ms + TEHRAN);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
           h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
}
function dayKey(ms = Date.now()) {
  const p = tParts(ms);
  return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
}
const shiftDay = (key, n) => dayKey(Date.parse(key + 'T00:00:00Z') + n * 86400000 - TEHRAN + TEHRAN);
const dowOf = (key) => new Date(key + 'T00:00:00Z').getUTCDay(); // 0=یکشنبه … 6=شنبه
function persianWeek(key) {                                       // شنبه تا key
  const back = (dowOf(key) + 1) % 7;
  return [shiftDay(key, -back), key];
}
const isFriday = (key) => dowOf(key) === 5;

const div = (a, b) => Math.floor(a / b);
function g2j(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400)
           - 80 + gd + gdm[gm - 1];
  jy += 33 * div(days, 12053); days %= 12053;
  jy += 4 * div(days, 1461);   days %= 1461;
  if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}
const J_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور',
                  'مهر','آبان','آذر','دی','بهمن','اسفند'];
const DOW_FA = ['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'];
function jalali(key, withDow = true) {
  const [y, m, d] = key.split('-').map(Number);
  const j = g2j(y, m, d);
  const body = j.jd + ' ' + J_MONTHS[j.jm - 1];
  return withDow ? DOW_FA[dowOf(key)] + ' ' + body : body;
}

/* ============================ ابزار متن ============================ */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const fa = (s) => String(s).replace(/\d/g, (d) => FA_DIGITS[+d]);
const norm = (s = '') => s
  .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
  .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
  .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').trim();

function dur(min) {
  min = Math.max(0, Math.round(min));
  const h = div(min, 60), m = min % 60;
  if (!h) return fa(m) + ' دقیقه';
  if (!m) return fa(h) + ' ساعت';
  return fa(h) + ' ساعت و ' + fa(m) + ' دقیقه';
}
const bar = (pct, size = 10) => {
  const f = Math.max(0, Math.min(size, Math.round((pct / 100) * size)));
  return '▓'.repeat(f) + '░'.repeat(size - f);
};
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** «۲ ساعت ریاضی» / «۹۰ دقیقه فیزیک» / «۱:۳۰ زیست» / «۴۵» */
function parseStudy(raw) {
  const t = norm(raw).toLowerCase();
  let mins = null, m;
  if ((m = t.match(/(\d+)\s*[:.]\s*(\d{1,2})/))) mins = +m[1] * 60 + +m[2];
  if (mins === null && (m = t.match(/(\d+(?:\.\d+)?)\s*(ساعت|ساعته|h)/))) mins = Math.round(parseFloat(m[1]) * 60);
  if (mins === null && (m = t.match(/(\d+)\s*(دقیقه|دقه|min|m)\b/)))     mins = +m[1];
  if (mins === null && (m = t.match(/^(\d{1,3})$/)))                     mins = +m[1];
  if (mins === null || mins < 1 || mins > CFG.MAX_LOG) return null;
  let found = SUBJECTS.find((s) => t.includes(s.n));
  if (!found && /(حسابان|گسسته|هندسه|آمار)/.test(t)) found = subj('mat');
  if (!found && /(تست|آزمون|قلمچی|گاج)/.test(t))     found = subj('tst');
  return { minutes: mins, subject: (found || subj('oth')).c };
}

/* ============================ تلگرام ============================ */

async function tg(env, method, payload) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok && !/not modified|message to (edit|delete) not found|query is too old/i.test(j.description || ''))
    console.error(method, j.description);
  return j;
}
const send = (env, chat_id, text, kb) => tg(env, 'sendMessage',
  { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    reply_markup: kb ? { inline_keyboard: kb } : undefined });
const editMsg = (env, chat_id, message_id, text, kb) => tg(env, 'editMessageText',
  { chat_id, message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    reply_markup: kb ? { inline_keyboard: kb } : undefined });
const toast = (env, id, text, alert) => tg(env, 'answerCallbackQuery',
  { callback_query_id: id, text: text || '', show_alert: !!alert });

/* ============================ اسکیما (خودکار) ============================ */

let SCHEMA_READY = false;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY, first_name TEXT, username TEXT, created_at INTEGER,
     goal INTEGER NOT NULL DEFAULT 300, xp INTEGER NOT NULL DEFAULT 0,
     panel_chat INTEGER, panel_msg INTEGER, pending TEXT, ref_by INTEGER,
     last_seen INTEGER, grade TEXT)`,
  `CREATE TABLE IF NOT EXISTS groups (
     id INTEGER PRIMARY KEY, title TEXT, added_by INTEGER,
     created_at INTEGER, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS memberships (
     user_id INTEGER NOT NULL, group_id INTEGER NOT NULL, joined_at INTEGER,
     PRIMARY KEY (user_id, group_id))`,
  `CREATE TABLE IF NOT EXISTS timers (
     user_id INTEGER PRIMARY KEY, subject TEXT NOT NULL, started_at INTEGER NOT NULL,
     paused_ms INTEGER NOT NULL DEFAULT 0, paused_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT NOT NULL,
     minutes INTEGER NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL,
     source TEXT NOT NULL DEFAULT 'timer')`,
  `CREATE TABLE IF NOT EXISTS badges (
     user_id INTEGER NOT NULL, code TEXT NOT NULL, at INTEGER NOT NULL,
     PRIMARY KEY (user_id, code))`,
  `CREATE TABLE IF NOT EXISTS outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, text TEXT NOT NULL,
     kb TEXT, tries INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ix_logs_user_day ON logs(user_id, day)`,
  `CREATE INDEX IF NOT EXISTS ix_logs_day      ON logs(day)`,
  `CREATE INDEX IF NOT EXISTS ix_mem_group     ON memberships(group_id)`,
  `CREATE INDEX IF NOT EXISTS ix_mem_user      ON memberships(user_id)`,
];
async function ensureSchema(env) {
  if (SCHEMA_READY) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  SCHEMA_READY = true;
}

/* ============================ دیتابیس ============================ */

const DB = {
  async upsertUser(env, u, refBy) {
    await env.DB.prepare(
      `INSERT INTO users (id, first_name, username, created_at, last_seen, ref_by)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET first_name=?2, username=?3, last_seen=?4`
    ).bind(u.id, u.first_name || '', u.username || '', Date.now(), refBy || null).run();
  },
  user: (env, id) => env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first(),
  setPanel: (env, id, c, m) => env.DB.prepare('UPDATE users SET panel_chat=?,panel_msg=? WHERE id=?').bind(c, m, id).run(),
  setPending: (env, id, v) => env.DB.prepare('UPDATE users SET pending=? WHERE id=?').bind(v, id).run(),
  setGoal: (env, id, g) => env.DB.prepare('UPDATE users SET goal=? WHERE id=?').bind(g, id).run(),
  addXp: (env, id, n) => env.DB.prepare('UPDATE users SET xp=xp+? WHERE id=?').bind(n, id).run(),

  async upsertGroup(env, chat, by) {
    await env.DB.prepare(
      `INSERT INTO groups (id,title,added_by,created_at) VALUES (?1,?2,?3,?4)
       ON CONFLICT(id) DO UPDATE SET title=?2, active=1`
    ).bind(chat.id, chat.title || '', by || null, Date.now()).run();
  },
  offGroup: (env, id) => env.DB.prepare('UPDATE groups SET active=0 WHERE id=?').bind(id).run(),
  join: (env, u, g) => env.DB.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?)').bind(u, g, Date.now()).run(),
  myGroups: (env, u) => env.DB.prepare(
    `SELECT g.id,g.title FROM memberships m JOIN groups g ON g.id=m.group_id
     WHERE m.user_id=? AND g.active=1 ORDER BY m.joined_at DESC LIMIT 12`).bind(u).all().then((r) => r.results || []),
  activeGroups: (env) => env.DB.prepare('SELECT id,title FROM groups WHERE active=1').all().then((r) => r.results || []),

  timer: (env, id) => env.DB.prepare('SELECT * FROM timers WHERE user_id=?').bind(id).first(),
  start: (env, id, s) => env.DB.prepare(
    `INSERT INTO timers (user_id,subject,started_at,paused_ms,paused_at) VALUES (?1,?2,?3,0,NULL)
     ON CONFLICT(user_id) DO UPDATE SET subject=?2,started_at=?3,paused_ms=0,paused_at=NULL`
  ).bind(id, s, Date.now()).run(),
  pause: (env, id) => env.DB.prepare('UPDATE timers SET paused_at=? WHERE user_id=? AND paused_at IS NULL').bind(Date.now(), id).run(),
  resume: (env, id, t) => env.DB.prepare('UPDATE timers SET paused_ms=?,paused_at=NULL WHERE user_id=?')
    .bind(t.paused_ms + (Date.now() - t.paused_at), id).run(),
  clear: (env, id) => env.DB.prepare('DELETE FROM timers WHERE user_id=?').bind(id).run(),
  liveCount: (env) => env.DB.prepare(
    'SELECT COUNT(*) c FROM timers WHERE paused_at IS NULL AND started_at > ?'
  ).bind(Date.now() - CFG.TIMER_CAP_MIN * 60000).first().then((r) => r.c),

  addLog: (env, id, s, m, src) => env.DB.prepare(
    'INSERT INTO logs (user_id,subject,minutes,day,created_at,source) VALUES (?,?,?,?,?,?)'
  ).bind(id, s, m, dayKey(), Date.now(), src || 'timer').run(),
  lastLog: (env, id) => env.DB.prepare('SELECT * FROM logs WHERE user_id=? ORDER BY id DESC LIMIT 1').bind(id).first(),
  delLog: (env, lid, uid) => env.DB.prepare('DELETE FROM logs WHERE id=? AND user_id=?').bind(lid, uid).run(),
  sum: (env, id, f, t) => env.DB.prepare(
    'SELECT COALESCE(SUM(minutes),0) m FROM logs WHERE user_id=? AND day BETWEEN ? AND ?'
  ).bind(id, f, t).first().then((r) => r.m),
  total: (env, id) => env.DB.prepare('SELECT COALESCE(SUM(minutes),0) m FROM logs WHERE user_id=?').bind(id).first().then((r) => r.m),
  breakdown: (env, id, f, t) => env.DB.prepare(
    `SELECT subject, SUM(minutes) m FROM logs WHERE user_id=? AND day BETWEEN ? AND ?
     GROUP BY subject ORDER BY m DESC`).bind(id, f, t).all().then((r) => r.results || []),
  byDay: (env, id, f, t) => env.DB.prepare(
    `SELECT day, SUM(minutes) m FROM logs WHERE user_id=? AND day BETWEEN ? AND ?
     GROUP BY day ORDER BY day`).bind(id, f, t).all().then((r) => r.results || []),
  todayLogs: (env, id) => env.DB.prepare(
    `SELECT id,subject,minutes,created_at FROM logs WHERE user_id=? AND day=?
     ORDER BY id DESC LIMIT 20`).bind(id, dayKey()).all().then((r) => r.results || []),

  async streak(env, id) {
    const { results } = await env.DB.prepare(
      `SELECT day FROM logs WHERE user_id=? GROUP BY day HAVING SUM(minutes)>=?
       ORDER BY day DESC LIMIT 400`).bind(id, CFG.STREAK_MIN).all();
    const set = new Set((results || []).map((r) => r.day));
    const today = dayKey();
    let cur = set.has(today) ? today : shiftDay(today, -1);
    if (!set.has(cur)) return 0;
    let n = 0;
    while (set.has(cur)) { n++; cur = shiftDay(cur, -1); }
    return n;
  },
  goalDays: (env, id, goal) => env.DB.prepare(
    `SELECT COUNT(*) c FROM (SELECT day FROM logs WHERE user_id=? GROUP BY day HAVING SUM(minutes)>=?)`
  ).bind(id, goal).first().then((r) => r.c),
  bestDay: (env, id) => env.DB.prepare(
    `SELECT day, SUM(minutes) m FROM logs WHERE user_id=? GROUP BY day ORDER BY m DESC LIMIT 1`
  ).bind(id).first(),

  board: (env, gid, f, t, lim) => env.DB.prepare(
    `SELECT u.id, u.first_name, u.username, SUM(l.minutes) m
     FROM memberships mem
     JOIN logs  l ON l.user_id=mem.user_id AND l.day BETWEEN ?2 AND ?3
     JOIN users u ON u.id=mem.user_id
     WHERE mem.group_id=?1 GROUP BY u.id ORDER BY m DESC LIMIT ?4`
  ).bind(gid, f, t, lim || 20).all().then((r) => r.results || []),
  groupSize: (env, gid) => env.DB.prepare('SELECT COUNT(*) c FROM memberships WHERE group_id=?').bind(gid).first().then((r) => r.c),
  league: (env, f, t) => env.DB.prepare(
    `SELECT g.id, g.title, SUM(l.minutes) m, COUNT(DISTINCT l.user_id) n
     FROM groups g
     JOIN memberships mem ON mem.group_id=g.id
     JOIN logs l ON l.user_id=mem.user_id AND l.day BETWEEN ?1 AND ?2
     WHERE g.active=1 GROUP BY g.id HAVING n>=3 ORDER BY (SUM(l.minutes)*1.0/COUNT(DISTINCT l.user_id)) DESC
     LIMIT 15`).bind(f, t).all().then((r) => r.results || []),

  badges: (env, id) => env.DB.prepare('SELECT code,at FROM badges WHERE user_id=?').bind(id).all().then((r) => r.results || []),
  async grant(env, id, code) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO badges VALUES (?,?,?)').bind(id, code, Date.now()).run();
    return (r.meta && r.meta.changes) > 0;
  },
  refCount: (env, id) => env.DB.prepare('SELECT COUNT(*) c FROM users WHERE ref_by=?').bind(id).first().then((r) => r.c),

  enqueue: (env, chat, text, kb) => env.DB.prepare(
    'INSERT INTO outbox (chat_id,text,kb,created_at) VALUES (?,?,?,?)'
  ).bind(chat, text, kb ? JSON.stringify(kb) : null, Date.now()).run(),
};

const level = (xp) => Math.floor(Math.sqrt(xp / 90)) + 1;
const levelSpan = (xp) => {
  const L = level(xp);
  const lo = Math.pow(L - 1, 2) * 90, hi = Math.pow(L, 2) * 90;
  return { level: L, lo, hi, pct: Math.round(((xp - lo) / (hi - lo)) * 100) };
};

/* ==================== نشان‌ها: بررسی بعد از هر ثبت ==================== */

async function checkBadges(env, uid, user) {
  const got = [];
  const today = dayKey();
  const [tot, todayMin, st, refs] = await Promise.all([
    DB.total(env, uid), DB.sum(env, uid, today, today), DB.streak(env, uid), DB.refCount(env, uid),
  ]);
  const gd = await DB.goalDays(env, uid, user ? user.goal : 300);
  const h = tParts().h, mi = tParts().mi;

  const rules = [
    ['first', tot > 0], ['h10', tot >= 600], ['h50', tot >= 3000],
    ['h100', tot >= 6000], ['h300', tot >= 18000],
    ['s3', st >= 3], ['s7', st >= 7], ['s30', st >= 30], ['s100', st >= 100],
    ['mara', todayMin >= 360], ['iron', todayMin >= 600],
    ['owl', h >= 0 && h < 4], ['lark', h < 6 || (h === 6 && mi <= 30)],
    ['goal10', gd >= 10], ['social', refs >= 1],
  ];
  for (const [code, cond] of rules) {
    if (cond && await DB.grant(env, uid, code)) got.push(code);
  }
  return got;
}

/* ==================== اعتبارسنجی initData مینی‌اپ ==================== */

async function verifyInitData(env, initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash'); p.delete('signature');
  const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => k + '=' + v).join('\n');
  const enc = new TextEncoder();
  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', k1, enc.encode(env.BOT_TOKEN));
  const k2 = await crypto.subtle.importKey('raw', secret,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k2, enc.encode(dcs));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== hash) return null;
  if (Date.now() - Number(p.get('auth_date') || 0) * 1000 > 86400000) return null;
  try { return JSON.parse(p.get('user') || 'null'); } catch { return null; }
}

/* ============================ API مینی‌اپ ============================ */

const json = (o, status) => new Response(JSON.stringify(o), {
  status: status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function timerElapsed(t) {
  if (!t) return null;
  const end = t.paused_at || Date.now();
  const ms = Math.min(end - t.started_at - t.paused_ms, CFG.TIMER_CAP_MIN * 60000);
  return { subject: t.subject, seconds: Math.max(0, Math.floor(ms / 1000)), paused: !!t.paused_at };
}

async function apiState(env, u) {
  const today = dayKey();
  const [wf, wt] = persianWeek(today);
  const [user, t, todayMin, weekMin, st, groups, days, brk, badges, live, logs, total, best] =
    await Promise.all([
      DB.user(env, u.id), DB.timer(env, u.id), DB.sum(env, u.id, today, today),
      DB.sum(env, u.id, wf, wt), DB.streak(env, u.id), DB.myGroups(env, u.id),
      DB.byDay(env, u.id, shiftDay(today, -6), today), DB.breakdown(env, u.id, wf, wt),
      DB.badges(env, u.id), DB.liveCount(env), DB.todayLogs(env, u.id),
      DB.total(env, u.id), DB.bestDay(env, u.id),
    ]);

  const week = [];
  for (let i = 6; i >= 0; i--) {
    const k = shiftDay(today, -i);
    const hit = days.find((d) => d.day === k);
    week.push({ day: k, label: DOW_FA[dowOf(k)].slice(0, 2), minutes: hit ? hit.m : 0, today: i === 0 });
  }
  return {
    ok: true, now: Date.now(),
    me: { id: u.id, name: user.first_name || u.first_name || '', goal: user.goal,
          xp: user.xp, ...levelSpan(user.xp) },
    dayLabel: jalali(today), timer: timerElapsed(t),
    today: todayMin, weekTotal: weekMin, total, streak: st,
    bestDay: best ? { label: jalali(best.day, false), minutes: best.m } : null,
    week, breakdown: brk, logs, groups, live,
    badges: badges.map((b) => b.code),
  };
}

async function handleApi(env, req) {
  const initData = req.headers.get('x-init-data') || '';
  const u = await verifyInitData(env, initData);
  if (!u) return json({ ok: false, error: 'auth' }, 401);

  let body = {};
  try { body = await req.json(); } catch {}
  const act = body.action;

  await DB.upsertUser(env, u);
  let user = await DB.user(env, u.id);

  switch (act) {
    case 'state':
      return json(await apiState(env, u));

    case 'start': {
      const code = subj(body.subject).c;
      await DB.start(env, u.id, code);
      return json(await apiState(env, u));
    }
    case 'pause': {
      const t = await DB.timer(env, u.id);
      if (t && !t.paused_at) await DB.pause(env, u.id);
      return json(await apiState(env, u));
    }
    case 'resume': {
      const t = await DB.timer(env, u.id);
      if (t && t.paused_at) await DB.resume(env, u.id, t);
      return json(await apiState(env, u));
    }
    case 'stop': {
      const t = await DB.timer(env, u.id);
      if (!t) return json(await apiState(env, u));
      const e = timerElapsed(t);
      const mins = Math.floor(e.seconds / 60);
      await DB.clear(env, u.id);
      let newBadges = [];
      if (mins >= 1) {
        await DB.addLog(env, u.id, t.subject, mins, 'timer');
        await DB.addXp(env, u.id, mins);
        newBadges = await checkBadges(env, u.id, user);
      }
      const s = await apiState(env, u);
      return json({ ...s, saved: mins, savedSubject: t.subject, newBadges });
    }
    case 'log': {
      const mins = Math.max(1, Math.min(CFG.MAX_LOG, Math.round(Number(body.minutes) || 0)));
      const code = subj(body.subject).c;
      if (!mins) return json({ ok: false, error: 'bad' }, 400);
      await DB.addLog(env, u.id, code, mins, 'manual');
      await DB.addXp(env, u.id, mins);
      const newBadges = await checkBadges(env, u.id, user);
      const s = await apiState(env, u);
      return json({ ...s, saved: mins, savedSubject: code, newBadges });
    }
    case 'undo': {
      await DB.delLog(env, Number(body.id), u.id);
      return json(await apiState(env, u));
    }
    case 'goal': {
      const g = Math.max(30, Math.min(900, Math.round(Number(body.minutes) || 300)));
      await DB.setGoal(env, u.id, g);
      return json(await apiState(env, u));
    }
    case 'board': {
      const gid = Number(body.group_id);
      const ok = (await DB.myGroups(env, u.id)).some((g) => g.id === gid);
      if (!ok) return json({ ok: false, error: 'forbidden' }, 403);
      const today = dayKey();
      const [f, t] = body.scope === 'week' ? persianWeek(today) : [today, today];
      const [rows, size] = await Promise.all([DB.board(env, gid, f, t, 30), DB.groupSize(env, gid)]);
      return json({ ok: true, rows, size, scope: body.scope || 'day',
                    label: body.scope === 'week' ? 'این هفته' : jalali(today) });
    }
    case 'league': {
      const [f, t] = persianWeek(dayKey());
      const rows = await DB.league(env, f, t);
      const mine = (await DB.myGroups(env, u.id)).map((g) => g.id);
      return json({ ok: true, rows: rows.map((r) => ({ ...r, avg: Math.round(r.m / r.n), mine: mine.includes(r.id) })) });
    }
    default:
      return json({ ok: false, error: 'unknown' }, 400);
  }
}

/* ============================ ربات ============================ */

const appLink = (env, param) =>
  'https://t.me/' + env.BOT_USERNAME + '/' + (env.APP_SHORT_NAME || 'app') +
  (param ? '?startapp=' + param : '');

function panelKb(env, user, hasTimer) {
  return [
    [{ text: '🚀 باز کردن استادیوم', web_app: { url: env.__ORIGIN + '/app' } }],
    hasTimer ? [{ text: '⏹ ثبت و پایان تایمر', callback_data: 'stop' }]
             : [{ text: '▶️ شروع سریع', callback_data: 'pick' }],
    [{ text: '📊 آمار من', callback_data: 'me' }, { text: '🏆 جدول گروه', callback_data: 'gsel' }],
    [{ text: '🎯 هدف روزانه', callback_data: 'goal' }, { text: '🪄 کارت من', callback_data: 'card' }],
    [{ text: '➕ افزودن به گروه مطالعه', url: 'https://t.me/' + env.BOT_USERNAME + '?startgroup=go' }],
  ];
}

async function homeText(env, user) {
  const today = dayKey();
  const [t, mins, st] = await Promise.all([
    DB.timer(env, user.id), DB.sum(env, user.id, today, today), DB.streak(env, user.id),
  ]);
  const pct = Math.min(100, Math.round((mins / user.goal) * 100));
  const L = levelSpan(user.xp);
  let s = '<b>' + jalali(today) + '</b>\n\n';
  if (t) {
    const e = timerElapsed(t), sj = subj(t.subject);
    s += (e.paused ? '⏸ ' : '▶️ ') + '<b>' + sj.e + ' ' + sj.n + '</b> — ' +
         dur(Math.floor(e.seconds / 60)) + (e.paused ? ' (متوقف)' : ' در جریان') + '\n\n';
  }
  s += '⏱ امروز: <b>' + dur(mins) + '</b>\n' +
       '🎯 هدف: ' + dur(user.goal) + '\n<code>' + bar(pct) + '</code> ' + fa(pct) + '٪\n' +
       '🔥 استریک: <b>' + fa(st) + ' روز</b>\n' +
       '⭐️ سطح ' + fa(L.level) + ' — ' + fa(user.xp) + ' XP';
  return { text: s, kb: panelKb(env, user, !!t) };
}

async function cardText(env, user) {
  const today = dayKey();
  const [mins, st, gs, L] = await Promise.all([
    DB.sum(env, user.id, today, today), DB.streak(env, user.id),
    DB.myGroups(env, user.id), Promise.resolve(levelSpan(user.xp)),
  ]);
  const pct = Math.min(100, Math.round((mins / user.goal) * 100));
  let s = '🎯 <b>کارت مطالعهٔ من</b>\n' + jalali(today) + '\n\n' +
          '⏱ امروز: <b>' + dur(mins) + '</b>\n' +
          '🔥 استریک: <b>' + fa(st) + ' روز</b>\n' +
          '⭐️ سطح: <b>' + fa(L.level) + '</b>\n';
  if (gs.length) {
    const rows = await DB.board(env, gs[0].id, today, today, 100);
    const i = rows.findIndex((r) => r.id === user.id);
    if (i >= 0) s += '🏆 رتبهٔ گروه: <b>' + fa(i + 1) + '</b> از ' + fa(rows.length) + '\n';
  }
  s += '\n<code>' + bar(pct, 12) + '</code> ' + fa(pct) + '٪ از هدف\n\n📚 @' + env.BOT_USERNAME;
  return s;
}

async function refreshPanel(env, uid) {
  const user = await DB.user(env, uid);
  if (!user || !user.panel_msg) return;
  const v = await homeText(env, user);
  const r = await editMsg(env, user.panel_chat, user.panel_msg, v.text, v.kb);
  if (!r.ok) await DB.setPanel(env, uid, null, null);
}

const isGroup = (c) => c && (c.type === 'group' || c.type === 'supergroup');

async function onMessage(env, msg) {
  const from = msg.from;
  if (!from || from.is_bot) return;
  const text = msg.text || '';

  if (isGroup(msg.chat)) {
    if (/^\/(start|panel|board|jadval)/i.test(text)) {
      await DB.upsertUser(env, from);
      await DB.upsertGroup(env, msg.chat, from.id);
      await DB.join(env, from.id, msg.chat.id);
      const today = dayKey();
      const rows = await DB.board(env, msg.chat.id, today, today, 10);
      let s = '🏆 <b>جدول ' + jalali(today) + '</b>\n\n';
      if (!rows.length) s += 'امروز هنوز کسی ثبت نکرده. اولین نفر باش 💪';
      rows.forEach((r, i) => {
        s += (['🥇','🥈','🥉'][i] || fa(i + 1) + '.') + ' ' +
             esc((r.first_name || 'کاربر').slice(0, 20)) + ' — <b>' + dur(r.m) + '</b>\n';
      });
      await send(env, msg.chat.id, s, [
        [{ text: '🚀 استادیوم من', url: appLink(env, 'g' + String(msg.chat.id).replace('-', 'n')) }],
        [{ text: '🏆 جدول هفته', callback_data: 'lb:w:' + msg.chat.id }],
      ]);
    }
    return;
  }

  // خصوصی
  let refBy = null;
  const m = text.match(/^\/start\s+r_(\d+)/);
  if (m && Number(m[1]) !== from.id) refBy = Number(m[1]);
  await DB.upsertUser(env, from, refBy);
  let user = await DB.user(env, from.id);
  if (refBy && user.ref_by === refBy) await checkBadges(env, refBy, await DB.user(env, refBy));

  if (text.startsWith('/start')) {
    await DB.setPending(env, from.id, null);
    const v = await homeText(env, user);
    const r = await send(env, msg.chat.id,
      'سلام ' + esc(from.first_name || '') + ' 👋\nبه <b>استادیوم مطالعه</b> خوش آمدی.\n\n' + v.text, v.kb);
    if (r.ok) await DB.setPanel(env, from.id, msg.chat.id, r.result.message_id);
    return;
  }

  // در انتظار عدد برای درس انتخاب‌شده
  if (user.pending && user.pending.startsWith('man:')) {
    const code = user.pending.split(':')[1];
    const p = parseStudy(text) || parseStudy(text + ' دقیقه');
    if (p) {
      await DB.setPending(env, from.id, null);
      await DB.addLog(env, from.id, code, p.minutes, 'manual');
      await DB.addXp(env, from.id, p.minutes);
      const got = await checkBadges(env, from.id, user);
      const log = await DB.lastLog(env, from.id);
      await send(env, msg.chat.id, '✅ ثبت شد: <b>' + subj(code).e + ' ' + subj(code).n +
        '</b> — ' + dur(p.minutes) + badgeLine(got),
        [[{ text: '↩️ لغو', callback_data: 'undo:' + log.id }]]);
      await refreshPanel(env, from.id);
      return;
    }
  }

  const p = parseStudy(text);
  if (p) {
    await DB.addLog(env, from.id, p.subject, p.minutes, 'manual');
    await DB.addXp(env, from.id, p.minutes);
    const got = await checkBadges(env, from.id, user);
    const log = await DB.lastLog(env, from.id);
    await send(env, msg.chat.id, '✅ ثبت شد: <b>' + subj(p.subject).e + ' ' +
      subj(p.subject).n + '</b> — ' + dur(p.minutes) + badgeLine(got),
      [[{ text: '↩️ لغو', callback_data: 'undo:' + log.id }]]);
    await refreshPanel(env, from.id);
    return;
  }

  await send(env, msg.chat.id,
    'همه‌چیز داخل استادیوم است 👇\nیا کافی است بنویسی <b>۲ ساعت ریاضی</b>.',
    [[{ text: '🚀 باز کردن استادیوم', web_app: { url: env.__ORIGIN + '/app' } }]]);
}

const badgeLine = (codes) => {
  if (!codes || !codes.length) return '';
  const list = codes.map((c) => {
    const a = ACHIEVEMENTS.find((x) => x.c === c);
    return a ? a.e + ' ' + a.n : c;
  }).join(' • ');
  return '\n\n🎉 نشان جدید: <b>' + list + '</b>';
};

async function onCallback(env, cq) {
  const data = cq.data || '';
  const from = cq.from;
  const chatId = cq.message && cq.message.chat.id;
  const msgId = cq.message && cq.message.message_id;
  const inG = isGroup(cq.message && cq.message.chat);
  const [head, a1, a2] = data.split(':');

  await DB.upsertUser(env, from);
  if (inG) { await DB.upsertGroup(env, cq.message.chat, null); await DB.join(env, from.id, chatId); }
  let user = await DB.user(env, from.id);

  const show = async (text, kb) => {
    const r = await editMsg(env, chatId, msgId, text, kb);
    if (!r.ok) await send(env, chatId, text, kb);
  };

  if (inG && ['pick','st','man','card','goal','me'].includes(head)) {
    return toast(env, cq.id, 'این بخش در استادیوم شخصی‌ات است. از دکمهٔ «استادیوم من» وارد شو.', true);
  }

  switch (head) {
    case 'home': {
      const v = await homeText(env, user);
      await show(v.text, v.kb);
      return toast(env, cq.id);
    }
    case 'pick': {
      const rows = [];
      for (let i = 0; i < SUBJECTS.length; i += 3)
        rows.push(SUBJECTS.slice(i, i + 3).map((s) => ({ text: s.e + ' ' + s.n, callback_data: 'st:' + s.c })));
      rows.push([{ text: '« برگشت', callback_data: 'home' }]);
      await show('<b>چه درسی؟</b>\nتایمر بلافاصله شروع می‌شود.', rows);
      return toast(env, cq.id);
    }
    case 'st': {
      await DB.start(env, from.id, subj(a1).c);
      const v = await homeText(env, user);
      await show(v.text, v.kb);
      return toast(env, cq.id, '▶️ ' + subj(a1).n + ' شروع شد');
    }
    case 'stop': {
      const t = await DB.timer(env, from.id);
      if (!t) return toast(env, cq.id, 'تایمری در جریان نیست.', true);
      const mins = Math.floor(timerElapsed(t).seconds / 60);
      await DB.clear(env, from.id);
      let got = [];
      if (mins >= 1) {
        await DB.addLog(env, from.id, t.subject, mins, 'timer');
        await DB.addXp(env, from.id, mins);
        got = await checkBadges(env, from.id, user);
      }
      const v = await homeText(env, await DB.user(env, from.id));
      await show(v.text, v.kb);
      if (got.length) await send(env, from.id, badgeLine(got).trim());
      return toast(env, cq.id, mins < 1 ? 'کمتر از یک دقیقه بود، ثبت نشد.' : '✅ ' + dur(mins) + ' ثبت شد', true);
    }
    case 'me': {
      const today = dayKey();
      const [f, t] = persianWeek(today);
      const [mins, rows, st] = await Promise.all([
        DB.sum(env, from.id, f, t), DB.breakdown(env, from.id, f, t), DB.streak(env, from.id),
      ]);
      const max = rows.length ? rows[0].m : 1;
      let s = '📊 <b>این هفته (شنبه تا امروز)</b>\n\n⏱ مجموع: <b>' + dur(mins) +
              '</b>\n🔥 استریک: ' + fa(st) + ' روز\n';
      if (!rows.length) s += '\nهنوز چیزی ثبت نکردی.';
      else { s += '\n'; for (const r of rows) {
        const sj = subj(r.subject);
        s += sj.e + ' ' + sj.n + ' — ' + dur(r.m) + '\n<code>' + bar((r.m / max) * 100, 12) + '</code>\n';
      } }
      await show(s, [[{ text: '🚀 نمودار کامل در استادیوم', web_app: { url: env.__ORIGIN + '/app' } }],
                     [{ text: '« برگشت', callback_data: 'home' }]]);
      return toast(env, cq.id);
    }
    case 'gsel': {
      const gs = await DB.myGroups(env, from.id);
      if (!gs.length) {
        await show('هنوز در هیچ گروهی با من نیستی.\nربات را به گروه مطالعه‌تان اضافه کن تا رقابت شکل بگیرد.',
          [[{ text: '➕ افزودن به گروه', url: 'https://t.me/' + env.BOT_USERNAME + '?startgroup=go' }],
           [{ text: '« برگشت', callback_data: 'home' }]]);
        return toast(env, cq.id);
      }
      await show('<b>کدام گروه؟</b>', [
        ...gs.map((g) => [{ text: '👥 ' + (g.title || g.id), callback_data: 'lb:d:' + g.id }]),
        [{ text: '« برگشت', callback_data: 'home' }]]);
      return toast(env, cq.id);
    }
    case 'lb': {
      const gid = Number(a2);
      const today = dayKey();
      const [f, t] = a1 === 'w' ? persianWeek(today) : [today, today];
      const rows = await DB.board(env, gid, f, t, 10);
      let s = '🏆 <b>جدول ' + (a1 === 'w' ? 'این هفته' : jalali(today)) + '</b>\n\n';
      if (!rows.length) s += 'کسی ثبت نکرده. اولین نفر باش 💪';
      rows.forEach((r, i) => {
        s += (['🥇','🥈','🥉'][i] || fa(i + 1) + '.') + ' ' +
             esc((r.first_name || 'کاربر').slice(0, 20)) + ' — <b>' + dur(r.m) + '</b>' +
             (r.id === from.id ? ' ←' : '') + '\n';
      });
      const kb = [[
        { text: (a1 === 'd' ? '● ' : '') + 'امروز', callback_data: 'lb:d:' + gid },
        { text: (a1 === 'w' ? '● ' : '') + 'هفته',  callback_data: 'lb:w:' + gid }]];
      kb.push(inG ? [{ text: '🚀 استادیوم من', url: appLink(env, 'g' + String(gid).replace('-', 'n')) }]
                  : [{ text: '« برگشت', callback_data: 'home' }]);
      await show(s, kb);
      return toast(env, cq.id);
    }
    case 'goal': {
      if (a1) {
        await DB.setGoal(env, from.id, Number(a1));
        user = await DB.user(env, from.id);
        const v = await homeText(env, user);
        await show(v.text, v.kb);
        return toast(env, cq.id, '🎯 هدف شد ' + dur(Number(a1)));
      }
      const opts = [120, 180, 240, 300, 360, 420, 480, 600];
      const rows = [];
      for (let i = 0; i < opts.length; i += 4)
        rows.push(opts.slice(i, i + 4).map((g) => ({
          text: (user.goal === g ? '● ' : '') + fa(g / 60) + ' ساعت', callback_data: 'goal:' + g })));
      rows.push([{ text: '« برگشت', callback_data: 'home' }]);
      await show('🎯 <b>هدف روزانه</b>\nفعلاً: ' + dur(user.goal), rows);
      return toast(env, cq.id);
    }
    case 'card': {
      const s = await cardText(env, user);
      await show(s, [
        [{ text: '📤 فرستادن به چت', switch_inline_query: 'کارت من' }],
        [{ text: '🔗 لینک دعوت من', callback_data: 'ref' }],
        [{ text: '« برگشت', callback_data: 'home' }]]);
      return toast(env, cq.id);
    }
    case 'ref': {
      const link = 'https://t.me/' + env.BOT_USERNAME + '?start=r_' + from.id;
      const n = await DB.refCount(env, from.id);
      await show('🔗 <b>لینک دعوت تو</b>\n<code>' + link + '</code>\n\n' +
        'تا حالا <b>' + fa(n) + '</b> نفر با لینک تو آمده‌اند.\n' +
        'هر نفر که بیاید، نشان 🤝 می‌گیری.',
        [[{ text: '📤 فرستادن لینک', switch_inline_query: 'بیا با هم بخونیم' }],
         [{ text: '« برگشت', callback_data: 'card' }]]);
      return toast(env, cq.id);
    }
    case 'undo': {
      await DB.delLog(env, Number(a1), from.id);
      await editMsg(env, chatId, msgId, '↩️ لغو شد.');
      await refreshPanel(env, from.id);
      return toast(env, cq.id, 'لغو شد');
    }
    default:
      return toast(env, cq.id);
  }
}

async function onInline(env, q) {
  const user = await DB.user(env, q.from.id);
  if (!user) {
    return tg(env, 'answerInlineQuery', {
      inline_query_id: q.id, cache_time: 5, is_personal: true, results: [],
      button: { text: '📚 اول ربات را استارت کن', start_parameter: 'inline' },
    });
  }
  const card = await cardText(env, user);
  const invite = '📚 <b>بیا با هم بخونیم</b>\n\nمن ساعت مطالعه‌ام را با استادیوم ثبت می‌کنم؛ ' +
    'جدول رقابت گروه، استریک روزهای پیوسته و نشان‌ها دارد.\n\n' +
    'با لینک من بیا: https://t.me/' + env.BOT_USERNAME + '?start=r_' + q.from.id;
  return tg(env, 'answerInlineQuery', {
    inline_query_id: q.id, cache_time: 20, is_personal: true,
    results: [
      { type: 'article', id: 'card', title: '🎯 کارت مطالعهٔ امروزم',
        description: 'ساعت امروز، استریک و رتبهٔ گروه',
        input_message_content: { message_text: card, parse_mode: 'HTML' },
        reply_markup: { inline_keyboard: [[{ text: '📚 من هم می‌خوام',
          url: 'https://t.me/' + env.BOT_USERNAME + '?start=r_' + q.from.id }]] } },
      { type: 'article', id: 'inv', title: '🤝 دعوت هم‌مطالعه',
        description: 'لینک دعوت شخصی تو',
        input_message_content: { message_text: invite, parse_mode: 'HTML' },
        reply_markup: { inline_keyboard: [[{ text: '🚀 شروع', 
          url: 'https://t.me/' + env.BOT_USERNAME + '?start=r_' + q.from.id }]] } },
    ],
  });
}

async function onMembership(env, ev) {
  if (!isGroup(ev.chat)) return;
  const st = ev.new_chat_member && ev.new_chat_member.status;
  if (st === 'member' || st === 'administrator') {
    await DB.upsertGroup(env, ev.chat, ev.from && ev.from.id);
    await send(env, ev.chat.id,
      '📚 <b>استادیوم مطالعهٔ این گروه فعال شد</b>\n\n' +
      '• هر شب ساعت ۱۲ جدول امروز اینجا می‌آید\n' +
      '• جمعه‌شب‌ها قهرمان هفته اعلام می‌شود\n' +
      '• هر کس ساعت مطالعه‌اش را در استادیوم شخصی ثبت می‌کند\n\n' +
      '<i>من پیام‌های گروه را نمی‌خوانم و ذخیره نمی‌کنم.</i>',
      [[{ text: '🚀 استادیوم من', url: appLink(env, 'g' + String(ev.chat.id).replace('-', 'n')) }],
       [{ text: '🏆 جدول امروز', callback_data: 'lb:d:' + ev.chat.id }]]);
  } else if (st === 'left' || st === 'kicked') {
    await DB.offGroup(env, ev.chat.id);
  }
}

async function handleUpdate(env, u) {
  if (u.message)        return onMessage(env, u.message);
  if (u.callback_query) return onCallback(env, u.callback_query);
  if (u.inline_query)   return onInline(env, u.inline_query);
  if (u.my_chat_member) return onMembership(env, u.my_chat_member);
}

/* ============================ کارهای زمان‌بندی‌شده ============================ */

async function enqueueDailyReports(env) {
  const y = shiftDay(dayKey(), -1);
  const friday = isFriday(y);
  const [wf, wt] = persianWeek(y);
  const groups = await DB.activeGroups(env);

  for (const g of groups) {
    const rows = await DB.board(env, g.id, y, y, 10);
    if (rows.length) {
      const sum = rows.reduce((a, r) => a + r.m, 0);
      let s = '🏆 <b>جدول ' + jalali(y) + '</b>\n\n';
      rows.forEach((r, i) => {
        s += (['🥇','🥈','🥉'][i] || fa(i + 1) + '.') + ' ' +
             esc((r.first_name || 'کاربر').slice(0, 20)) + ' — <b>' + dur(r.m) + '</b>\n';
      });
      s += '\n👥 مجموع گروه: <b>' + dur(sum) + '</b> با ' + fa(rows.length) + ' نفر فعال';
      await DB.enqueue(env, g.id, s, [
        [{ text: '🚀 ثبت مطالعهٔ من', url: appLink(env, 'g' + String(g.id).replace('-', 'n')) }],
        [{ text: '🏆 جدول هفته', callback_data: 'lb:w:' + g.id }]]);
      await DB.grant(env, rows[0].id, 'gold');
    }
    if (friday) {
      const wrows = await DB.board(env, g.id, wf, wt, 10);
      if (wrows.length) {
        let s = '👑 <b>قهرمانان هفته</b>\n<i>' + jalali(wf, false) + ' تا ' + jalali(wt, false) + '</i>\n\n';
        wrows.forEach((r, i) => {
          s += (['🥇','🥈','🥉'][i] || fa(i + 1) + '.') + ' ' +
               esc((r.first_name || 'کاربر').slice(0, 20)) + ' — <b>' + dur(r.m) + '</b>\n';
        });
        s += '\nهفتهٔ جدید از شنبه صفر می‌شود. آماده باشید 🔥';
        await DB.enqueue(env, g.id, s, [
          [{ text: '🚀 استادیوم من', url: appLink(env, 'g' + String(g.id).replace('-', 'n')) }]]);
        await DB.grant(env, wrows[0].id, 'week');
      }
    }
  }
}

/** یادآوری فقط برای کسانی که استریک در خطر دارند */
async function enqueueStreakSaver(env) {
  const today = dayKey();
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.first_name FROM users u
     WHERE u.last_seen > ?1
       AND NOT EXISTS (SELECT 1 FROM logs l WHERE l.user_id=u.id AND l.day=?2)
       AND EXISTS (SELECT 1 FROM logs l2 WHERE l2.user_id=u.id AND l2.day=?3)
     LIMIT 200`
  ).bind(Date.now() - 14 * 86400000, today, shiftDay(today, -1)).all();

  for (const u of results || []) {
    const st = await DB.streak(env, u.id);
    if (st < 2) continue;
    await DB.enqueue(env, u.id,
      '🔥 <b>استریک ' + fa(st) + ' روزه‌ات در خطر است</b>\n\n' +
      'امروز هنوز چیزی ثبت نکرده‌ای. نیم ساعت هم کافی است که زنجیره نشکند.',
      [[{ text: '▶️ شروع تایمر', callback_data: 'pick' }]]);
  }
}

async function drainOutbox(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM outbox ORDER BY id LIMIT ?').bind(CFG.OUTBOX_BATCH).all();
  for (const row of results || []) {
    const kb = row.kb ? JSON.parse(row.kb) : null;
    const r = await send(env, row.chat_id, row.text, kb);
    if (r.ok || row.tries >= 2) {
      await env.DB.prepare('DELETE FROM outbox WHERE id=?').bind(row.id).run();
      if (!r.ok && /bot was (kicked|blocked)|chat not found|not enough rights/i.test(r.description || ''))
        await DB.offGroup(env, row.chat_id);
    } else {
      await env.DB.prepare('UPDATE outbox SET tries=tries+1 WHERE id=?').bind(row.id).run();
    }
  }
}

/* ============================ نقطهٔ ورود ============================ */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    env.__ORIGIN = url.origin;
    await ensureSchema(env);

    // وب‌هوک تلگرام
    if (url.pathname === '/tg' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET)
        return new Response('forbidden', { status: 403 });
      const update = await req.json().catch(() => null);
      if (update) ctx.waitUntil(handleUpdate(env, update).catch((e) => console.error('update', e)));
      return new Response('ok');
    }

    // API مینی‌اپ
    if (url.pathname === '/api' && req.method === 'POST') return handleApi(env, req);

    // مینی‌اپ
    if (url.pathname === '/app' || url.pathname === '/') {
      return new Response(APP_HTML(env), {
        headers: { 'content-type': 'text/html; charset=utf-8',
                   'cache-control': 'public, max-age=300' },
      });
    }

    // نصب خودکار: وب‌هوک + دکمهٔ منو + دستورات
    if (url.pathname === '/setup') {
      if (url.searchParams.get('key') !== env.WEBHOOK_SECRET)
        return new Response('forbidden', { status: 403 });
      const out = {};
      out.webhook = await tg(env, 'setWebhook', {
        url: url.origin + '/tg', secret_token: env.WEBHOOK_SECRET,
        drop_pending_updates: true, max_connections: 100,
        allowed_updates: ['message', 'callback_query', 'inline_query', 'my_chat_member'],
      });
      out.menu = await tg(env, 'setChatMenuButton', {
        menu_button: { type: 'web_app', text: '📚 استادیوم', web_app: { url: url.origin + '/app' } },
      });
      out.commands = await tg(env, 'setMyCommands', {
        commands: [{ command: 'start', description: '🚀 باز کردن استادیوم' }],
      });
      out.groupCommands = await tg(env, 'setMyCommands', {
        commands: [{ command: 'board', description: '🏆 جدول امتیاز گروه' }],
        scope: { type: 'all_group_chats' },
      });
      out.desc = await tg(env, 'setMyShortDescription', {
        short_description: 'ثبت ساعت مطالعه، جدول رقابت گروه، استریک و نشان — مخصوص کنکوری‌ها',
      });
      return json({ ok: true, origin: url.origin, ...out });
    }

    return new Response('Study Arena is running.', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    const p = new Date(event.scheduledTime);
    const h = p.getUTCHours(), m = p.getUTCMinutes();
    if (h === 20 && m === 30) await enqueueDailyReports(env);   // 00:00 تهران
    if (h === 14 && m === 30) await enqueueStreakSaver(env);    // 18:00 تهران
    await drainOutbox(env);
  },
};

/* ============================ مینی‌اپ ============================ */

function APP_HTML(env) {
  const SUB = JSON.stringify(SUBJECTS);
  const ACH = JSON.stringify(ACHIEVEMENTS);
  const BOT = env.BOT_USERNAME || '';
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>استادیوم مطالعه</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{
  --bg:#0b1020; --bg2:#121a33; --card:rgba(255,255,255,.055); --card2:rgba(255,255,255,.09);
  --line:rgba(255,255,255,.10); --tx:#eef2ff; --tx2:#9aa8c7;
  --ac:#6ea8fe; --ac2:#a78bfa; --ok:#34d399; --warn:#fbbf24; --danger:#fb7185;
  --r:20px; --sp:14px; --safe:env(safe-area-inset-bottom,0px);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%}
body{
  background:
    radial-gradient(900px 500px at 90% -10%,rgba(110,168,254,.20),transparent 60%),
    radial-gradient(700px 420px at 5% 0%,rgba(167,139,250,.18),transparent 60%),
    linear-gradient(180deg,var(--bg),var(--bg2));
  color:var(--tx); font-family:'Vazirmatn','IRANSansX','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  overscroll-behavior:none; -webkit-user-select:none; user-select:none;
}
#app{max-width:520px;margin:0 auto;padding:12px 14px calc(96px + var(--safe))}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:16px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.row{display:flex;align-items:center;gap:10px}
.between{justify-content:space-between}
.muted{color:var(--tx2);font-size:12.5px}
.h1{font-size:17px;font-weight:800;letter-spacing:-.2px}
.big{font-variant-numeric:tabular-nums;font-weight:900}
.pill{background:var(--card2);border:1px solid var(--line);border-radius:999px;
  padding:6px 11px;font-size:12px;font-weight:700}
.btn{border:0;border-radius:16px;padding:14px 16px;font:inherit;font-weight:800;font-size:15px;
  color:#08122b;background:linear-gradient(135deg,var(--ac),var(--ac2));
  box-shadow:0 10px 26px rgba(110,168,254,.28);transition:transform .12s cubic-bezier(.2,.9,.25,1.2),filter .15s}
.btn:active{transform:scale(.965)}
.btn.ghost{background:var(--card2);color:var(--tx);border:1px solid var(--line);box-shadow:none}
.btn.warn{background:linear-gradient(135deg,#fbbf24,#fb923c);color:#2a1a02}
.btn.stop{background:linear-gradient(135deg,#fb7185,#f43f5e);color:#fff;box-shadow:0 10px 26px rgba(244,63,94,.25)}
.btn.block{width:100%}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.fade{animation:fade .32s cubic-bezier(.2,.7,.2,1) both}
@keyframes fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.stagger>*{animation:fade .34s cubic-bezier(.2,.7,.2,1) both}
.stagger>*:nth-child(1){animation-delay:.02s}.stagger>*:nth-child(2){animation-delay:.06s}
.stagger>*:nth-child(3){animation-delay:.1s}.stagger>*:nth-child(4){animation-delay:.14s}
.stagger>*:nth-child(5){animation-delay:.18s}.stagger>*:nth-child(6){animation-delay:.22s}

/* حلقهٔ تایمر */
.ring{position:relative;width:216px;height:216px;margin:6px auto 2px}
.ring svg{transform:rotate(-90deg)}
.ring .tr{stroke:rgba(255,255,255,.09)}
.ring .pg{stroke:url(#g1);stroke-linecap:round;transition:stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)}
.ring .mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.clock{font-size:38px;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-1px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:pulse 1.9s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.55)}70%{box-shadow:0 0 0 12px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}

/* نمودار هفته */
.chart{display:flex;align-items:flex-end;gap:8px;height:118px;margin-top:8px}
.col{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%}
.colbar{width:100%;border-radius:10px 10px 6px 6px;background:linear-gradient(180deg,var(--ac),rgba(110,168,254,.28));
  min-height:6px;margin-top:auto;animation:grow .55s cubic-bezier(.2,.9,.2,1) both}
.colbar.now{background:linear-gradient(180deg,var(--ac2),rgba(167,139,250,.3));box-shadow:0 0 0 1px rgba(167,139,250,.5)}
@keyframes grow{from{transform:scaleY(.02);opacity:.3}to{transform:none;opacity:1}}

/* لیست‌ها */
.item{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:14px;background:var(--card);
  border:1px solid var(--line);margin-bottom:8px}
.item.me{border-color:rgba(110,168,254,.55);background:rgba(110,168,254,.10)}
.rank{width:30px;text-align:center;font-weight:900;font-size:14px;color:var(--tx2)}
.av{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;font-weight:900;font-size:14px;
  background:linear-gradient(135deg,rgba(110,168,254,.3),rgba(167,139,250,.3))}
.meter{height:6px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:6px}
.meter i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--ac),var(--ac2));
  animation:slide .6s cubic-bezier(.2,.9,.2,1) both}
@keyframes slide{from{width:0!important}}

/* شبکهٔ درس‌ها */
.subs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.sub{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:13px 8px;text-align:center;
  transition:transform .12s,background .15s}
.sub:active{transform:scale(.93);background:var(--card2)}
.sub .e{font-size:24px;display:block;margin-bottom:5px}
.sub .n{font-size:12px;font-weight:700}

/* نشان‌ها */
.badges{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.bd{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 6px;text-align:center}
.bd .e{font-size:26px;display:block}
.bd .n{font-size:10.5px;font-weight:700;margin-top:5px;color:var(--tx2)}
.bd.on{background:linear-gradient(135deg,rgba(110,168,254,.16),rgba(167,139,250,.16));border-color:rgba(110,168,254,.45)}
.bd.on .n{color:var(--tx)}
.bd.off{filter:grayscale(1);opacity:.42}

/* نوار پایین */
.tabbar{position:fixed;inset:auto 0 0 0;z-index:40;padding:8px 12px calc(8px + var(--safe));
  background:linear-gradient(180deg,rgba(11,16,32,0),rgba(11,16,32,.92) 34%);backdrop-filter:blur(16px)}
.tabs{max-width:520px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;
  background:var(--card);border:1px solid var(--line);border-radius:20px;padding:6px}
.tab{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;border-radius:15px;
  color:var(--tx2);font-size:10.5px;font-weight:700;transition:color .18s,background .18s}
.tab.on{color:var(--tx);background:var(--card2)}
.tab svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}

/* شیت */
.sheet{position:fixed;inset:0;z-index:60;display:none}
.sheet.open{display:block}
.sheet .bg{position:absolute;inset:0;background:rgba(3,6,16,.6);backdrop-filter:blur(3px);animation:fade .2s both}
.sheet .body{position:absolute;left:0;right:0;bottom:0;max-width:520px;margin:0 auto;
  background:linear-gradient(180deg,#151d38,#101733);border:1px solid var(--line);
  border-radius:26px 26px 0 0;padding:16px 16px calc(20px + var(--safe));
  animation:up .34s cubic-bezier(.2,.9,.2,1) both;max-height:86vh;overflow:auto}
@keyframes up{from{transform:translateY(102%)}to{transform:none}}
.handle{width:42px;height:4px;border-radius:99px;background:rgba(255,255,255,.22);margin:0 auto 12px}

/* توست */
#toast{position:fixed;left:50%;bottom:calc(104px + var(--safe));transform:translateX(-50%) translateY(18px);
  z-index:90;background:rgba(8,13,28,.95);border:1px solid var(--line);border-radius:16px;
  padding:11px 16px;font-size:13.5px;font-weight:700;opacity:0;transition:.28s cubic-bezier(.2,.9,.2,1);pointer-events:none;
  max-width:88%;text-align:center}
#toast.on{opacity:1;transform:translateX(-50%) translateY(0)}

/* اسکلتون */
.sk{background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.12),rgba(255,255,255,.05));
  background-size:200% 100%;animation:sh 1.15s infinite;border-radius:14px}
@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* کارت اشتراک */
.share{border-radius:24px;padding:20px;background:linear-gradient(140deg,#1b2547,#101733 55%,#1a1440);
  border:1px solid rgba(255,255,255,.14);overflow:hidden;position:relative}
.share:after{content:'';position:absolute;width:230px;height:230px;border-radius:50%;
  background:radial-gradient(circle,rgba(110,168,254,.30),transparent 70%);top:-90px;left:-60px}
.confetti{position:fixed;inset:0;pointer-events:none;z-index:80}
.cf{position:absolute;width:8px;height:12px;border-radius:2px;animation:fall 1.5s cubic-bezier(.2,.7,.3,1) forwards}
@keyframes fall{0%{transform:translateY(-8vh) rotate(0);opacity:1}100%{transform:translateY(102vh) rotate(620deg);opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div id="app">
  <div id="view"></div>
</div>

<div class="tabbar"><div class="tabs" id="tabs"></div></div>
<div class="sheet" id="sheet"><div class="bg" onclick="closeSheet()"></div>
  <div class="body"><div class="handle"></div><div id="sheetBody"></div></div></div>
<div id="toast"></div>

<script>
var SUBJECTS = ${SUB}, ACH = ${ACH}, BOT = '${BOT}';
var tg = window.Telegram && window.Telegram.WebApp;
var S = null, TAB = 'home', tick = null, offset = 0, boardCache = {}, curGroup = null, boardScope = 'day';

/* ---------- کمکی ---------- */
function faN(n){ var d='۰۱۲۳۴۵۶۷۸۹'; return String(n).replace(/[0-9]/g,function(c){return d[+c]}); }
function two(n){ return (n<10?'0':'')+n; }
function hhmmss(sec){ var h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;
  return faN(two(h)+':'+two(m)+':'+two(s)); }
function durFa(min){ min=Math.max(0,Math.round(min)); var h=Math.floor(min/60),m=min%60;
  if(!h) return faN(m)+' دقیقه'; if(!m) return faN(h)+' ساعت'; return faN(h)+':'+faN(two(m))+' ساعت'; }
function sub(c){ for(var i=0;i<SUBJECTS.length;i++) if(SUBJECTS[i].c===c) return SUBJECTS[i];
  return SUBJECTS[SUBJECTS.length-1]; }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function haptic(t){ try{ tg.HapticFeedback.impactOccurred(t||'light'); }catch(e){} }
function notify(t){ try{ tg.HapticFeedback.notificationOccurred(t); }catch(e){} }
function toast(msg){ var el=document.getElementById('toast'); el.textContent=msg; el.classList.add('on');
  clearTimeout(el._t); el._t=setTimeout(function(){ el.classList.remove('on'); },2100); }
function initials(n){ n=(n||'؟').trim(); return n.slice(0,1); }

function api(action, data){
  var body = Object.assign({action:action}, data||{});
  return fetch('/api',{method:'POST',headers:{'content-type':'application/json',
    'x-init-data': (tg && tg.initData) || ''}, body:JSON.stringify(body)})
    .then(function(r){ return r.json(); })
    .then(function(j){ if(j && j.ok===false && j.error==='auth') throw new Error('auth'); return j; });
}

/* ---------- اسکلتون اولیه ---------- */
function skeleton(){
  return '<div class="card" style="margin-bottom:12px"><div class="sk" style="height:26px;width:56%"></div>'+
    '<div class="sk" style="height:200px;margin-top:14px"></div></div>'+
    '<div class="sk" style="height:96px;margin-bottom:10px"></div>'+
    '<div class="sk" style="height:96px"></div>';
}

/* ---------- تب‌ها ---------- */
var ICONS = {
  home:'<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/></svg>',
  stats:'<svg viewBox="0 0 24 24"><path d="M4 20V9"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></svg>',
  board:'<svg viewBox="0 0 24 24"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  badge:'<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="5"/><path d="M8.5 13.5 7 22l5-2.5L17 22l-1.5-8.5"/></svg>'
};
function renderTabs(){
  var t=[['home','خانه'],['stats','آمار'],['board','جدول'],['badge','نشان‌ها']];
  document.getElementById('tabs').innerHTML = t.map(function(x){
    return '<div class="tab'+(TAB===x[0]?' on':'')+'" onclick="go(\\''+x[0]+'\\')">'+ICONS[x[0]]+
      '<span>'+x[1]+'</span></div>';
  }).join('');
}
function go(t){ if(TAB===t) return; TAB=t; haptic('light'); renderTabs(); render(); window.scrollTo({top:0}); }

/* ---------- رندر ---------- */
function render(){
  var v=document.getElementById('view');
  if(!S){ v.innerHTML=skeleton(); return; }
  if(TAB==='home')  v.innerHTML=viewHome();
  if(TAB==='stats') v.innerHTML=viewStats();
  if(TAB==='board') { v.innerHTML=viewBoardShell(); loadBoard(); }
  if(TAB==='badge') v.innerHTML=viewBadges();
  startTick();
}

function ring(pct, inner){
  var R=96, C=2*Math.PI*R, off=C*(1-Math.max(0,Math.min(1,pct/100)));
  return '<div class="ring"><svg width="216" height="216" viewBox="0 0 216 216">'+
    '<defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">'+
    '<stop offset="0" stop-color="#6ea8fe"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>'+
    '<circle class="tr" cx="108" cy="108" r="'+R+'" fill="none" stroke-width="13"/>'+
    '<circle class="pg" cx="108" cy="108" r="'+R+'" fill="none" stroke-width="13" '+
    'stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/></svg>'+
    '<div class="mid">'+inner+'</div></div>';
}

function viewHome(){
  var t=S.timer, pct=Math.min(100, Math.round(S.today/S.me.goal*100));
  var inner, actions;
  if(t){
    var sj=sub(t.subject);
    inner = '<div class="row" style="gap:6px">'+(t.paused?'⏸':'<span class="dot"></span>')+
      '<span class="muted" style="font-weight:800">'+sj.e+' '+sj.n+'</span></div>'+
      '<div class="clock" id="clock">'+hhmmss(t.seconds)+'</div>'+
      '<div class="muted">'+(t.paused?'متوقف':'در حال مطالعه')+'</div>';
    actions = t.paused
      ? '<div class="grid2"><button class="btn" onclick="act(\\'resume\\')">▶️ ادامه</button>'+
        '<button class="btn stop" onclick="act(\\'stop\\')">⏹ ثبت و پایان</button></div>'
      : '<div class="grid2"><button class="btn ghost" onclick="act(\\'pause\\')">⏸ توقف</button>'+
        '<button class="btn stop" onclick="act(\\'stop\\')">⏹ ثبت و پایان</button></div>';
  } else {
    inner = '<div class="muted">امروز</div><div class="clock">'+durFa(S.today).replace(' ساعت','').replace(' دقیقه','')+
      '</div><div class="muted">'+(S.today>=60?'ساعت':'دقیقه')+' • هدف '+durFa(S.me.goal)+'</div>';
    actions = '<button class="btn block" onclick="pickSubject(\\'start\\')">▶️ شروع مطالعه</button>';
  }

  var L=S.me;
  var head = '<div class="row between" style="margin-bottom:12px">'+
    '<div><div class="h1">'+esc(S.me.name||'سلام')+' 👋</div>'+
    '<div class="muted">'+S.dayLabel+'</div></div>'+
    '<div class="row" style="gap:6px"><span class="pill">🔥 '+faN(S.streak)+'</span>'+
    '<span class="pill">⭐️ سطح '+faN(L.level)+'</span></div></div>';

  var xp = '<div class="card" style="margin-top:12px"><div class="row between">'+
    '<div class="muted">سطح '+faN(L.level)+' → '+faN(L.level+1)+'</div>'+
    '<div class="muted">'+faN(L.xp)+' XP</div></div>'+
    '<div class="meter"><i style="width:'+L.pct+'%"></i></div></div>';

  var live = S.live>0 ? '<div class="card" style="margin-top:12px"><div class="row">'+
    '<span class="dot"></span><div><b>'+faN(S.live)+' نفر</b> همین حالا دارند مطالعه می‌کنند'+
    '<div class="muted">تنها نیستی 💪</div></div></div></div>' : '';

  var quick = '<div class="grid3" style="margin-top:12px">'+
    '<button class="btn ghost" onclick="pickSubject(\\'log\\')">✍️ ثبت دستی</button>'+
    '<button class="btn ghost" onclick="goalSheet()">🎯 هدف</button>'+
    '<button class="btn ghost" onclick="shareSheet()">🪄 کارت</button></div>';

  var logs='';
  if(S.logs.length){
    logs = '<div class="card" style="margin-top:12px"><div class="h1" style="margin-bottom:10px">📋 امروز</div>'+
      S.logs.map(function(l){ var sj=sub(l.subject);
        return '<div class="item"><div class="av">'+sj.e+'</div><div style="flex:1">'+
          '<b>'+sj.n+'</b><div class="muted">'+durFa(l.minutes)+'</div></div>'+
          '<button class="btn ghost" style="padding:8px 11px;font-size:12px" onclick="undo('+l.id+')">↩️</button></div>';
      }).join('')+'</div>';
  }

  return head+'<div class="card fade">'+ring(t?Math.min(100,(t.seconds/60)/S.me.goal*100):pct, inner)+
    '<div style="margin-top:10px">'+actions+'</div>'+
    '<div class="row between" style="margin-top:14px"><span class="muted">امروز</span>'+
    '<b class="big">'+durFa(S.today)+'</b></div>'+
    '<div class="meter"><i style="width:'+pct+'%"></i></div>'+
    '<div class="muted" style="margin-top:6px">'+faN(pct)+'٪ از هدف '+durFa(S.me.goal)+'</div></div>'+
    xp+live+quick+logs;
}

function viewStats(){
  var max=1; S.week.forEach(function(d){ if(d.minutes>max) max=d.minutes; });
  var chart = '<div class="chart">'+S.week.map(function(d){
    return '<div class="col"><div class="muted" style="font-size:10px">'+
      (d.minutes?faN(Math.round(d.minutes/6)/10):'')+'</div>'+
      '<div class="colbar'+(d.today?' now':'')+'" style="height:'+Math.max(4,d.minutes/max*100)+'%"></div>'+
      '<div class="muted" style="font-size:11px;font-weight:700">'+d.label+'</div></div>';
  }).join('')+'</div>';

  var bmax = S.breakdown.length? S.breakdown[0].m : 1;
  var brk = S.breakdown.length ? S.breakdown.map(function(r){ var sj=sub(r.subject);
      return '<div class="item"><div class="av" style="background:'+sj.col+'22">'+sj.e+'</div>'+
        '<div style="flex:1"><div class="row between"><b>'+sj.n+'</b>'+
        '<span class="muted">'+durFa(r.m)+'</span></div>'+
        '<div class="meter"><i style="width:'+Math.round(r.m/bmax*100)+'%;background:'+sj.col+'"></i></div></div></div>';
    }).join('') : '<div class="muted">این هفته چیزی ثبت نشده.</div>';

  var cards = '<div class="grid2 stagger" style="margin-bottom:12px">'+
    stat('⏱','این هفته',durFa(S.weekTotal))+
    stat('📚','مجموع کل',durFa(S.total))+
    stat('🔥','استریک',faN(S.streak)+' روز')+
    stat('🏅','بهترین روز',S.bestDay?durFa(S.bestDay.minutes):'—')+'</div>';

  return '<div class="h1" style="margin-bottom:12px">📊 آمار من</div>'+cards+
    '<div class="card fade"><div class="h1" style="margin-bottom:4px">۷ روز گذشته</div>'+
    '<div class="muted">اعداد بالای ستون‌ها ساعت است</div>'+chart+'</div>'+
    '<div class="card fade" style="margin-top:12px"><div class="h1" style="margin-bottom:10px">تفکیک درس‌ها (این هفته)</div>'+brk+'</div>';
}
function stat(e,t,v){ return '<div class="card" style="padding:14px"><div class="muted">'+e+' '+t+'</div>'+
  '<div class="big" style="font-size:19px;margin-top:5px">'+v+'</div></div>'; }

function viewBoardShell(){
  if(!S.groups.length){
    return '<div class="h1" style="margin-bottom:12px">🏆 جدول</div>'+
      '<div class="card fade" style="text-align:center;padding:26px">'+
      '<div style="font-size:44px">👥</div>'+
      '<div class="h1" style="margin:10px 0 6px">هنوز گروهی نداری</div>'+
      '<div class="muted" style="margin-bottom:16px">ربات را به گروه مطالعه‌تان اضافه کن تا جدول رقابت روزانه و هفتگی ساخته شود.</div>'+
      '<button class="btn block" onclick="addToGroup()">➕ افزودن به گروه</button></div>';
  }
  if(!curGroup) curGroup = S.groups[0].id;
  var gsel = S.groups.length>1 ? '<div style="display:flex;gap:8px;overflow:auto;padding-bottom:4px;margin-bottom:10px">'+
    S.groups.map(function(g){ return '<div class="pill" style="white-space:nowrap;'+
      (g.id===curGroup?'background:linear-gradient(135deg,var(--ac),var(--ac2));color:#08122b':'')+
      '" onclick="setGroup('+g.id+')">👥 '+esc((g.title||'گروه').slice(0,18))+'</div>'; }).join('')+'</div>' : '';
  return '<div class="row between" style="margin-bottom:12px"><div class="h1">🏆 جدول</div>'+
    '<div class="row" style="gap:6px">'+
    '<span class="pill" style="'+(boardScope==='day'?'background:var(--card2)':'')+'" onclick="setScope(\\'day\\')">امروز</span>'+
    '<span class="pill" style="'+(boardScope==='week'?'background:var(--card2)':'')+'" onclick="setScope(\\'week\\')">هفته</span>'+
    '</div></div>'+gsel+'<div id="boardBody">'+
    '<div class="sk" style="height:64px;margin-bottom:8px"></div><div class="sk" style="height:64px;margin-bottom:8px"></div>'+
    '<div class="sk" style="height:64px"></div></div>'+
    '<div class="card" style="margin-top:12px"><div class="h1" style="margin-bottom:6px">🌍 لیگ گروه‌ها</div>'+
    '<div class="muted">میانگین مطالعهٔ هر نفر در این هفته</div>'+
    '<div id="league" style="margin-top:10px"><div class="sk" style="height:52px"></div></div></div>';
}
function setGroup(id){ curGroup=id; haptic('light'); render(); }
function setScope(s){ boardScope=s; haptic('light'); render(); }

function loadBoard(){
  if(!S.groups.length) return;
  api('board',{group_id:curGroup,scope:boardScope}).then(function(j){
    if(!j.ok) return;
    var el=document.getElementById('boardBody'); if(!el) return;
    if(!j.rows.length){
      el.innerHTML='<div class="card" style="text-align:center;padding:22px">'+
        '<div style="font-size:38px">🌙</div><div class="h1" style="margin:8px 0 4px">هنوز کسی ثبت نکرده</div>'+
        '<div class="muted">اولین نفر باش و صدر جدول را بگیر</div></div>';
    } else {
      var mx=j.rows[0].m;
      el.innerHTML='<div class="stagger">'+j.rows.map(function(r,i){
        var medal=['🥇','🥈','🥉'][i]||faN(i+1);
        return '<div class="item'+(r.id===S.me.id?' me':'')+'"><div class="rank">'+medal+'</div>'+
          '<div class="av">'+esc(initials(r.first_name))+'</div>'+
          '<div style="flex:1"><div class="row between"><b>'+esc((r.first_name||'کاربر').slice(0,18))+
          (r.id===S.me.id?' <span class="muted">(تو)</span>':'')+'</b>'+
          '<span class="muted">'+durFa(r.m)+'</span></div>'+
          '<div class="meter"><i style="width:'+Math.round(r.m/mx*100)+'%"></i></div></div></div>';
      }).join('')+'</div>'+
      '<div class="muted" style="text-align:center;margin-top:6px">'+
      faN(j.rows.length)+' نفر فعال از '+faN(j.size)+' عضو</div>';
    }
  });
  api('league').then(function(j){
    var el=document.getElementById('league'); if(!el||!j.ok) return;
    if(!j.rows.length){ el.innerHTML='<div class="muted">این هفته لیگ خالی است.</div>'; return; }
    el.innerHTML=j.rows.slice(0,10).map(function(r,i){
      return '<div class="item'+(r.mine?' me':'')+'" style="padding:9px 11px"><div class="rank">'+
        (['🥇','🥈','🥉'][i]||faN(i+1))+'</div><div style="flex:1">'+
        '<b>'+esc((r.title||'گروه').slice(0,20))+'</b>'+
        '<div class="muted">نفری '+durFa(r.avg)+' • '+faN(r.n)+' نفر</div></div></div>';
    }).join('');
  });
}

function viewBadges(){
  var have=S.badges;
  var n=have.length;
  return '<div class="h1" style="margin-bottom:6px">🏅 نشان‌ها</div>'+
    '<div class="muted" style="margin-bottom:12px">'+faN(n)+' از '+faN(ACH.length)+' نشان را گرفته‌ای</div>'+
    '<div class="meter" style="margin-bottom:14px"><i style="width:'+Math.round(n/ACH.length*100)+'%"></i></div>'+
    '<div class="badges stagger">'+ACH.map(function(a){
      var on=have.indexOf(a.c)>=0;
      return '<div class="bd '+(on?'on':'off')+'" onclick="toast(\\''+a.n+' — '+a.d+'\\')">'+
        '<span class="e">'+a.e+'</span><div class="n">'+a.n+'</div></div>';
    }).join('')+'</div>'+
    '<div class="card" style="margin-top:14px"><div class="h1" style="margin-bottom:6px">🤝 دعوت هم‌مطالعه</div>'+
    '<div class="muted" style="margin-bottom:12px">با هم خواندن راحت‌تر است. دوستانت را بیاور تا در جدول با هم رقابت کنید.</div>'+
    '<button class="btn block" onclick="invite()">📤 فرستادن لینک دعوت</button></div>';
}

/* ---------- شیت‌ها ---------- */
function openSheet(html){ document.getElementById('sheetBody').innerHTML=html;
  document.getElementById('sheet').classList.add('open'); haptic('light'); }
function closeSheet(){ document.getElementById('sheet').classList.remove('open'); }

function pickSubject(mode){
  openSheet('<div class="h1" style="margin-bottom:4px">'+(mode==='start'?'چه درسی می‌خوانی؟':'چه درسی را ثبت کنم؟')+'</div>'+
    '<div class="muted" style="margin-bottom:14px">'+(mode==='start'?'تایمر بلافاصله شروع می‌شود':'بعد از انتخاب، مدت را وارد کن')+'</div>'+
    '<div class="subs">'+SUBJECTS.map(function(s){
      return '<div class="sub" onclick="chose(\\''+mode+'\\',\\''+s.c+'\\')">'+
        '<span class="e">'+s.e+'</span><span class="n">'+s.n+'</span></div>'; }).join('')+'</div>');
}
function chose(mode, c){
  if(mode==='start'){ closeSheet(); act('start',{subject:c}); return; }
  manualSheet(c);
}
function manualSheet(c){
  var sj=sub(c), opts=[15,30,45,60,90,120];
  openSheet('<div class="h1" style="margin-bottom:14px">'+sj.e+' '+sj.n+' — چند دقیقه؟</div>'+
    '<div class="grid3" style="margin-bottom:12px">'+opts.map(function(m){
      return '<button class="btn ghost" onclick="doLog(\\''+c+'\\','+m+')">'+
        (m<60?faN(m)+' دقیقه':faN(m/60)+' ساعت')+'</button>'; }).join('')+'</div>'+
    '<div class="row" style="gap:8px"><input id="mm" type="number" inputmode="numeric" placeholder="مثلاً ۷۵ دقیقه" '+
    'style="flex:1;padding:14px;border-radius:16px;border:1px solid var(--line);background:var(--card);color:var(--tx);font:inherit">'+
    '<button class="btn" onclick="doLog(\\''+c+'\\',+document.getElementById(\\'mm\\').value)">ثبت</button></div>');
}
function doLog(c,m){ if(!m||m<1){ toast('عدد را وارد کن'); return; } closeSheet(); act('log',{subject:c,minutes:m}); }

function goalSheet(){
  var opts=[120,180,240,300,360,420,480,600];
  openSheet('<div class="h1" style="margin-bottom:4px">🎯 هدف روزانه</div>'+
    '<div class="muted" style="margin-bottom:14px">فعلاً: '+durFa(S.me.goal)+'</div>'+
    '<div class="grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">'+
    opts.map(function(g){ return '<button class="btn '+(S.me.goal===g?'':'ghost')+'" '+
      'onclick="setGoal('+g+')">'+faN(g/60)+' س</button>'; }).join('')+'</div>');
}
function setGoal(g){ closeSheet(); act('goal',{minutes:g}); }

function shareSheet(){
  var pct=Math.min(100,Math.round(S.today/S.me.goal*100));
  openSheet('<div class="h1" style="margin-bottom:12px">🪄 کارت امروز من</div>'+
    '<div class="share">'+
      '<div class="row between"><b>📚 استادیوم مطالعه</b><span class="muted">'+S.dayLabel+'</span></div>'+
      '<div style="font-size:40px;font-weight:900;margin:14px 0 2px" class="big">'+durFa(S.today)+'</div>'+
      '<div class="muted">مطالعهٔ امروز • '+faN(pct)+'٪ از هدف</div>'+
      '<div class="meter" style="margin:12px 0 14px"><i style="width:'+pct+'%"></i></div>'+
      '<div class="row" style="gap:8px;flex-wrap:wrap"><span class="pill">🔥 '+faN(S.streak)+' روز پیوسته</span>'+
      '<span class="pill">⭐️ سطح '+faN(S.me.level)+'</span>'+
      '<span class="pill">🏅 '+faN(S.badges.length)+' نشان</span></div>'+
      '<div class="muted" style="margin-top:14px">@'+BOT+'</div>'+
    '</div>'+
    '<div class="muted" style="margin:12px 0">از این کارت اسکرین بگیر و در استوری بگذار، یا مستقیم در چت بفرست.</div>'+
    '<button class="btn block" onclick="shareCard()">📤 فرستادن به یک چت</button>');
}
function shareCard(){ try{ tg.switchInlineQuery('کارت من',['users','groups']); }catch(e){ toast('از دکمهٔ اشتراک تلگرام استفاده کن'); } }
function invite(){ try{ tg.switchInlineQuery('بیا با هم بخونیم',['users','groups']); }catch(e){} }
function addToGroup(){ try{ tg.openTelegramLink('https://t.me/'+BOT+'?startgroup=go'); }catch(e){} }

/* ---------- عملیات ---------- */
var busy=false;
function act(a,data){
  if(busy) return; busy=true;
  haptic('medium');
  api(a,data).then(function(j){
    busy=false;
    if(!j || j.ok===false) { toast('خطا، دوباره تلاش کن'); return; }
    apply(j);
    if(a==='stop'){
      if(j.saved>=1){ notify('success'); confetti(); toast('✅ '+durFa(j.saved)+' ثبت شد'); }
      else toast('کمتر از یک دقیقه بود، ثبت نشد');
    }
    if(a==='log' && j.saved) { notify('success'); toast('✅ ثبت شد'); }
    if(a==='start') toast('▶️ شروع شد. تمرکز کن 💪');
    if(j.newBadges && j.newBadges.length) setTimeout(function(){ badgePopup(j.newBadges); },550);
  }).catch(function(){ busy=false; toast('اتصال برقرار نشد'); });
}
function undo(id){ haptic('light'); api('undo',{id:id}).then(function(j){ apply(j); toast('↩️ لغو شد'); }); }

function badgePopup(codes){
  var list=codes.map(function(c){ for(var i=0;i<ACH.length;i++) if(ACH[i].c===c) return ACH[i]; }).filter(Boolean);
  if(!list.length) return;
  notify('success'); confetti();
  openSheet('<div style="text-align:center;padding:6px 0 4px">'+
    '<div style="font-size:56px">'+list[0].e+'</div>'+
    '<div class="h1" style="margin:10px 0 4px">نشان جدید: '+list[0].n+'</div>'+
    '<div class="muted">'+list[0].d+'</div>'+
    (list.length>1?'<div class="muted" style="margin-top:8px">و '+faN(list.length-1)+' نشان دیگر</div>':'')+
    '<button class="btn block" style="margin-top:16px" onclick="closeSheet()">🎉 عالی</button></div>');
}
function confetti(){
  var box=document.createElement('div'); box.className='confetti';
  var cols=['#6ea8fe','#a78bfa','#34d399','#fbbf24','#fb7185'];
  for(var i=0;i<26;i++){
    var d=document.createElement('div'); d.className='cf';
    d.style.left=(Math.random()*100)+'%';
    d.style.background=cols[i%cols.length];
    d.style.animationDelay=(Math.random()*.35)+'s';
    d.style.animationDuration=(1.1+Math.random()*.8)+'s';
    box.appendChild(d);
  }
  document.body.appendChild(box);
  setTimeout(function(){ box.remove(); },2400);
}

/* ---------- تایمر زنده ---------- */
function startTick(){
  clearInterval(tick);
  if(!S || !S.timer || S.timer.paused) return;
  var base=S.timer.seconds, t0=Date.now();
  tick=setInterval(function(){
    var el=document.getElementById('clock'); if(!el){ clearInterval(tick); return; }
    el.textContent=hhmmss(base+Math.floor((Date.now()-t0)/1000));
  },1000);
}

function apply(j){ S=j; render(); }

/* ---------- راه‌اندازی ---------- */
function boot(){
  try{
    tg.ready(); tg.expand();
    tg.setHeaderColor('#0b1020'); tg.setBackgroundColor('#0b1020');
    if(tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if(tg.BackButton) tg.BackButton.hide();
  }catch(e){}
  renderTabs(); render();
  var sp = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
  api('state').then(function(j){
    if(!j.ok){ document.getElementById('view').innerHTML=
      '<div class="card" style="text-align:center;padding:30px"><div style="font-size:40px">🔒</div>'+
      '<div class="h1" style="margin:10px 0 6px">این صفحه باید از داخل تلگرام باز شود</div>'+
      '<div class="muted">به ربات برو و روی «استادیوم» بزن.</div></div>'; return; }
    S=j;
    if(sp && sp.indexOf('g')===0){
      var gid = -Number(sp.slice(1).replace('n',''));
      if(S.groups.some(function(g){return g.id===gid;})){ curGroup=gid; TAB='board'; }
    }
    renderTabs(); render();
  }).catch(function(){
    document.getElementById('view').innerHTML='<div class="card">اتصال برقرار نشد. اینترنت را بررسی کن.</div>';
  });
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && S) api('state').then(function(j){ if(j.ok) apply(j); });
  });
}
boot();
</script>
</body>
</html>`;
}
