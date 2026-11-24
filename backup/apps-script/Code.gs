/**
 * نسخ احتياطي يومي لبيانات «نشاط دروس التقوية» على جوجل درايف.
 *
 * أول مرة: شغّل الدالة setup واقبل الصلاحيات. هتطبع «كود الربط»،
 * حطه في الموقع: الإعدادات ← النسخ الاحتياطي.
 * بعد كده النسخة بتتعمل لوحدها كل يوم الساعة 3 الفجر.
 *
 * - السر (token) بيفضل هنا في خصائص السكريبت بس؛ الموقع بيعرف بصمته (SHA-256) مش هو.
 * - بيحتفظ بآخر 30 نسخة يومية + أول نسخة في كل شهر.
 * - صور البطايق بتتنسخ في فولدر «صور البطايق» جوه نفس الفولدر (الجديد بس كل يوم).
 * - لو النسخة فشلت، جوجل بيبعتلك إيميل.
 */

const FUNCTION_URL = 'https://vxeseshwjcnenddhiuby.supabase.co/functions/v1/backup';
// Public anon key (not a secret). Only needed if the function checks JWTs.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4ZXNlc2h3amNuZW5kZGhpdWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0MjY0NDQsImV4cCI6MjExMTAwMjQ0NH0.KJie-4aegTr71IJjlYPhTw90x_DcAq_rtYzqusY7LJ8';
const FOLDER_NAME = 'نسخ احتياطية - دروس التقوية';
const IMAGES_FOLDER = 'صور البطايق';
const KEEP_DAILY = 30;
const HOUR = 3;

const props = PropertiesService.getScriptProperties();

/** Run once. Creates the token, the folder and the daily trigger; prints the link code. */
function setup() {
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  folder_();
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'backup').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backup').timeBased().everyDays(1).atHour(HOUR).create();
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'syncSheets').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncSheets').timeBased().everyHours(1).create();
  const code = sha256Hex_(token);
  console.log('كود الربط (حطه في الموقع: الإعدادات ← النسخ الاحتياطي):\n' + code);
  return code;
}

/** Make a new secret (if you think the old one leaked). Then paste the new link code in the site. */
function resetToken() {
  props.deleteProperty('TOKEN');
  return setup();
}

/** The daily job. Can also be run by hand. */
function backup() {
  const token = props.getProperty('TOKEN');
  if (!token) throw new Error('شغّل setup الأول');
  const res = UrlFetchApp.fetch(FUNCTION_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-backup-token': token, Authorization: 'Bearer ' + ANON_KEY, apikey: ANON_KEY },
    payload: '{}',
    muteHttpExceptions: true,
  });
  const status = res.getResponseCode();
  if (status === 401) throw new Error('كود الربط مش متسجل في الموقع أو اتغير. شغّل setup وحط الكود في الإعدادات.');
  if (status !== 200) throw new Error('السيرفر رد بـ ' + status + ': ' + res.getContentText().slice(0, 300));

  const text = res.getContentText('UTF-8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('الرد مش JSON');
  }
  const name = 'droos-backup-' + Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd_HHmm') + '.json.gz';
  try {
    const blob = Utilities.gzip(Utilities.newBlob(text, 'application/json', name.replace(/\.gz$/, '')), name);
    const file = folder_().createFile(blob);
    file.setDescription('صفوف: ' + parsed.rows + ' · ' + JSON.stringify(parsed.counts));
    prune_();
    const images = copyImages_(token, parsed.tables && parsed.tables.volunteers);
    report_(token, name, { ok: true, bytes: blob.getBytes().length, rows: parsed.rows, tables: Object.keys(parsed.counts || {}).length, images: images });
  } catch (e) {
    report_(token, name, { ok: false, error: String(e && e.message || e) });
    throw e;
  }
}

function folder_() {
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) {
      // folder deleted: make a new one
    }
  }
  const f = DriveApp.createFolder(FOLDER_NAME);
  f.setDescription('نسخ احتياطية يومية من بيانات نشاط دروس التقوية. فيها بيانات شخصية: ما تشاركش الفولدر.');
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

/** Copies ID card photos not yet in Drive. Returns how many photos the Drive folder holds. */
function copyImages_(token, volunteers) {
  const res = UrlFetchApp.fetch(FUNCTION_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-backup-token': token, Authorization: 'Bearer ' + ANON_KEY, apikey: ANON_KEY },
    payload: JSON.stringify({ images: true }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('قايمة الصور: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  const list = JSON.parse(res.getContentText()).images || [];
  const parent = folder_();
  const found = parent.getFoldersByName(IMAGES_FOLDER);
  const dir = found.hasNext() ? found.next() : parent.createFolder(IMAGES_FOLDER);

  const have = {};
  const it = dir.searchFiles('trashed = false');
  let count = 0;
  while (it.hasNext()) {
    have[it.next().getDescription()] = true;
    count++;
  }
  const who = {};
  (volunteers || []).forEach((v) => (who[v.id] = (v.code || '') + ' ' + (v.full_name_ar || '')));
  list.forEach((img) => {
    if (have[img.path]) return;
    const r = UrlFetchApp.fetch(img.url, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return;
    const vid = img.path.split('/')[0];
    const file = dir.createFile(r.getBlob().setName(((who[vid] || vid) + ' - ' + img.path.split('/').pop()).trim()));
    file.setDescription(img.path);
    count++;
  });
  return count;
}

/** Keep the newest KEEP_DAILY files, plus the first file of every month. */
function prune_() {
  const files = [];
  const it = folder_().searchFiles('trashed = false');
  while (it.hasNext()) {
    const f = it.next();
    if (/^droos-backup-\d{4}-\d{2}-\d{2}/.test(f.getName())) files.push(f);
  }
  files.sort((a, b) => (a.getName() < b.getName() ? 1 : -1)); // newest first
  const firstOfMonth = {};
  files.slice().reverse().forEach((f) => {
    const month = f.getName().slice(13, 20);
    if (!firstOfMonth[month]) firstOfMonth[month] = f.getId();
  });
  files.slice(KEEP_DAILY).forEach((f) => {
    if (firstOfMonth[f.getName().slice(13, 20)] !== f.getId()) f.setTrashed(true);
  });
}

function report_(token, name, report) {
  try {
    UrlFetchApp.fetch(FUNCTION_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-backup-token': token, Authorization: 'Bearer ' + ANON_KEY, apikey: ANON_KEY },
      payload: JSON.stringify({ file_name: name, report: report }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    console.warn('report failed: ' + e);
  }
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
}

// =====================================================================
// Reports into the branch's Google Sheets (button on the site)
//
// Deployed as a web app (execute as me, anyone can call). Every call carries the signed-in
// user's Supabase session; the script checks it and their «stats.view» permission with
// Supabase itself, then reads the report with that same session (so the database rules apply).
// The sheets are the ones linked in the site's settings; the script writes the month's tab.
// =====================================================================

const SUPABASE_URL = 'https://vxeseshwjcnenddhiuby.supabase.co';
const MONTH_TABS = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
const BRANCH = 'اسكندرية';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = String(body.access_token || '');
    if (!token) throw new Error('لازم تكون داخل الموقع');
    const ctx = sb_('rpc/my_context', token, {});
    const perms = (ctx && ctx.permissions) || [];
    if (perms.indexOf('stats.view') < 0) throw new Error('محتاج صلاحية الإحصائيات');
    if (!/^\d{4}-\d{2}$/.test(String(body.month || ''))) throw new Error('الشهر مش مفهوم');
    const month = body.month + '-01';
    let result;
    if (body.report === 'eval') result = writeEval_(token, month);
    else if (body.report === 'meetings') result = writeMeetings_(token, month);
    else throw new Error('تقرير مش معروف');
    return json_(Object.assign({ ok: true }, result));
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet() {
  return json_({ ok: true, app: 'droos-volunteers sheets' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Calls Supabase REST as the signed-in user. */
function sb_(path, token, payload) {
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: payload === undefined ? 'get' : 'post',
    contentType: 'application/json',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 401) throw new Error('الجلسة خلصت، ادخل الموقع تاني');
  if (code >= 300) throw new Error('السيرفر رد بـ ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || 'null');
}

function sheetUrl_(token, key) {
  const rows = sb_('app_settings?select=value&key=eq.' + key, token);
  const url = rows && rows[0] && rows[0].value;
  if (!url) throw new Error('لينك الشيت مش متحدد في الإعدادات');
  return url;
}

/**
 * Every hour: the current month (and last month during the first 3 days, to catch late entries)
 * is rewritten in the linked evaluation and meetings sheets. Nothing to press on the site.
 */
function syncSheets() {
  const token = props.getProperty('TOKEN');
  if (!token) throw new Error('شغّل setup الأول');
  const now = new Date();
  const ym = (d) => Utilities.formatDate(d, 'Africa/Cairo', 'yyyy-MM');
  const months = [ym(now)];
  if (Number(Utilities.formatDate(now, 'Africa/Cairo', 'd')) <= 3) months.push(ym(new Date(now.getFullYear(), now.getMonth() - 1, 15)));
  months.forEach((m) => {
    const res = UrlFetchApp.fetch(FUNCTION_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-backup-token': token, Authorization: 'Bearer ' + ANON_KEY, apikey: ANON_KEY },
      payload: JSON.stringify({ sheets: { month: m } }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error('تقارير ' + m + ': ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    const data = JSON.parse(res.getContentText());
    if (data.eval_sheet) fillEval_(SpreadsheetApp.openByUrl(data.eval_sheet), m + '-01', data.eval || []);
    if (data.meetings_sheet) fillMeetings_(SpreadsheetApp.openByUrl(data.meetings_sheet), m + '-01', data.meetings || []);
  });
}

const monthTab_ = (month) => MONTH_TABS[Number(month.slice(5, 7)) - 1];
const asDate_ = (iso) => {
  const p = iso.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
};

/** «تقييم فني» in the «اقتراح» layout: one row per day, columns C..Z. */
function writeEval_(token, month) {
  return fillEval_(SpreadsheetApp.openByUrl(sheetUrl_(token, 'report_sheet_eval')), month, sb_('rpc/report_eval', token, { p_month: month }));
}

function fillEval_(ss, month, rows) {
  const name = monthTab_(month);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    const tpl = ss.getSheetByName('اقتراح');
    if (!tpl) throw new Error('مفيش تابة «' + name + '» ولا تابة «اقتراح» أنسخ منها');
    sh = tpl.copyTo(ss).setName(name);
  }
  // Data starts two rows under the row whose first cell is «اليوم»
  const head = sh.getRange(1, 1, 8, 1).getValues().map((r) => String(r[0]).trim());
  const dayRow = head.indexOf('اليوم');
  if (dayRow < 0) throw new Error('مش لاقي عمود «اليوم» في تابة ' + name);
  const first = dayRow + 3;
  sh.getRange(1, 1).setValue('شيت تقييم شهر ' + name + ' ' + month.slice(0, 4));

  const keys = ['classes', 'foundation', 'content', 'exam_primary', 'exam_prep', 'organizers', 'admin', 'meetings_desc', 'meetings', 'camps',
    'workshop_type', 'workshops', 'sports', 'trips', 'behavior', 'religious', 'quran', 'calls', 'media', 'courses_type', 'courses',
    'events', 'other_type', 'other'];
  const values = [];
  for (let i = 0; i < 31; i++) {
    const r = rows[i];
    values.push(r ? [asDate_(r.day)].concat(keys.map((k) => (r[k] === null || r[k] === undefined ? '' : r[k]))) : new Array(keys.length + 1).fill(''));
  }
  sh.getRange(first, 2, 31, keys.length + 1).setValues(values);
  return { url: ss.getUrl() + '#gid=' + sh.getSheetId(), rows: rows.length, tab: name };
}

/** «شيت الاجتماعات»: the month's tab gets every meeting of the month (rewritten each time). */
function writeMeetings_(token, month) {
  return fillMeetings_(SpreadsheetApp.openByUrl(sheetUrl_(token, 'report_sheet_meetings')), month, sb_('rpc/report_meetings', token, { p_month: month }));
}

function fillMeetings_(ss, month, rows) {
  const name = monthTab_(month);
  const headers = ['العدد', 'تاريخ الاجتماع', 'اسم الفرع / مركزي', 'اللجنة', 'هيد الاجتماع', 'دور هيد الاجتماع في الهيكل', 'عدد الحاضرين',
    'الهدف من الاجتماع', 'انجازات اللجنة', 'نوع الاجتماع', 'لينك المحضر'];
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.setRightToLeft(true);
    sh.getRange(1, 1, 1, headers.length).merge().setValue('نشاط دروس التقوية شهر ' + name + ' ' + month.slice(0, 4))
      .setHorizontalAlignment('center').setFontWeight('bold').setBackground('#d9ead3');
    sh.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f3f3f3');
    sh.setFrozenRows(2);
  }
  const top = sh.getRange(1, 1, 6, 1).getValues().map((r) => String(r[0]).trim());
  const hdr = top.indexOf('العدد');
  if (hdr < 0) throw new Error('مش لاقي عمود «العدد» في تابة ' + name);
  const first = hdr + 2;
  const last = sh.getLastRow();
  if (last >= first) sh.getRange(first, 1, last - first + 1, headers.length).clearContent();
  if (rows.length) {
    sh.getRange(first, 1, rows.length, headers.length).setValues(rows.map((r) => [
      r.n, asDate_(r.meeting_date), BRANCH, r.committee, r.head || '', r.head_role || '', r.attendees,
      r.goal || '', r.achievements || '', r.meeting_type || '', r.minutes_link || '',
    ]));
  }
  return { url: ss.getUrl() + '#gid=' + sh.getSheetId(), rows: rows.length, tab: name };
}
