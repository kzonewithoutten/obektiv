// Сделать зарегистрированный номер администратором: node deploy/make-admin.js 89001234567
const path = require('path');
const { open } = require('../lib/db');
const raw = process.argv.slice(2).join('');
let d = String(raw).replace(/\D/g, '');
if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
if (d.length === 10) d = '7' + d;
if (d.length !== 11) {
  console.log('Укажите номер телефона, например: 89001234567');
  process.exit(1);
}
const db = open(path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')));
const u = db.prepare('SELECT id, name FROM users WHERE phone = ?').get('+' + d);
if (!u) {
  console.log(`Номер +${d} не найден. Сначала зарегистрируйтесь на сайте с этим номером, потом повторите команду.`);
  process.exit(1);
}
db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
console.log(`Готово: ${u.name} (+${d}) теперь администратор. Обновите страницу сайта — появится пункт «Админка».`);
