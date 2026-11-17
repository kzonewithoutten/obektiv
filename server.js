/*
 * Фотосалон «Объектив» — сервер.
 * Запуск: node server.js   (нужен Node.js 22.13 или новее, больше ничего ставить не нужно)
 *
 * Переменные окружения (необязательно):
 *   PORT            — порт, по умолчанию 3000
 *   DATA_DIR        — где хранить базу и загруженные фото, по умолчанию ./data
 *   ADMIN_PASSWORD  — пароль администратора при первом запуске
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const dbLib = require('./lib/db');
const { writeZip } = require('./lib/zip');
const seo = require('./lib/seo');
const fontsLib = require('./lib/fonts');
const Pricing = require('./public/js/pricing.js');
const Validate = require('./public/js/validate.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD = 60 * 1024 * 1024; // 60 МБ на один файл
const SESSION_DAYS = 60;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = dbLib.open(DATA_DIR);

// ---------------------------------------------------------------- админ
(function ensureAdmin() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (admin) return;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(5).toString('hex');
  db.prepare("INSERT INTO users (name, phone, password_hash, role) VALUES ('Администратор', 'admin', ?, 'admin')").run(
    hashPassword(password)
  );
  const line = '='.repeat(60);
  console.log(`\n${line}\n  Создан администратор\n  Логин:  admin\n  Пароль: ${password}\n  Смените пароль в личном кабинете после входа.\n${line}\n`);
})();

// ---------------------------------------------------------------- утилиты
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length >= 10 && d.length <= 15 ? '+' + d : null;
}
function str(v, max = 500) {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function num(v, min = -1e9, max = 1e9) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}
function parseJSON(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readJSON(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Слишком большой запрос'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Некорректные данные'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---------------------------------------------------------------- сессии
function createSession(res, userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = proto === 'https' || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
function getUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const row = db
    .prepare('SELECT u.id, u.name, u.phone, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
    .get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, name: row.name, phone: row.phone, role: row.role };
}
function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Войдите в аккаунт');
  return ctx.user;
}
function requireAdmin(ctx) {
  if (!ctx.user || ctx.user.role !== 'admin') throw new HttpError(403, 'Нужны права администратора');
  return ctx.user;
}

// Простейшая защита от подбора пароля
const loginAttempts = new Map();
function checkRate(key, max = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const rec = loginAttempts.get(key) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) {
    rec.n = 0;
    rec.reset = now + windowMs;
  }
  rec.n++;
  loginAttempts.set(key, rec);
  if (rec.n > max) throw new HttpError(429, 'Слишком много попыток. Попробуйте через 10 минут');
}

function prevPrints(userId, excludeOrderId = 0) {
  return (
    db
      .prepare("SELECT COALESCE(SUM(prints), 0) AS n FROM orders WHERE user_id = ? AND type = 'print' AND status != 'cancelled' AND id != ?")
      .get(userId, excludeOrderId).n || 0
  );
}

// ---------------------------------------------------------------- файлы
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
}

function handleUpload(req, res, ctx) {
  const user = requireUser(ctx);
  const isPublic = ctx.url.searchParams.get('public') === '1';
  if (isPublic && user.role !== 'admin') throw new HttpError(403, 'Нет доступа');
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD) throw new HttpError(413, 'Файл больше 60 МБ');

  let original = 'photo';
  try {
    original = decodeURIComponent(String(req.headers['x-file-name'] || 'photo')).slice(0, 200);
  } catch {}

  const id = crypto.randomBytes(12).toString('hex');
  const tmpPath = path.join(UPLOAD_DIR, id + '.part');
  const out = fs.createWriteStream(tmpPath);
  let size = 0;
  let head = Buffer.alloc(0);
  let failed = false;

  return new Promise((resolve) => {
    const fail = (status, msg) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(tmpPath, { force: true }, () => {});
      send(res, status, { error: msg });
      req.resume();
      resolve();
    };
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_UPLOAD) return fail(413, 'Файл больше 60 МБ');
      if (head.length < 16) head = Buffer.concat([head, chunk]).slice(0, 16);
      out.write(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      out.end(() => {
        const mime = sniffMime(head);
        if (!mime) return fail(415, 'Это не похоже на фото. Подойдут JPG, PNG, WEBP или HEIC');
        const diskName = id + MIME_EXT[mime];
        fs.renameSync(tmpPath, path.join(UPLOAD_DIR, diskName));
        db.prepare(
          'INSERT INTO files (id, owner_id, original_name, mime, size, disk_name, is_public, used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(id, user.id, original, mime, size, diskName, isPublic ? 1 : 0, isPublic ? 1 : 0, Date.now());
        send(res, 200, { id, url: `/files/${id}`, mime, size });
        resolve();
      });
    });
    req.on('error', () => fail(400, 'Загрузка прервалась'));
  });
}

function serveFile(req, res, ctx, id, asDownload, downloadName) {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!f) throw new HttpError(404, 'Файл не найден');
  const isAdmin = ctx.user && ctx.user.role === 'admin';
  const isOwner = ctx.user && ctx.user.id === f.owner_id;
  if (!f.is_public && !isAdmin && !isOwner) throw new HttpError(403, 'Нет доступа');
  const p = path.join(UPLOAD_DIR, f.disk_name);
  if (!fs.existsSync(p)) throw new HttpError(404, 'Файл не найден');
  const headers = {
    'Content-Type': f.mime,
    'Content-Length': fs.statSync(p).size,
    'Cache-Control': f.is_public ? 'public, max-age=604800' : 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (asDownload) {
    const name = downloadName || f.original_name || f.disk_name;
    headers['Content-Disposition'] = `attachment; filename="file${path.extname(f.disk_name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(p).pipe(res);
}

function useFiles(ids, userId) {
  const upd = db.prepare('UPDATE files SET used = 1 WHERE id = ?');
  for (const id of ids) {
    if (!id) continue;
    const f = db.prepare('SELECT owner_id FROM files WHERE id = ?').get(id);
    if (!f || f.owner_id !== userId) throw new HttpError(400, 'Фото не найдено, загрузите его заново');
    upd.run(id);
  }
}

// Удаляем загрузки, которые так и не попали в заказ (через сутки)
function cleanupFiles() {
  const old = db.prepare('SELECT id, disk_name FROM files WHERE used = 0 AND created_at < ?').all(Date.now() - 864e5);
  for (const f of old) {
    fs.rm(path.join(UPLOAD_DIR, f.disk_name), { force: true }, () => {});
    db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
setInterval(cleanupFiles, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------- сериализация
function publicService(r, full) {
  const s = {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    priceFrom: r.price_from,
    cover: r.cover,
    action: r.action,
    published: !!r.published,
    sort: r.sort,
    seoTitle: r.seo_title || '',
    seoDescription: r.seo_description || '',
    updatedAt: r.updated_at,
  };
  if (full) s.blocks = parseJSON(r.blocks, []);
  return s;
}
function publicTemplate(r) {
  return {
    id: r.id,
    name: r.name,
    kind: ['tee', 'oversize', 'long', 'mug'].includes(r.kind) ? r.kind : 'tee',
    color: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#F4F2EE',
    price: r.price,
    sizes: parseJSON(r.sizes, []),
    active: !!r.active,
    sort: r.sort,
  };
}
function orderOut(r) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    name: r.name,
    phone: r.phone,
    comment: r.comment,
    items: parseJSON(r.items, []),
    prints: r.prints,
    subtotal: r.subtotal,
    discount: r.discount,
    total: r.total,
    adminNote: r.admin_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const STATUSES = ['new', 'work', 'ready', 'done', 'cancelled'];

function slugify(s) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
    о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  };
  return (
    String(s || '')
      .toLowerCase()
      .split('')
      .map((c) => (map[c] !== undefined ? map[c] : c))
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'usluga'
  );
}

// Проверка блоков конструктора страниц
const BLOCK_TYPES = ['heading', 'text', 'image', 'gallery', 'prices', 'print_prices', 'faq', 'callout'];
function cleanBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((b) => b && BLOCK_TYPES.includes(b.type))
    .slice(0, 60)
    .map((b) => {
      const o = { type: b.type };
      if (b.type === 'heading') o.text = str(b.text, 200);
      if (b.type === 'text') o.text = str(b.text, 8000);
      if (b.type === 'image') {
        o.src = str(b.src, 300);
        o.caption = str(b.caption, 300);
      }
      if (b.type === 'gallery') o.images = (Array.isArray(b.images) ? b.images : []).slice(0, 40).map((x) => str(x, 300));
      if (b.type === 'prices') {
        o.title = str(b.title, 200);
        o.rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 100).map((r) => ({
          name: str(r.name, 200),
          price: str(r.price, 60),
          note: str(r.note, 200),
        }));
      }
      if (b.type === 'print_prices') o.title = str(b.title, 200);
      if (b.type === 'faq') o.items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map((r) => ({ q: str(r.q, 300), a: str(r.a, 3000) }));
      if (b.type === 'callout') {
        o.title = str(b.title, 200);
        o.text = str(b.text, 2000);
      }
      return o;
    });
}

function cleanSettings(key, v) {
  if (key === 'salon') {
    const s = {};
    for (const f of ['name', 'tagline', 'heroTitle', 'heroText', 'phone', 'address', 'hours', 'mapUrl', 'email', 'vk', 'telegram', 'whatsapp', 'max', 'teeCover', 'city', 'seoDescription', 'ogImage', 'yandexVerification', 'googleVerification'])
      s[f] = str(v[f], f === 'heroText' || f === 'seoDescription' ? 600 : 300);
    s.name = s.name || 'Объектив';
    s.heroPhotos = (Array.isArray(v.heroPhotos) ? v.heroPhotos : []).slice(0, 3).map((x) => str(x, 300));
    for (const f of ['fontDisplay', 'fontBody']) {
      const name = str(v[f], 60);
      if (name && !fontsLib.isValidName(name)) throw new HttpError(400, 'Название шрифта: только латинские буквы, цифры и пробелы, как на fonts.google.com');
      s[f] = name;
    }
    s.configured = true;
    return s;
  }
  if (key === 'pricing') {
    const p = v.print || {};
    const seen = new Set();
    const formats = (Array.isArray(p.formats) ? p.formats : [])
      .slice(0, 40)
      .map((f) => {
        const wcm = num(f.wcm, 0, 300);
        const hcm = num(f.hcm, 0, 300);
        let id = str(f.id, 40) || slugify(`${wcm}x${hcm}`);
        while (seen.has(id)) id += '-2';
        seen.add(id);
        const out = {
          id,
          name: str(f.name, 60) || `${wcm}×${hcm}`,
          wcm,
          hcm,
          priceBw: num(f.priceBw, 0, 1e6),
          priceColor: num(f.priceColor, 0, 1e6),
          priceGlossy: num(f.priceGlossy, 0, 1e6),
          priceMatte: num(f.priceMatte, 0, 1e6),
        };
        out.price = Pricing.minFormatPrice(out);
        return out;
      });
    const papers = Pricing.PAPERS.map((x) => ({ ...x, extra: 0 }));
    const sizes = (Array.isArray(v.tshirt && v.tshirt.sizes) ? v.tshirt.sizes : []).slice(0, 20).map((s) => ({
      name: str(s.name, 10) || '?',
      extra: num(s.extra, -1e5, 1e6),
    }));
    return {
      currency: str(v.currency, 5) || '₽',
      configured: true,
      print: {
        formats,
        papers,
        discountEvery: Math.round(num(p.discountEvery, 0, 1000)),
        discountPercent: num(p.discountPercent, 0, 100),
      },
      tshirt: { sizes, stickerExtra: num(v.tshirt && v.tshirt.stickerExtra, 0, 1e6) },
    };
  }
  throw new HttpError(400, 'Неизвестная настройка');
}

// ---------------------------------------------------------------- маршруты
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// --- авторизация
// --- подтверждение телефона: SMS, звонок (SMS.ru) или сообщение в WhatsApp / MAX (GREEN-API)
const smsCodes = new Map(); // телефон → { code, exp, tries, sentAt }
const VERIFY_LABEL = { sms: 'SMS', call: 'звонок', whatsapp: 'WhatsApp', max: 'MAX' };
function verifySettings() {
  const v = dbLib.getSetting(db, 'verify') || {};
  const old = dbLib.getSetting(db, 'sms') || {};
  const s = {
    method: v.method || (old.enabled ? 'sms' : 'off'),
    smsruApiId: v.smsruApiId || old.apiId || '',
    greenApiUrl: v.greenApiUrl || '',
    greenId: v.greenId || '',
    greenToken: v.greenToken || '',
  };
  const ready =
    process.env.SMS_FAKE === '1' ||
    ((s.method === 'sms' || s.method === 'call') && !!s.smsruApiId) ||
    ((s.method === 'whatsapp' || s.method === 'max') && !!(s.greenApiUrl && s.greenId && s.greenToken));
  s.enabled = s.method !== 'off' && ready;
  return s;
}
function httpJSON(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = require('https').request(
      u,
      { method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, timeout: 20000 },
      (r) => {
        let raw = '';
        r.on('data', (c) => (raw += c));
        r.on('end', () => {
          try {
            resolve({ status: r.statusCode, json: JSON.parse(raw) });
          } catch {
            resolve({ status: r.statusCode, json: null, raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}
/** Отправляет код. Возвращает код, который должен ввести человек */
async function deliverCode(digits, ip) {
  const v = verifySettings();
  const name = dbLib.getSetting(db, 'salon').name;
  const fail = (m) => new HttpError(502, m);
  if (process.env.SMS_FAKE === '1') {
    const code = String(crypto.randomInt(1000, 10000));
    console.log(`[${v.method} на ${digits}] код ${code}`);
    return code;
  }
  try {
    if (v.method === 'call') {
      const r = await httpJSON(`https://sms.ru/code/call?phone=${digits}&ip=${encodeURIComponent(ip || '-1')}&api_id=${encodeURIComponent(v.smsruApiId)}`);
      if (r.json && r.json.status === 'OK' && r.json.code) return String(r.json.code);
      console.error('SMS.ru call:', r.raw || JSON.stringify(r.json));
      throw fail('Не получилось позвонить. Проверьте номер или попробуйте позже');
    }
    const code = String(crypto.randomInt(1000, 10000));
    const text = `Код для регистрации: ${code}. ${name}`;
    if (v.method === 'sms') {
      const r = await httpJSON(`https://sms.ru/sms/send?api_id=${encodeURIComponent(v.smsruApiId)}&to=${digits}&msg=${encodeURIComponent(text)}&json=1`);
      const one = r.json && r.json.sms && r.json.sms[digits];
      if (r.json && r.json.status === 'OK' && one && one.status === 'OK') return code;
      console.error('SMS.ru sms:', r.raw || JSON.stringify(r.json));
      throw fail('Не получилось отправить SMS. Попробуйте позже');
    }
    // WhatsApp или MAX через GREEN-API
    const base = v.greenApiUrl.replace(/\/+$/, '');
    const r = await httpJSON(`${base}/waInstance${encodeURIComponent(v.greenId)}/sendMessage/${encodeURIComponent(v.greenToken)}`, {
      method: 'POST',
      body: { chatId: `${digits}@c.us`, message: text },
    });
    if (r.status === 200 && r.json && r.json.idMessage) return code;
    console.error('GREEN-API:', r.status, r.raw || JSON.stringify(r.json));
    throw fail(`Не получилось отправить код в ${VERIFY_LABEL[v.method]}. Проверьте, что этот номер есть в ${VERIFY_LABEL[v.method]}`);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw fail('Сервис отправки кода не отвечает. Попробуйте позже');
  }
}
const must = (r) => {
  if (!r.ok) throw new HttpError(400, r.error);
  return r.value;
};

route('POST', /^\/api\/auth\/send-code$/, async (req, res, ctx) => {
  const b = await readJSON(req);
  if (!verifySettings().enabled) throw new HttpError(400, 'Подтверждение номера выключено');
  const phone = must(Validate.checkPhone(b.phone));
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new HttpError(409, 'Этот номер уже зарегистрирован. Войдите в аккаунт');
  checkRate('sms-ip:' + ctx.ip, 6, 60 * 60 * 1000);
  const prev = smsCodes.get(phone);
  if (prev && Date.now() - prev.sentAt < 60 * 1000) throw new HttpError(429, 'Код уже отправлен. Повторно можно через минуту');
  const code = await deliverCode(phone.slice(1), ctx.ip);
  smsCodes.set(phone, { code, exp: Date.now() + 10 * 60 * 1000, tries: 0, sentAt: Date.now() });
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/auth\/register$/, async (req, res, ctx) => {
  const b = await readJSON(req);
  checkRate('reg:' + ctx.ip, 20);
  if (b.website) throw new HttpError(400, 'Не получилось зарегистрироваться'); // ловушка для ботов
  const name = must(Validate.checkName(b.name));
  const phone = must(Validate.checkPhone(b.phone));
  const password = must(Validate.checkPassword(b.password));
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone))
    throw new HttpError(409, 'Этот номер уже зарегистрирован. Войдите в аккаунт');
  if (verifySettings().enabled) {
    const rec = smsCodes.get(phone);
    if (!rec || rec.exp < Date.now()) throw new HttpError(400, 'Сначала запросите код');
    rec.tries++;
    if (rec.tries > 5) {
      smsCodes.delete(phone);
      throw new HttpError(429, 'Слишком много попыток. Запросите новый код');
    }
    if (String(b.code || '').trim() !== rec.code) throw new HttpError(400, 'Неверный код');
    smsCodes.delete(phone);
  }
  const r = db.prepare('INSERT INTO users (name, phone, password_hash) VALUES (?, ?, ?)').run(name, phone, hashPassword(password));
  createSession(res, Number(r.lastInsertRowid), req);
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/auth\/login$/, async (req, res, ctx) => {
  const b = await readJSON(req);
  checkRate('login:' + ctx.ip);
  const login = String(b.login || '').trim();
  const phone = login.toLowerCase() === 'admin' ? 'admin' : normalizePhone(login);
  const u = phone && db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!u || !checkPassword(String(b.password || ''), u.password_hash)) throw new HttpError(401, 'Неверный телефон или пароль');
  createSession(res, u.id, req);
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/auth\/logout$/, async (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/auth\/password$/, async (req, res, ctx) => {
  const user = requireUser(ctx);
  const b = await readJSON(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!checkPassword(String(b.current || ''), u.password_hash)) throw new HttpError(400, 'Текущий пароль указан неверно');
  must(Validate.checkPassword(b.next));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(b.next)), user.id);
  send(res, 200, { ok: true });
});

route('GET', /^\/api\/me$/, async (req, res, ctx) => {
  if (!ctx.user) return send(res, 200, { user: null });
  send(res, 200, { user: { ...ctx.user, prints: prevPrints(ctx.user.id) } });
});

route('PATCH', /^\/api\/me$/, async (req, res, ctx) => {
  const user = requireUser(ctx);
  const b = await readJSON(req);
  const name = must(Validate.checkName(b.name));
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
  send(res, 200, { ok: true });
});

// --- публичные данные
route('GET', /^\/api\/site$/, async (req, res) => {
  const services = db
    .prepare('SELECT * FROM services WHERE published = 1 ORDER BY sort, id')
    .all()
    .map((r) => publicService(r, false));
  send(res, 200, { salon: dbLib.getSetting(db, 'salon'), pricing: dbLib.getSetting(db, 'pricing'), services, verify: (() => {
    const v = verifySettings();
    return v.enabled ? { method: v.method } : null;
  })() });
});

route('GET', /^\/api\/services\/([a-z0-9-]+)$/, async (req, res, ctx, m) => {
  const r = db.prepare('SELECT * FROM services WHERE slug = ?').get(m[1]);
  const isAdmin = ctx.user && ctx.user.role === 'admin';
  if (!r || (!r.published && !isAdmin)) throw new HttpError(404, 'Такой услуги нет');
  send(res, 200, publicService(r, true));
});

route('GET', /^\/api\/templates$/, async (req, res) => {
  send(res, 200, db.prepare('SELECT * FROM templates WHERE active = 1 ORDER BY sort, id').all().map(publicTemplate));
});

route('POST', /^\/api\/upload$/, handleUpload);

route('GET', /^\/files\/([a-f0-9]{24})$/, async (req, res, ctx, m) => serveFile(req, res, ctx, m[1], false));

// --- заказы клиента
route('POST', /^\/api\/orders\/print$/, async (req, res, ctx) => {
  const user = requireUser(ctx);
  const b = await readJSON(req);
  const phone = must(Validate.checkPhone(b.phone));
  const name = must(Validate.checkName(b.name || user.name));
  const comment = must(Validate.checkComment(b.comment));
  const raw = Array.isArray(b.items) ? b.items.slice(0, 500) : [];
  if (!raw.length) throw new HttpError(400, 'Добавьте хотя бы одно фото');

  const pricing = dbLib.getSetting(db, 'pricing');
  const items = raw.map((it) => ({
    file: str(it.file, 40),
    thumb: str(it.thumb, 40),
    name: str(it.name, 200),
    format: str(it.format, 40),
    paper: str(it.paper, 40),
    color: it.color === 'bw' ? 'bw' : 'color',
    copies: Math.max(1, Math.min(999, parseInt(it.copies, 10) || 1)),
  }));
  const calc = Pricing.calcPrint(pricing, items, prevPrints(user.id));
  if (calc.lines.some((l) => !l.ok)) throw new HttpError(400, 'Такого сочетания формата и бумаги нет. Обновите страницу');

  useFiles(items.flatMap((i) => [i.file, i.thumb]), user.id);
  const fmtName = (id) => (pricing.print.formats.find((f) => f.id === id) || {}).name || id;
  const paperName = (id) => (Pricing.PAPERS.find((f) => f.id === id) || {}).name || id;
  const colorName = (id) => (Pricing.COLORS.find((c) => c.id === id) || {}).name || id;
  const stored = items.map((it, i) => ({
    ...it,
    formatName: fmtName(it.format),
    paperName: paperName(it.paper),
    colorName: colorName(it.color),
    unit: calc.lines[i].unit,
    line: calc.lines[i].line,
    discount: calc.lines[i].discount,
  }));
  const r = db
    .prepare('INSERT INTO orders (user_id, type, name, phone, comment, items, prints, subtotal, discount, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, 'print', name, phone, comment, JSON.stringify(stored), calc.prints, calc.subtotal, calc.discount, calc.total);
  send(res, 200, { id: Number(r.lastInsertRowid), total: calc.total, discount: calc.discount });
});

route('POST', /^\/api\/orders\/tshirt$/, async (req, res, ctx) => {
  const user = requireUser(ctx);
  const b = await readJSON(req);
  const phone = must(Validate.checkPhone(b.phone));
  const name = must(Validate.checkName(b.name || user.name));
  const comment = must(Validate.checkComment(b.comment));
  const tpl = db.prepare("SELECT * FROM templates WHERE id = ? AND active = 1 AND kind != 'mug'").get(Number(b.templateId));
  if (!tpl) throw new HttpError(400, 'Модель футболки не найдена');
  const t = publicTemplate(tpl);
  const size = str(b.size, 10);
  if (!t.sizes.includes(size)) throw new HttpError(400, 'Выберите размер');
  const PANELS = ['front', 'back', 'left', 'right'];
  const stickers = (Array.isArray(b.stickers) ? b.stickers : []).slice(0, 12).map((s) => ({
    file: str(s.file, 40),
    name: str(s.name, 200),
    panel: PANELS.includes(s.panel) ? s.panel : 'front',
    cx: num(s.cx, 0, 1),
    cy: num(s.cy, 0, 1),
    w: num(s.w, 0.01, 3),
    rot: num(s.rot, -360, 360),
    cmW: num(s.cmW, 0, 500),
    cmH: num(s.cmH, 0, 500),
  }));
  if (!stickers.length || stickers.some((s) => !s.file)) throw new HttpError(400, 'Добавьте хотя бы одну картинку');
  const preview = str(b.preview, 40);
  if (!preview) throw new HttpError(400, 'Не получилось сохранить макет, попробуйте ещё раз');
  const pricing = dbLib.getSetting(db, 'pricing');
  const calc = Pricing.calcTshirt(pricing, t, size, b.qty, stickers.length);
  if (!calc.ok) throw new HttpError(400, 'Этот размер больше недоступен');
  useFiles([...stickers.map((s) => s.file), preview], user.id);
  const item = { preview, templateId: t.id, templateName: t.name, kind: t.kind, color: t.color, size, qty: calc.qty, unit: calc.unit, line: calc.total, stickers };
  const r = db
    .prepare('INSERT INTO orders (user_id, type, name, phone, comment, items, prints, subtotal, discount, total) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?)')
    .run(user.id, 'tshirt', name, phone, comment, JSON.stringify([item]), calc.total, calc.total);
  send(res, 200, { id: Number(r.lastInsertRowid), total: calc.total });
});

// Кружка из 3D-конструктора: перёд и зад, макет и картинки как у футболки
route('POST', /^\/api\/orders\/mug$/, async (req, res, ctx) => {
  const user = requireUser(ctx);
  const b = await readJSON(req);
  const phone = must(Validate.checkPhone(b.phone));
  const name = must(Validate.checkName(b.name || user.name));
  const comment = must(Validate.checkComment(b.comment));
  const tpl = db.prepare("SELECT * FROM templates WHERE id = ? AND active = 1 AND kind = 'mug'").get(Number(b.templateId));
  if (!tpl) throw new HttpError(400, 'Модель кружки не найдена');
  const t = publicTemplate(tpl);
  const stickers = (Array.isArray(b.stickers) ? b.stickers : []).slice(0, 12).map((s) => ({
    file: str(s.file, 40),
    name: str(s.name, 200),
    panel: s.panel === 'back' ? 'back' : 'front',
    cx: num(s.cx, 0, 1),
    cy: num(s.cy, 0, 1),
    w: num(s.w, 0.01, 3),
    rot: num(s.rot, -360, 360),
    cmW: num(s.cmW, 0, 500),
    cmH: num(s.cmH, 0, 500),
  }));
  if (!stickers.length || stickers.some((s) => !s.file)) throw new HttpError(400, 'Добавьте хотя бы одну картинку');
  const preview = str(b.preview, 40);
  if (!preview) throw new HttpError(400, 'Не получилось сохранить макет, попробуйте ещё раз');
  const calc = Pricing.calcMug(t, b.qty);
  useFiles([...stickers.map((s) => s.file), preview], user.id);
  const item = { preview, templateId: t.id, templateName: t.name, kind: t.kind, color: t.color, qty: calc.qty, unit: calc.unit, line: calc.total, stickers };
  const r = db
    .prepare("INSERT INTO orders (user_id, type, name, phone, comment, items, prints, subtotal, discount, total) VALUES (?, 'mug', ?, ?, ?, ?, 0, ?, 0, ?)")
    .run(user.id, name, phone, comment, JSON.stringify([item]), calc.total, calc.total);
  send(res, 200, { id: Number(r.lastInsertRowid), total: calc.total });
});

// Заявка на услугу без онлайн-расчёта (цифровые услуги и т.п.): что нужно + телефон
route('POST', /^\/api\/orders\/request$/, async (req, res, ctx) => {
  const user = requireUser(ctx);
  const b = await readJSON(req);
  const phone = must(Validate.checkPhone(b.phone));
  const name = must(Validate.checkName(b.name || user.name));
  const text = must(Validate.checkComment(b.text));
  if (!text) throw new HttpError(400, 'Опишите, что нужно сделать');
  const sv = db.prepare("SELECT id, title FROM services WHERE slug = ? AND published = 1 AND action = 'request'").get(str(b.service, 100));
  if (!sv) throw new HttpError(400, 'Услуга не найдена. Обновите страницу');
  const item = { serviceId: sv.id, serviceTitle: sv.title, text };
  const r = db
    .prepare("INSERT INTO orders (user_id, type, name, phone, comment, items, prints, subtotal, discount, total) VALUES (?, 'request', ?, ?, '', ?, 0, 0, 0, 0)")
    .run(user.id, name, phone, JSON.stringify([item]));
  send(res, 200, { id: Number(r.lastInsertRowid) });
});

route('GET', /^\/api\/my\/orders$/, async (req, res, ctx) => {
  const user = requireUser(ctx);
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(user.id);
  send(res, 200, rows.map(orderOut));
});

// --- админка: заказы
route('GET', /^\/api\/admin\/orders$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  const status = ctx.url.searchParams.get('status');
  const type = ctx.url.searchParams.get('type');
  const q = str(ctx.url.searchParams.get('q'), 50);
  const where = [];
  const args = [];
  if (status && STATUSES.includes(status)) {
    where.push('status = ?');
    args.push(status);
  } else if (status === 'active') where.push("status IN ('new','work','ready')");
  if (['print', 'tshirt', 'mug', 'request'].includes(type)) {
    where.push('type = ?');
    args.push(type);
  }
  if (q) {
    const digits = q.replace(/\D/g, '');
    where.push('(CAST(id AS TEXT) = ? OR name LIKE ? ' + (digits.length >= 3 ? 'OR phone LIKE ?' : '') + ')');
    args.push(q.replace(/^#/, ''), `%${q}%`);
    if (digits.length >= 3) args.push(`%${digits}%`);
  }
  const sql = `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`;
  const counts = {};
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()) counts[r.status] = r.n;
  send(res, 200, { orders: db.prepare(sql).all(...args).map(orderOut), counts });
});

route('PATCH', /^\/api\/admin\/orders\/(\d+)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  const b = await readJSON(req);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(m[1]));
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const status = STATUSES.includes(b.status) ? b.status : o.status;
  const note = b.adminNote !== undefined ? str(b.adminNote, 1000) : o.admin_note;
  db.prepare("UPDATE orders SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?").run(status, note, o.id);
  send(res, 200, orderOut(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
});

const PANEL_LAT = { front: 'pered', back: 'spina', left: 'levyy-rukav', right: 'pravyy-rukav' };
function orderFileName(o, item, idx, f, k) {
  const ext = path.extname(f.disk_name);
  if (o.type === 'print') return `zakaz-${o.id}_${String(idx + 1).padStart(2, '0')}_${item.format}_${item.paper}${item.color ? '_' + item.color : ''}_x${item.copies}${ext}`;
  if (k === 'preview') return `zakaz-${o.id}_maket${ext}`;
  const s = item.stickers && item.stickers[k];
  if (!s) return `zakaz-${o.id}_izobrazhenie${ext}`;
  return `zakaz-${o.id}_naklejka-${k + 1}_${PANEL_LAT[s.panel]}_${Math.round(s.cmW)}x${Math.round(s.cmH)}sm${ext}`;
}
// Все файлы заказа: [{ key, f, name }]
function orderFiles(o) {
  const out = [];
  const get = (id) => id && db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  parseJSON(o.items, []).forEach((item, idx) => {
    if (o.type === 'print') {
      const f = get(item.file);
      if (f) out.push({ key: String(idx), f, name: orderFileName(o, item, idx, f) });
      return;
    }
    const p = get(item.preview);
    if (p) out.push({ key: 'preview', f: p, name: orderFileName(o, item, idx, p, 'preview') });
    (item.stickers || []).forEach((s, k) => {
      const f = get(s.file);
      if (f) out.push({ key: 's' + k, f, name: orderFileName(o, item, idx, f, k) });
    });
    if (item.file) {
      const f = get(item.file); // заказы из прошлой версии конструктора
      if (f) out.push({ key: 'old', f, name: orderFileName(o, item, idx, f, -1) });
    }
  });
  return out;
}

route('GET', /^\/api\/admin\/orders\/(\d+)\/file\/([a-z0-9]+)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(m[1]));
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const hit = orderFiles(o).find((x) => x.key === m[2]);
  if (!hit) throw new HttpError(404, 'Файл не найден');
  serveFile(req, res, ctx, hit.f.id, true, hit.name);
});

route('GET', /^\/api\/admin\/orders\/(\d+)\/zip$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(m[1]));
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const entries = orderFiles(o).map((x) => ({ name: x.name, path: path.join(UPLOAD_DIR, x.f.disk_name) }));
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="zakaz-${o.id}.zip"`, 'Cache-Control': 'no-store' });
  writeZip(res, entries);
});

route('GET', /^\/api\/admin\/stats$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  const n = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").get().n;
  const last = db.prepare('SELECT MAX(id) AS id FROM orders').get().id || 0;
  send(res, 200, { newOrders: n, lastId: last });
});

// --- админка: услуги (конструктор страниц)
route('GET', /^\/api\/admin\/services$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  send(res, 200, db.prepare('SELECT * FROM services ORDER BY sort, id').all().map((r) => publicService(r, false)));
});
route('GET', /^\/api\/admin\/services\/(\d+)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  const r = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(m[1]));
  if (!r) throw new HttpError(404, 'Услуга не найдена');
  send(res, 200, publicService(r, true));
});

function saveService(b, id) {
  const title = str(b.title, 150);
  if (!title) throw new HttpError(400, 'Укажите название услуги');
  let slug = slugify(b.slug || title);
  const clash = db.prepare('SELECT id FROM services WHERE slug = ?').get(slug);
  if (clash && clash.id !== id) slug = slug + '-' + crypto.randomBytes(2).toString('hex');
  const action = ['none', 'print', 'tshirt', 'mug', 'request'].includes(b.action) ? b.action : 'none';
  const vals = [slug, title, str(b.summary, 400), str(b.priceFrom, 60), str(b.cover, 300), JSON.stringify(cleanBlocks(b.blocks)), action, b.published ? 1 : 0, Math.round(num(b.sort, -1e6, 1e6)), str(b.seoTitle, 120), str(b.seoDescription, 300)];
  if (id) {
    db.prepare(
      "UPDATE services SET slug=?, title=?, summary=?, price_from=?, cover=?, blocks=?, action=?, published=?, sort=?, seo_title=?, seo_description=?, updated_at=datetime('now') WHERE id=?"
    ).run(...vals, id);
    return id;
  }
  return Number(
    db.prepare('INSERT INTO services (slug, title, summary, price_from, cover, blocks, action, published, sort, seo_title, seo_description) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...vals)
      .lastInsertRowid
  );
}
route('POST', /^\/api\/admin\/services$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  const id = saveService(await readJSON(req), 0);
  send(res, 200, publicService(db.prepare('SELECT * FROM services WHERE id = ?').get(id), true));
});
route('PUT', /^\/api\/admin\/services\/(\d+)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  const id = Number(m[1]);
  if (!db.prepare('SELECT 1 FROM services WHERE id = ?').get(id)) throw new HttpError(404, 'Услуга не найдена');
  saveService(await readJSON(req), id);
  send(res, 200, publicService(db.prepare('SELECT * FROM services WHERE id = ?').get(id), true));
});
route('DELETE', /^\/api\/admin\/services\/(\d+)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  db.prepare('DELETE FROM services WHERE id = ?').run(Number(m[1]));
  send(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/services\/order$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  const b = await readJSON(req);
  const upd = db.prepare('UPDATE services SET sort = ? WHERE id = ?');
  (Array.isArray(b.ids) ? b.ids : []).forEach((id, i) => upd.run(i, Number(id)));
  send(res, 200, { ok: true });
});

// --- админка: шаблоны футболок
route('GET', /^\/api\/admin\/templates$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  send(res, 200, db.prepare('SELECT * FROM templates ORDER BY sort, id').all().map(publicTemplate));
});
function saveTemplate(b, id) {
  const name = str(b.name, 100);
  if (!name) throw new HttpError(400, 'Укажите название');
  const kind = ['tee', 'oversize', 'long', 'mug'].includes(b.kind) ? b.kind : 'tee';
  const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? b.color : '#F4F2EE';
  const sizes = (Array.isArray(b.sizes) ? b.sizes : []).map((s) => str(s, 10)).filter(Boolean);
  if (!sizes.length) throw new HttpError(400, 'Отметьте хотя бы один размер');
  const vals = [name, kind, color, num(b.price, 0, 1e6), JSON.stringify(sizes), b.active ? 1 : 0, Math.round(num(b.sort, -1e6, 1e6))];
  if (id) {
    db.prepare('UPDATE templates SET name=?, kind=?, color=?, price=?, sizes=?, active=?, sort=? WHERE id=?').run(...vals, id);
    return id;
  }
  return Number(
    db.prepare("INSERT INTO templates (name, kind, color, price, sizes, active, sort, image, print_area) VALUES (?,?,?,?,?,?,?, '', '{}')").run(...vals).lastInsertRowid
  );
}
route('POST', /^\/api\/admin\/templates$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  const id = saveTemplate(await readJSON(req), 0);
  send(res, 200, publicTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)));
});
route('PUT', /^\/api\/admin\/templates\/(\d+)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  const id = Number(m[1]);
  if (!db.prepare('SELECT 1 FROM templates WHERE id = ?').get(id)) throw new HttpError(404, 'Шаблон не найден');
  saveTemplate(await readJSON(req), id);
  send(res, 200, publicTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)));
});
route('DELETE', /^\/api\/admin\/templates\/(\d+)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  db.prepare('DELETE FROM templates WHERE id = ?').run(Number(m[1]));
  send(res, 200, { ok: true });
});

// --- админка: настройки
route('GET', /^\/api\/admin\/settings$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  send(res, 200, {
    salon: dbLib.getSetting(db, 'salon'),
    pricing: dbLib.getSetting(db, 'pricing'),
    verify: (({ enabled, ...v }) => v)(verifySettings()),
    fonts: { display: fontsLib.DISPLAY, body: fontsLib.BODY, defaultDisplay: fontsLib.DEFAULT_DISPLAY, defaultBody: fontsLib.DEFAULT_BODY },
  });
});
route('PUT', /^\/api\/admin\/settings\/verify$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  const b = await readJSON(req);
  const v = {
    method: ['off', 'sms', 'call', 'whatsapp', 'max'].includes(b.method) ? b.method : 'off',
    smsruApiId: str(b.smsruApiId, 100),
    greenApiUrl: str(b.greenApiUrl, 200),
    greenId: str(b.greenId, 50),
    greenToken: str(b.greenToken, 200),
  };
  if ((v.method === 'sms' || v.method === 'call') && !v.smsruApiId) throw new HttpError(400, 'Вставьте api_id из личного кабинета SMS.ru');
  if ((v.method === 'whatsapp' || v.method === 'max') && !(v.greenApiUrl && v.greenId && v.greenToken))
    throw new HttpError(400, 'Заполните apiUrl, idInstance и apiTokenInstance из кабинета GREEN-API');
  if (v.greenApiUrl && !/^https:\/\//.test(v.greenApiUrl)) throw new HttpError(400, 'apiUrl должен начинаться с https://');
  dbLib.setSetting(db, 'verify', v);
  send(res, 200, v);
});

// --- удаление заказа вместе с файлами
route('DELETE', /^\/api\/admin\/orders\/(\d+)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(m[1]));
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const ids = new Set();
  for (const it of parseJSON(o.items, [])) {
    for (const f of [it.file, it.thumb, it.preview]) f && ids.add(f);
    for (const st of it.stickers || []) st.file && ids.add(st.file);
  }
  for (const id of ids) {
    const f = db.prepare('SELECT disk_name FROM files WHERE id = ?').get(id);
    if (f) fs.rm(path.join(UPLOAD_DIR, f.disk_name), { force: true }, () => {});
    db.prepare('DELETE FROM files WHERE id = ?').run(id);
  }
  db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
  send(res, 200, { ok: true });
});

// --- администраторы: любой зарегистрированный номер можно сделать админом
route('GET', /^\/api\/admin\/admins$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  send(res, 200, db.prepare("SELECT id, name, phone FROM users WHERE role = 'admin' ORDER BY id").all());
});
route('POST', /^\/api\/admin\/admins$/, async (req, res, ctx) => {
  requireAdmin(ctx);
  const b = await readJSON(req);
  const phone = normalizePhone(b.phone);
  const u = phone && db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!u) throw new HttpError(404, 'Такой номер не зарегистрирован. Пусть человек сначала зарегистрируется на сайте');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
  send(res, 200, { ok: true, name: u.name });
});
route('DELETE', /^\/api\/admin\/admins\/(\d+)$/, async (req, res, ctx, m) => {
  const me = requireAdmin(ctx);
  const id = Number(m[1]);
  if (id === me.id) throw new HttpError(400, 'Нельзя снять права с самого себя');
  const left = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id != ?").get(id).n;
  if (!left) throw new HttpError(400, 'Должен остаться хотя бы один администратор');
  db.prepare("UPDATE users SET role = 'user' WHERE id = ? AND phone != 'admin'").run(id);
  send(res, 200, { ok: true });
});
route('PUT', /^\/api\/admin\/settings\/(salon|pricing)$/, async (req, res, ctx, m) => {
  requireAdmin(ctx);
  const clean = cleanSettings(m[1], await readJSON(req));
  dbLib.setSetting(db, m[1], clean);
  send(res, 200, clean);
});

// ---------------------------------------------------------------- SEO
function seoData() {
  const services = db.prepare('SELECT * FROM services WHERE published = 1 ORDER BY sort, id').all().map((r) => publicService(r, false));
  return {
    salon: dbLib.getSetting(db, 'salon'),
    pricing: dbLib.getSetting(db, 'pricing'),
    services,
    getService: (slug) => {
      const r = db.prepare('SELECT * FROM services WHERE slug = ? AND published = 1').get(slug);
      return r ? publicService(r, true) : null;
    },
  };
}
route('GET', /^\/sitemap\.xml$/, async (req, res) => seo.sitemap(req, res, seoData().services));
route('GET', /^\/robots\.txt$/, async (req, res) => seo.robots(req, res));

// ---------------------------------------------------------------- статика
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return false;
  if (rel === '/' || rel === '/index.html') file = '';
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  // Все остальные адреса — страницы сайта: сервер подставляет заголовок, описание и текст для поисковиков
  if (!path.extname(rel) || rel === '/index.html') {
    seo.renderPage(req, res, PUBLIC_DIR, seoData());
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- сервер
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ctx = {
    url,
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
    user: null,
  };
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');

  try {
    // Защита от подделки запросов с чужих сайтов
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
      // За nginx адрес сайта может прийти в разных заголовках — сверяем с любым из них
      const hosts = [req.headers['x-forwarded-host'], req.headers.host, process.env.SITE_HOST]
        .filter(Boolean)
        .flatMap((h) => String(h).split(',').map((x) => x.trim()));
      let originHost = '';
      try {
        originHost = new URL(req.headers.origin).host;
      } catch {}
      if (!hosts.includes(originHost)) throw new HttpError(403, 'Запрос с чужого сайта');
    }
    ctx.user = getUser(req);

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.pattern);
      if (m) {
        await r.handler(req, res, ctx, m);
        return;
      }
    }
    if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Не найдено');
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url.pathname)) return;
    throw new HttpError(404, 'Не найдено');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (res.headersSent) return res.end();
    send(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Что-то пошло не так на сервере' });
  }
});

server.requestTimeout = 15 * 60 * 1000; // большие фото по мобильному интернету грузятся долго
server.listen(PORT, () => {
  cleanupFiles();
  console.log(`Объектив запущен: http://localhost:${PORT}`);
});
