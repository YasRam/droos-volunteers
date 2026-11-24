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
