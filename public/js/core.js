// Общие помощники для сайта и админки
export const state = { site: null, user: null };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || 'Ошибка ' + res.status);
    e.status = res.status;
    throw e;
  }
  return data;
}

/** Загрузка файла с прогрессом. Возвращает { id, url } */
export function upload(blob, { name = 'photo', isPublic = false, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload' + (isPublic ? '?public=1' : ''));
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Не удалось загрузить файл'));
    };
    xhr.onerror = () => reject(new Error('Загрузка прервалась. Проверьте интернет'));
    xhr.send(blob);
  });
}

export function money(n) {
  const cur = (state.site && state.site.pricing && state.site.pricing.currency) || '₽';
  const v = Number(n) || 0;
  const s = v.toLocaleString('ru-RU', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${s}\u00A0${cur}`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

export function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '7') return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  return p || '';
}

let toastTimer;
export function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/** Окно: снизу на телефоне, по центру на компьютере */
export function openSheet(html, { label = 'Окно', onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="sheet-grip"></div>${html}</div>`;
  root.appendChild(bg);
  const prevFocus = document.activeElement;
  document.body.style.overflow = 'hidden';
  const sheet = bg.firstElementChild;
  const close = () => {
    bg.remove();
    if (!root.children.length) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    prevFocus && prevFocus.focus && prevFocus.focus();
    onClose && onClose();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', (e) => {
    if (e.target === bg || e.target.closest('[data-close]')) close();
  });
  setTimeout(() => {
    const f = sheet.querySelector('input, select, textarea, button:not([data-close])');
    f && f.focus({ preventScroll: true });
  }, 50);
  return { el: sheet, close };
}

export function lightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${esc(src)}" alt=""><button class="icon-btn" aria-label="Закрыть">${icon.close}</button>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

/** Мини-разметка для текстовых блоков: **жирный**, [ссылка](https://...), списки «- », пустая строка = абзац */
export function md(text) {
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|tel:|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return String(text || '')
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split('\n');
      if (lines.every((l) => /^\s*[-•]\s+/.test(l)))
        return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('') + '</ul>';
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

/** Делает уменьшенную копию фото (для превью). Возвращает { blob, url, w, h } или null */
export function makeThumb(file, max = 480) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const k = Math.min(1, max / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => resolve(blob ? { blob, url: URL.createObjectURL(blob), w, h } : null), 'image/jpeg', 0.82);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// ---------------- иконки
const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icon = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  phone: svg('<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
  upload: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="14" width="44" height="36" rx="6" fill="#BC9BF3"/><rect x="14" y="8" width="44" height="36" rx="6" fill="#7360F9"/><circle cx="28" cy="20" r="4" fill="#B9D440"/><path d="M18 38l10-10 7 7 5-5 12 12v2H18z" fill="#FFF1EB"/></svg>`,
};

// ---------------- геометрические плитки (украшения в стиле референса)
const C = { cream: '#FFF1EB', lime: '#B9D440', lav: '#BC9BF3', violet: '#7360F9', ink: '#231A5A' };
const shapes = {
  burst(fg) {
    const pts = [];
    for (let i = 0; i < 32; i++) {
      const r = i % 2 ? 22 : 42;
      const a = (Math.PI * i) / 16;
      pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${fg}"/>`;
  },
  drop: (fg) => `<path d="M50 12C50 12 80 46 80 63a30 30 0 0 1-60 0C20 46 50 12 50 12z" fill="${fg}"/>`,
  halves: (fg, fg2) => `<path d="M10 52a40 40 0 0 1 80 0z" fill="${fg}"/><path d="M26 56h48a24 24 0 0 1-48 0z" fill="${fg2}"/>`,
  dots(fg) {
    let s = '';
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * i) / 4;
      s += `<circle cx="${(50 + 30 * Math.cos(a)).toFixed(1)}" cy="${(50 + 30 * Math.sin(a)).toFixed(1)}" r="7" fill="${fg}"/>`;
    }
    return s;
  },
  star4: (fg) => `<path d="M50 6Q56 44 94 50Q56 56 50 94Q44 56 6 50Q44 44 50 6z" fill="${fg}"/>`,
  flower(fg, fg2) {
    let s = '';
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * i) / 5;
      s += `<circle cx="${(50 + 30 * Math.cos(a)).toFixed(1)}" cy="${(50 + 30 * Math.sin(a)).toFixed(1)}" r="13" fill="${fg}"/>`;
    }
    return s + `<circle cx="50" cy="50" r="31" fill="${fg}"/><circle cx="50" cy="50" r="24" fill="${fg2}"/>`;
  },
  stripes(fg) {
    let s = '';
    for (let y = 10; y < 96; y += 14) s += `<rect x="0" y="${y}" width="100" height="6" fill="${fg}"/>`;
    return s;
  },
  pinwheel: (fg) =>
    `<path d="M50 50V18a32 32 0 0 1 32 32z" fill="${fg}"/><path d="M50 50h32a32 32 0 0 1-32 32z" fill="${fg}" opacity=".55"/><path d="M50 50v32a32 32 0 0 1-32-32z" fill="${fg}"/><path d="M50 50H18a32 32 0 0 1 32-32z" fill="${fg}" opacity=".55"/>`,
  rays: (fg) => `<g stroke="${fg}" stroke-width="5" stroke-linecap="round"><path d="M50 12v76M12 50h76M23 23l54 54M77 23L23 77"/></g>`,
  ring: (fg, fg2) => `<ellipse cx="50" cy="40" rx="36" ry="20" fill="none" stroke="${fg}" stroke-width="9"/><path d="M14 58a36 22 0 0 0 72 0z" fill="${fg2}"/>`,
};
export function tile(kind, bg, fg, fg2) {
  const f = shapes[kind] || shapes.burst;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="100" height="100" fill="${C[bg] || bg}"/>${f(C[fg] || fg, C[fg2] || fg2 || C[fg] || fg)}</svg>`;
}
const TILE_SET = [
  ['burst', 'lav', 'cream'],
  ['halves', 'lime', 'violet', 'cream'],
  ['dots', 'violet', 'lime'],
  ['drop', 'cream', 'violet'],
  ['star4', 'lime', 'ink'],
  ['flower', 'lav', 'violet', 'cream'],
  ['stripes', 'cream', 'lav'],
  ['pinwheel', 'violet', 'lime'],
  ['ring', 'lav', 'ink', 'lime'],
  ['rays', 'lime', 'violet'],
];
/** Плитка по номеру — чтобы у каждой услуги без фото была своя картинка */
export function tileByIndex(i) {
  const t = TILE_SET[Math.abs(i) % TILE_SET.length];
  return tile(...t);
}

export const STATUS = {
  new: 'Новый',
  work: 'В работе',
  ready: 'Готов, можно забирать',
  done: 'Выдан',
  cancelled: 'Отменён',
};
