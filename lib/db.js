// База данных: встроенный в Node.js SQLite (node:sqlite), отдельно ставить ничего не нужно.
const path = require('path');
const fs = require('fs');

// Убираем предупреждение «SQLite is an experimental feature» из консоли
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  const msg = typeof w === 'string' ? w : (w && w.message) || '';
  if (msg.includes('SQLite')) return;
  return origEmit.call(process, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'obektiv.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      owner_id INTEGER,
      original_name TEXT,
      mime TEXT,
      size INTEGER,
      disk_name TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      price_from TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      blocks TEXT NOT NULL DEFAULT '[]',
      action TEXT NOT NULL DEFAULT 'none',
      published INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      image TEXT NOT NULL,
      print_area TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      sizes TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL,
      prints INTEGER NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      admin_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  migrate(db);
  seed(db);
  return db;
}

// ---------- Значения по умолчанию ----------
// Все цифры ниже — ПРИМЕРЫ. Настоящие цены, адрес и т.д. вписываются в админке → «Настройки».
const DEFAULT_SETTINGS = {
  salon: {
    name: 'Объектив',
    tagline: 'Фотосалон',
    heroTitle: 'Печатаем ваши фото так, чтобы хотелось повесить на стену',
    heroText: 'Загрузите снимки с телефона, выберите формат и бумагу — заберёте готовые отпечатки в салоне. Оплата при получении.',
    phone: '',
    address: '',
    hours: '',
    mapUrl: '',
    email: '',
    vk: '',
    telegram: '',
    whatsapp: '',
    max: '',
    teeCover: '',
    heroPhotos: [],
    city: '',
    seoDescription: '',
    ogImage: '',
    yandexVerification: '',
    googleVerification: '',
    configured: false,
  },
  pricing: {
    currency: '₽',
    configured: false,
    print: {
      // priceBw / priceColor — обычная бумага, priceGlossy / priceMatte — фотобумага; 0 = такого варианта нет
      formats: [
        // А5 и А6 на обычной бумаге печатаются на листе А4 — цена как у А4
        { id: 'a6', name: 'А6 (10×15)', wcm: 10.5, hcm: 14.8, priceBw: 15, priceColor: 25, priceGlossy: 25, priceMatte: 25, price: 15 },
        { id: 'a5', name: 'А5', wcm: 14.8, hcm: 21, priceBw: 15, priceColor: 25, priceGlossy: 50, priceMatte: 50, price: 15 },
        { id: 'a4', name: 'А4', wcm: 21, hcm: 29.7, priceBw: 15, priceColor: 25, priceGlossy: 100, priceMatte: 100, price: 15 },
        { id: 'a3', name: 'А3', wcm: 29.7, hcm: 42, priceBw: 150, priceColor: 250, priceGlossy: 350, priceMatte: 0, price: 150 },
      ],
      papers: [
        { id: 'plain', name: 'Обычная', extra: 0 },
        { id: 'glossy', name: 'Глянцевая', extra: 0 },
        { id: 'matte', name: 'Матовая', extra: 0 },
      ],
      discountEvery: 6,
      discountPercent: 10,
    },
    tshirt: {
      stickerExtra: 0,
      sizes: [
        { name: 'XS', extra: 0 },
        { name: 'S', extra: 0 },
        { name: 'M', extra: 0 },
        { name: 'L', extra: 0 },
        { name: 'XL', extra: 0 },
        { name: 'XXL', extra: 100 },
        { name: '3XL', extra: 150 },
      ],
    },
  },
};

// Добавляем новые колонки в уже существующую базу (на сервере обновление не теряет данные)
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  const add = (table, col, def) => {
    if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  add('services', 'seo_title', "TEXT NOT NULL DEFAULT ''");
  add('services', 'seo_description', "TEXT NOT NULL DEFAULT ''");
  if (!has('templates', 'color')) {
    add('templates', 'color', "TEXT NOT NULL DEFAULT '#F4F2EE'");
    add('templates', 'kind', "TEXT NOT NULL DEFAULT 'tee'");
    db.prepare("UPDATE templates SET color = '#24222A' WHERE image LIKE '%tshirt-black%'").run();
    db.prepare("UPDATE templates SET color = '#BC9BF3' WHERE image LIKE '%tshirt-lavender%'").run();
  }
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const def = DEFAULT_SETTINGS[key];
  if (!row) return structuredClone(def);
  try {
    const val = JSON.parse(row.value);
    // Подмешиваем новые поля по умолчанию, если их нет в сохранённых
    return def && typeof def === 'object' && !Array.isArray(def) ? { ...structuredClone(def), ...val } : val;
  } catch {
    return structuredClone(def);
  }
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value)
  );
}

function seed(db) {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
    if (!exists) setSetting(db, key, DEFAULT_SETTINGS[key]);
  }

  const svcCount = db.prepare('SELECT COUNT(*) AS n FROM services').get().n;
  if (svcCount === 0) {
    const blocks = [
      {
        type: 'text',
        text:
          'Печатаем на профессиональном оборудовании на фотобумаге. Можно загрузить фото прямо с телефона — даже если их много.\n\n' +
          '- выберите формат и бумагу для каждого снимка\n- укажите, сколько копий нужно\n- заберите заказ в салоне и оплатите на месте',
      },
      { type: 'print_prices', title: 'Цены на печать' },
      {
        type: 'callout',
        title: 'Каждый 6-й отпечаток со скидкой 10%',
        text: 'Считаем все ваши заказы в личном кабинете — скидка копится сама.',
      },
      {
        type: 'faq',
        items: [
          { q: 'Как оплатить?', a: 'Оплата при получении в салоне — наличными или картой.' },
          { q: 'Чем отличается матовая бумага от глянцевой?', a: 'Глянец даёт яркие насыщенные цвета, матовая не бликует и не собирает отпечатки пальцев.' },
          { q: 'Фото обрежут?', a: 'Если пропорции снимка отличаются от формата, мы аккуратно подгоним кадр. Хотите иначе — напишите в комментарии к заказу.' },
        ],
      },
    ];
    db.prepare(
      `INSERT INTO services (slug, title, summary, price_from, blocks, action, published, sort)
       VALUES (?, ?, ?, ?, ?, 'print', 1, 0)`
    ).run('pechat-foto', 'Печать фотографий', 'Любые форматы от 10×15 до 30×40, глянцевая, матовая или обычная бумага', 'от 25 ₽', JSON.stringify(blocks));
  }

  const tplCount = db.prepare('SELECT COUNT(*) AS n FROM templates').get().n;
  if (tplCount === 0) {
    const sizes = JSON.stringify(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    const ins = db.prepare("INSERT INTO templates (name, image, print_area, price, sizes, sort, kind, color) VALUES (?, '', '{}', ?, ?, ?, ?, ?)");
    ins.run('Белая футболка', 990, sizes, 0, 'tee', '#F4F2EE');
    ins.run('Чёрная футболка', 1090, sizes, 1, 'tee', '#24222A');
    ins.run('Лавандовый оверсайз', 1290, sizes, 2, 'oversize', '#BC9BF3');
    ins.run('Белый лонгслив', 1290, sizes, 3, 'long', '#F4F2EE');
  }
}

module.exports = { open, getSetting, setSetting, DEFAULT_SETTINGS };
