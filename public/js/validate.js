/*
 * Проверка данных: телефон, имя, пароль, комментарий.
 * Один и тот же код работает в браузере (подсказки сразу при вводе)
 * и на сервере (чтобы проверку нельзя было обойти).
 */
(function (root) {
  'use strict';

  const ok = (value) => ({ ok: true, value });
  const bad = (error) => ({ ok: false, error });

  // ---------- телефон
  function phoneDigits(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
    if (d.length === 10 && d[0] === '9') d = '7' + d;
    return d;
  }
  function checkPhone(raw) {
    const d = phoneDigits(raw);
    if (!d) return bad('Укажите номер телефона');
    if (d.length < 11) return bad('В номере не хватает цифр');
    if (d.length > 11 || d[0] !== '7') return bad('Нужен российский номер: +7 и 10 цифр');
    if (d[1] !== '9') return bad('Укажите мобильный номер: он начинается на +7 9');
    const body = d.slice(1);
    const tail = d.slice(4);
    if (/(\d)\1{6}/.test(body)) return bad('Похоже, номер набран не полностью или с ошибкой');
    if (['1234567', '7654321', '0123456', '6543210'].includes(tail) || ['9123456789', '9876543210', '9012345678'].includes(body))
      return bad('Проверьте номер: похоже на случайный набор цифр');
    return ok('+' + d);
  }
  /** +7 (9XX) XXX-XX-XX — для поля ввода */
  function formatPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d[0] === '8') d = '7' + d.slice(1);
    if (d[0] === '9') d = '7' + d;
    // Начали набирать с 8 или +7 после уже подставленного «+7 (» — лишнюю цифру убираем
    if (d[0] === '7' && (d[1] === '8' || d[1] === '7')) d = '7' + d.slice(2);
    d = d.slice(0, 11);
    const p = d.slice(1);
    let out = '+7';
    if (p.length) out += ' (' + p.slice(0, 3);
    if (p.length >= 3) out += ')';
    if (p.length > 3) out += ' ' + p.slice(3, 6);
    if (p.length > 6) out += '-' + p.slice(6, 8);
    if (p.length > 8) out += '-' + p.slice(8, 10);
    return out;
  }

  // ---------- имя
  const SWEAR = /(х[уy][йеёяию]|п[иi]зд|[её]б[ауеиоы]|бля|сук[аи]|муд[аио]к|жоп|гандон|шлюх|пид[оа]р|fuck|shit|bitch|dick)/i;
  const JUNK = /^(asdf|qwer|йцук|фыва|test|тест|admin|админ|aaa|ааа|xxx|ххх|nan|null|undefined|anon|аноним|имя|name|no ?name|user|юзер|котик|кто|я|xyz)$/i;
  function checkName(raw) {
    const v = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!v) return bad('Напишите, как к вам обращаться');
    if (v.length > 40) return bad('Слишком длинное имя');
    if (/\d/.test(v)) return bad('В имени не должно быть цифр');
    if (/https?:|www\.|@|\.(ru|com|рф)\b/i.test(v)) return bad('Ссылки и почта в имени не нужны');
    if (!/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё' -]*[A-Za-zА-Яа-яЁё]$/.test(v)) return bad('Используйте только буквы, пробел и дефис');
    const letters = v.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
    if (letters.length < 2) return bad('Имя слишком короткое');
    for (const w of v.split(/[ -]/)) {
      if (/[A-Za-z]/.test(w) && /[А-Яа-яЁё]/.test(w)) return bad('Не смешивайте русские и латинские буквы');
    }
    if (/(.)\1{2,}/i.test(letters)) return bad('Проверьте имя: много одинаковых букв подряд');
    if (/^[^аеёиоуыэюяaeiouy]+$/i.test(letters) && letters.length > 3) return bad('Проверьте имя: похоже на случайный набор букв');
    if (JUNK.test(v)) return bad('Напишите настоящее имя, чтобы мы знали, как к вам обращаться');
    if (SWEAR.test(v)) return bad('Давайте без грубых слов');
    // Каждое слово с заглавной: «анна-мария» → «Анна-Мария»
    const pretty = v.toLowerCase().replace(/(^|[ -])([a-zа-яё])/g, (m, s, c) => s + c.toUpperCase());
    return ok(pretty);
  }

  // ---------- пароль
  const SIMPLE = ['123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000', '123123', '654321', 'qwerty', 'qwerty123', 'йцукен', 'password', 'пароль', 'abc123', 'qwertyuiop', '1q2w3e', '1q2w3e4r', 'zxcvbn'];
  function checkPassword(raw) {
    const v = String(raw || '');
    if (v.length < 6) return bad('Пароль: минимум 6 символов');
    if (v.length > 100) return bad('Слишком длинный пароль');
    if (/^(.)\1+$/.test(v) || SIMPLE.includes(v.toLowerCase())) return bad('Слишком простой пароль, придумайте другой');
    return ok(v);
  }

  // ---------- комментарий
  function checkComment(raw) {
    const v = String(raw || '').trim();
    if (v.length > 1000) return bad('Комментарий слишком длинный, до 1000 символов');
    if (/https?:\/\/|www\./i.test(v)) return bad('Ссылки в комментарии нельзя');
    return ok(v);
  }

  const api = { checkPhone, formatPhone, phoneDigits, checkName, checkPassword, checkComment };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Validate = api;
})(typeof window !== 'undefined' ? window : globalThis);
