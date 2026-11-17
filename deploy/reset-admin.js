// Сброс пароля администратора: node deploy/reset-admin.js НовыйПароль
const crypto = require('crypto');
const path = require('path');
const pw = process.argv[2];
if (!pw || pw.length < 6) {
  console.log('Укажите новый пароль (минимум 6 символов): node deploy/reset-admin.js НовыйПароль');
  process.exit(1);
}
const { open } = require('../lib/db');
const db = open(path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')));
const salt = crypto.randomBytes(16);
const hash = `${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const r = db.prepare("UPDATE users SET password_hash = ? WHERE phone = 'admin'").run(hash);
console.log(r.changes ? 'Пароль администратора изменён. Логин: admin' : 'Администратор не найден');
