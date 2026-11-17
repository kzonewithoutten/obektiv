import {
  state, $, $$, esc, api, upload, money, plural, fmtDate, fmtPhone, toast, openSheet, lightbox, md, makeThumb,
  icon, tile, tileByIndex, STATUS,
} from './core.js';

const app = document.getElementById('app');
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const arrowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';

// ================================================================ роутер
const routes = [
  [/^\/$/, viewHome],
  [/^\/service\/([a-z0-9-]+)$/, viewService],
  [/^\/print$/, viewPrint],
  [/^\/tshirt$/, viewTshirt],
  [/^\/account$/, viewAccount],
  [/^\/admin(\/.*)?$/, viewAdmin],
];

export function go(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  if (document.startViewTransition && !reduced) document.startViewTransition(() => render());
  else render();
}

async function render() {
  cleanups.forEach((f) => {
    try {
      f();
    } catch {}
  });
  cleanups = [];
  document.body.classList.remove('has-bar');
  const { pathname, hash } = location;
  const match = routes.find(([re]) => re.test(pathname));
  renderHeader();
  setMeta();
  if (!match) {
    app.innerHTML = notFoundHtml();
    return;
  }
  const m = pathname.match(match[0]);
  try {
    await match[1](...m.slice(1));
  } catch (e) {
    console.error(e);
    app.innerHTML =
      e.status === 404
        ? notFoundHtml()
        : `<div class="wrap empty" style="padding:80px 20px"><strong>${esc(e.message || 'Не удалось открыть страницу')}</strong><a class="btn" href="/">На главную</a></div>`;
  }
  initReveal();
  if (hash) {
    const el = document.getElementById(hash.slice(1));
    el && el.scrollIntoView();
  } else window.scrollTo(0, 0);
}

const notFoundHtml = () =>
  `<div class="wrap success"><div class="success-badge"><span>404</span></div><h1>Такой страницы нет</h1><p>Возможно, услугу убрали или в ссылке ошибка.</p><a class="btn" href="/">На главную</a></div>`;

function setMeta(title, description) {
  const s = state.site.salon;
  document.title = title || `${s.name} — печать фото и футболки со своим принтом`;
  const m = document.querySelector('meta[name="description"]');
  if (description && m) m.setAttribute('content', description);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || a.target || a.hasAttribute('download') || href.startsWith('/api/') || href.startsWith('/files/')) return;
  e.preventDefault();
  closeDrawer();
  const [p, h] = href.split('#');
  if (p === location.pathname && h) {
    history.pushState({}, '', href);
    const el = document.getElementById(h);
    el && el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    return;
  }
  go(href);
});
window.addEventListener('popstate', render);
window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 8), { passive: true });

// Появление элементов при прокрутке
function initReveal(root = app) {
  const els = $$('.reveal:not(.in)', root);
  if (!('IntersectionObserver' in window) || reduced) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      }),
    { rootMargin: '0px 0px -8% 0px', threshold: 0.1 }
  );
  els.forEach((el) => io.observe(el));
  onLeave(() => io.disconnect());
}

const mega = (a, b, cls = '') => `<h2 class="mega reveal ${cls}"><span>${esc(a)}</span><span>${esc(b)}</span></h2>`;

/** SVG-строку → картинка (для наклеек-примеров) */
function svgImage(svg) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg width="600" height="600" '));
  return img;
}

// ================================================================ шапка и подвал
function renderHeader() {
  const s = state.site.salon;
  const isAdmin = state.user && state.user.role === 'admin';
  const links = [
    ['/#services', 'Услуги'],
    ['/print', 'Печать фото'],
    ['/tshirt', 'Футболки'],
    ['/#contacts', 'Контакты'],
  ];
  if (isAdmin) links.push(['/admin', 'Админка']);
  const cur = location.pathname;
  $('#topbar').innerHTML = `
    <div class="wrap topbar-in">
      <a class="logo" href="/" aria-label="${esc(s.name)}, на главную"><img class="logo-img" src="/img/logo.svg?v=3" alt="${esc(s.name)}"></a>
      <nav class="nav" aria-label="Основное меню">${links
        .map(([h, t]) => `<a href="${h}" class="${h === cur || (h === '/admin' && cur.startsWith('/admin')) ? 'active' : ''}">${t}</a>`)
        .join('')}</nav>
      <div class="top-actions">
        <a class="icon-btn" href="/account" aria-label="${state.user ? 'Личный кабинет' : 'Войти'}">${icon.user}</a>
        <a class="btn btn-sm top-cta" href="/print">Заказать печать</a>
        <button class="icon-btn burger" aria-label="Меню" aria-expanded="false">${icon.menu}</button>
      </div>
    </div>`;
  $('#drawer-root').innerHTML = `
    <div class="drawer" aria-hidden="true">
      <div class="drawer-head"><span class="logo"><img class="logo-img" src="/img/logo-word-lime.svg?v=3" alt=""></span><button class="icon-btn" data-close-drawer aria-label="Закрыть меню">${icon.close}</button></div>
      <nav aria-label="Меню">${links.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}<a href="/account">${state.user ? 'Кабинет' : 'Войти'}</a></nav>
      <a class="btn btn-lime btn-block" href="/print">Заказать печать</a>
    </div>`;
  $('.burger').onclick = () => {
    const d = $('.drawer');
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    $('.burger').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    d.querySelector('[data-close-drawer]').focus();
  };
  $('[data-close-drawer]').onclick = closeDrawer;
}
function closeDrawer() {
  const d = $('.drawer');
  if (!d || !d.classList.contains('open')) return;
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  $('.burger') && $('.burger').setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

function renderFooter() {
  const s = state.site.salon;
  const tel = s.phone ? s.phone.replace(/[^\d+]/g, '') : '';
  $('#footer').innerHTML = `
    <div class="wrap footer-grid">
      <div style="display:grid;gap:10px">
        ${s.address ? `<b style="font:700 20px/1.3 var(--display)">${esc(s.address)}</b>` : ''}
        ${s.hours ? `<small>${esc(s.hours)}</small>` : ''}
        ${s.phone ? `<a href="tel:${esc(tel)}" style="font:800 22px/1 var(--display);text-decoration:none">${esc(s.phone)}</a>` : ''}
        ${!s.address && !s.phone ? '<small>Адрес и телефон появятся здесь</small>' : ''}
      </div>
      <nav class="footer-links" aria-label="Ссылки">
        <a href="/print">Печать фото</a><a href="/tshirt">Футболки</a><a href="/#services">Услуги</a><a href="/#contacts">Контакты</a>
        ${s.max ? `<a href="${esc(/^https?:/.test(s.max) ? s.max : 'https://max.ru/' + s.max.replace('@', ''))}" target="_blank" rel="noopener">MAX</a>` : ''}
        ${s.telegram ? `<a href="${esc(/^https?:/.test(s.telegram) ? s.telegram : 'https://t.me/' + s.telegram.replace('@', ''))}" target="_blank" rel="noopener">Telegram</a>` : ''}
      </nav>
    </div>
    <img class="footer-logo" src="/img/logo-word-lime.svg?v=3" alt="" aria-hidden="true">`;
}

// ================================================================ главная
function viewHome() {
  const s = state.site.salon;
  const pr = state.site.pricing.print;
  const services = state.site.services;
  const formats = pr.formats || [];
  const papers = pr.papers || [];
  const minPrice = formats.length ? Math.min(...formats.map((f) => f.price)) : 0;
  setMeta();

  const photo = (i, cap) => {
    const src = s.heroPhotos && s.heroPhotos[i];
    return `<figure class="polaroid p${i + 1}"><div class="ph">${
      src ? `<img src="${esc(src)}" alt="">` : i === 0 ? tile('flower', 'lav', 'violet', 'cream') : tile('burst', 'violet', 'lime')
    }</div><figcaption>${esc(cap)}</figcaption></figure>`;
  };
  const tiles = [
    ['stripes', 'cream', 'lav'], ['halves', 'lime', 'violet', 'cream'], ['dots', 'lav', 'cream'],
    ['star4', 'violet', 'lime'], ['drop', 'cream', 'violet'], ['pinwheel', 'lime', 'violet'],
    ['ring', 'lav', 'ink', 'lime'], ['rays', 'cream', 'lav'], ['burst', 'violet', 'lav'],
  ];
  const capFor = (f, fallback) => {
    const pp = f && P.papersFor(f);
    return pp && pp.length ? `${f.name}, ${pp[pp.length - 1].name.toLowerCase()}` : fallback;
  };
  const cap1 = capFor(formats[0], '10×15');
  const cap2 = capFor(formats[1], 'А4');
  const tickerItems = ['Печать фото с телефона', 'Матовая и глянцевая бумага', 'Футболки со своим принтом', 'Оплата при получении'];
  const tickerHtml = tickerItems.map((t) => `<span>${esc(t)}${tile('star4', 'transparent', 'ink')}</span>`).join('').repeat(2);

  const frames = ['var(--lav)', 'var(--lime)', 'var(--violet)'];
  const svcCards = services
    .map((sv, i) => {
      const isPrint = sv.action === 'print';
      return `<article class="svc reveal" style="--d:${(i % 3) * 0.08}s">
        <a href="/service/${esc(sv.slug)}" class="blob" style="--frame:${frames[i % 3]}" aria-label="${esc(sv.title)}">
          ${isPrint ? '<span class="svc-tag">онлайн</span>' : ''}
          <span class="blob-in">${sv.cover ? `<img src="${esc(sv.cover)}" alt="" loading="lazy">` : tileByIndex(i + 2)}</span>
        </a>
        <h3>${esc(sv.title)}</h3>
        ${sv.priceFrom ? `<div class="svc-price">${esc(sv.priceFrom)}</div>` : ''}
        <div class="svc-actions">
          ${isPrint ? '<a class="btn btn-sm" href="/print">Заказать печать</a>' : ''}
          ${sv.action === 'tshirt' ? '<a class="btn btn-sm" href="/tshirt">Собрать футболку</a>' : ''}
          ${sv.action === 'request' ? `<a class="btn btn-sm" href="/service/${esc(sv.slug)}">Оставить заявку</a>` : `<a class="btn btn-sm btn-ghost" href="/service/${esc(sv.slug)}">Подробнее</a>`}
        </div>
      </article>`;
    })
    .join('');
  const teeCard = services.some((x) => x.action === 'tshirt')
    ? ''
    : `<article class="svc reveal" style="--d:${(services.length % 3) * 0.08}s">
        <a href="/tshirt" class="blob" style="--frame:${frames[services.length % 3]}" aria-label="Футболка со своим принтом">
          <span class="svc-tag">3D</span><span class="blob-in">${s.teeCover ? `<img src="${esc(s.teeCover)}" alt="" loading="lazy">` : tile('flower', 'ink', 'lime', 'violet')}</span>
        </a>
        <h3>Футболка со своим принтом</h3>
        <div class="svc-actions"><a class="btn btn-sm" href="/tshirt">Собрать футболку</a></div>
      </article>`;

  const every = pr.discountEvery || 0;
  const n = Math.min(every, 8);
  const dots = every
    ? Array.from({ length: n }, (_, i) => (i === n - 1 ? `<i class="gift" style="--i:${i}">−${pr.discountPercent}%</i>` : `<i class="${i < 3 ? 'on' : ''}" style="--i:${i}">${i + 1}</i>`)).join('')
    : '';

  const tel = s.phone ? s.phone.replace(/[^\d+]/g, '') : '';
  const contactCards = [
    s.address &&
      (s.mapUrl
        ? `<a class="contact-card reveal" href="${esc(s.mapUrl)}" target="_blank" rel="noopener"><b>Адрес, открыть на карте</b><span>${esc(s.address)}</span></a>`
        : `<div class="contact-card reveal"><b>Адрес</b><span>${esc(s.address)}</span></div>`),
    s.phone && `<a class="contact-card reveal" href="tel:${esc(tel)}" style="--d:.06s"><b>Телефон</b><span>${esc(s.phone)}</span></a>`,
    s.hours && `<div class="contact-card reveal" style="--d:.12s"><b>Часы работы</b><span>${esc(s.hours)}</span></div>`,
    s.telegram && `<a class="contact-card reveal" href="${esc(/^https?:/.test(s.telegram) ? s.telegram : 'https://t.me/' + s.telegram.replace('@', ''))}" target="_blank" rel="noopener"><b>Telegram</b><span>${esc(s.telegram)}</span></a>`,
    s.max && `<a class="contact-card reveal" href="${esc(/^https?:/.test(s.max) ? s.max : 'https://max.ru/' + s.max.replace('@', ''))}" target="_blank" rel="noopener"><b>MAX</b><span>Написать в MAX</span></a>`,
    s.whatsapp && `<a class="contact-card reveal" href="${esc(/^https?:/.test(s.whatsapp) ? s.whatsapp : 'https://wa.me/' + s.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener"><b>WhatsApp</b><span>Написать в WhatsApp</span></a>`,
    s.vk && `<a class="contact-card reveal" href="${esc(s.vk)}" target="_blank" rel="noopener"><b>ВКонтакте</b><span>Наша группа</span></a>`,
    s.email && `<a class="contact-card reveal" href="mailto:${esc(s.email)}"><b>Почта</b><span>${esc(s.email)}</span></a>`,
  ].filter(Boolean);

  app.innerHTML = `
    <section class="hero">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <h1>${esc(s.heroTitle)}</h1>
          <p>${esc(s.heroText)}</p>
          <div class="hero-cta">
            <a class="btn" href="/print">Заказать печать</a>
            <span class="hero-note"><i></i>${minPrice ? `от ${money(minPrice)} за фото` : 'Оплата при получении'}</span>
          </div>
        </div>
        <div class="mosaic" aria-hidden="true">
          <div class="tiles">${tiles.map((t) => `<div>${tile(...t)}</div>`).join('')}</div>
          ${photo(0, cap1)}${photo(1, cap2)}
          ${every ? `<div class="mosaic-badge"><div>−${pr.discountPercent}%<small>каждый ${every}-й<br>отпечаток</small></div></div>` : ''}
        </div>
      </div>
    </section>

    <div class="ticker-wrap" aria-hidden="true"><div class="ticker"><div class="ticker-track">${tickerHtml}</div></div></div>

    <section class="section" id="services">
      <div class="wrap">
        ${mega('Что мы', 'делаем')}
        <div class="svc-grid">${svcCards}${teeCard}</div>
      </div>
    </section>

    <section class="section section-tight">
      <div class="wrap">
        ${mega('Печать', 'в три шага', 'left')}
        <div class="bento">
          <a class="b-cta reveal" href="/print">
            <span class="arrow">${arrowIcon}</span>
            <span class="t">Загрузить<br>фото</span>
            <span>${minPrice ? `От ${money(minPrice)} за снимок. ` : ''}Оплата при получении</span>
          </a>
          <div class="b-step b-s1 reveal" style="--d:.06s"><span class="num">1</span><strong>Загрузите фото</strong><span>Прямо из галереи телефона, хоть сотню за раз.</span></div>
          <div class="b-step b-s2 reveal" style="--d:.12s"><span class="num">2</span><strong>Выберите формат и бумагу</strong><span>Цена посчитается сама, ещё до отправки.</span></div>
          <div class="b-step b-s3 reveal" style="--d:.18s"><span class="num">3</span><strong>Заберите в салоне</strong><span>Позвоним, когда всё готово.</span></div>
          ${
            every
              ? `<div class="b-big reveal"><h3>Каждый ${every}-й отпечаток на ${pr.discountPercent}% дешевле</h3>
                 <p>Скидка копится в личном кабинете по всем заказам печати. Ничего вводить не нужно.</p>
                 <div class="dots reveal" style="--n:${n}">${dots}</div></div>`
              : ''
          }
          <div class="b-formats reveal"><h3 style="color:#fff;margin-bottom:14px">Форматы</h3>
            <div class="chips">${formats.map((f) => `<span class="chip-static">${esc(f.name)}</span>`).join('')}</div>
            <p class="small" style="margin-top:14px;color:rgba(255,255,255,.75)">Бумага: ${papers.map((x) => esc(x.name.toLowerCase())).join(', ')}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section section-tight">
      <div class="wrap">
        <div class="tee-promo reveal">
          <div style="display:grid;gap:20px;position:relative">
            <h2 class="mega on-dark" style="margin:0;font-size:clamp(36px,7vw,84px)"><span>Футболка</span><span>с твоим</span><span>принтом</span></h2>
            <p class="lead">Загрузите картинки и наклейте их куда хотите: на грудь, спину или рукава. Покрутите футболку в 3D и посмотрите, как будет.</p>
            <div class="chips"><span class="chip-static">Футболки</span><span class="chip-static">Оверсайз</span><span class="chip-static">Лонгсливы</span></div>
            <div><a class="btn btn-lime" href="/tshirt">Собрать футболку</a></div>
          </div>
          <div class="tee-stage-mini" id="tee-mini"><canvas aria-label="3D-футболка"></canvas></div>
        </div>
      </div>
    </section>

    <section class="section section-tight" id="contacts">
      <div class="wrap">
        ${mega('Где', 'забрать')}
        ${contactCards.length ? `<div class="contacts">${contactCards.join('')}</div>` : '<p class="muted">Контакты салона появятся здесь, как только их заполнят в админке.</p>'}
      </div>
    </section>`;

  // Полароиды чуть следуют за курсором
  const mosaic = $('.mosaic', app);
  if (mosaic && !reduced && matchMedia('(pointer: fine)').matches) {
    const onMove = (e) => {
      mosaic.style.setProperty('--px', (e.clientX / innerWidth - 0.5).toFixed(3));
      mosaic.style.setProperty('--py', (e.clientY / innerHeight - 0.5).toFixed(3));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    onLeave(() => window.removeEventListener('pointermove', onMove));
  }
  mountMiniTee();
}

/** Крутящаяся 3D-футболка на главной (загружается, только когда до неё долистали) */
function mountMiniTee() {
  const box = $('#tee-mini');
  if (!box) return;
  let tee3 = null;
  let gone = false;
  const io = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || tee3) return;
    io.disconnect();
    try {
      const m = await import('./tee3d.js?v=7');
      if (gone || !m.webglSupported()) throw new Error('no');
      tee3 = m.createTee($('canvas', box), { color: '#F7F5F2', kind: 'tee' });
      const a = svgImage(tile('flower', 'lime', 'violet', 'lav'));
      const b = svgImage(tile('burst', 'violet', 'lime'));
      const c = svgImage(tile('dots', 'lav', 'cream'));
      [a, b, c].forEach((i) => (i.onload = () => tee3 && tee3.refresh()));
      tee3.setStickers([
        { img: a, panel: 'front', cx: 0.5, cy: 0.32, w: 0.24, rot: -6 },
        { img: b, panel: 'back', cx: 0.5, cy: 0.3, w: 0.3, rot: 8 },
        { img: c, panel: 'front', cx: 0.12, cy: 0.27, w: 0.07, rot: 10 },
        { img: c, panel: 'front', cx: 0.88, cy: 0.27, w: 0.07, rot: -10 },
      ]);
      tee3.setAuto(!reduced);
    } catch {
      if (!gone) box.innerHTML = `<img src="/img/logo-mark.svg" alt="">`;
    }
  });
  io.observe(box);
  onLeave(() => {
    gone = true;
    io.disconnect();
    tee3 && tee3.destroy();
  });
}

// ================================================================ страница услуги
async function viewService(slug) {
  app.innerHTML = loadingHtml();
  const sv = await api('/api/services/' + slug);
  setMeta(sv.seoTitle || `${sv.title} — ${state.site.salon.name}`, sv.seoDescription || sv.summary);
  const cta =
    sv.action === 'print'
      ? `<a class="btn btn-lime" href="/print">Заказать печать</a>`
      : sv.action === 'tshirt'
      ? `<a class="btn btn-lime" href="/tshirt">Собрать футболку</a>`
      : '';
  app.innerHTML = `
    <article class="wrap">
      <header class="svc-hero">
        <div class="svc-hero-card">
          <div class="deco" aria-hidden="true">${tile('flower', 'transparent', 'lime', 'violet')}</div>
          <div class="crumbs"><a href="/#services">Все услуги</a></div>
          <div style="display:grid;gap:18px;position:relative">
            <h1>${esc(sv.title)}</h1>
            ${sv.summary ? `<p>${esc(sv.summary)}</p>` : ''}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;position:relative">
            ${cta}
            ${sv.priceFrom ? `<span class="chip-static" style="background:rgba(255,255,255,.16);box-shadow:none;color:#fff">${esc(sv.priceFrom)}</span>` : ''}
          </div>
        </div>
        <div class="blob"><div class="blob-in">${sv.cover ? `<img src="${esc(sv.cover)}" alt="">` : tileByIndex(sv.id + 3)}</div></div>
      </header>
      <div class="blocks">${renderBlocks(sv.blocks)}</div>
      ${sv.action === 'request' ? requestHtml() : ''}
      ${cta ? `<div class="service-cta">${cta.replace('btn btn-lime', 'btn')}</div>` : ''}
    </article>`;
  $$('.b-gallery button', app).forEach((b) => (b.onclick = () => lightbox(b.dataset.src)));
  if (sv.action === 'request') mountRequest(sv);
}

// ================================================================ заявка на услугу
function requestHtml() {
  const s = state.site.salon;
  const u = state.user;
  const tel = s.phone ? s.phone.replace(/[^\d+]/g, '') : '';
  const link = (v, base) => (/^https?:/.test(v) ? v : base + v.replace('@', ''));
  const messengers = [
    s.whatsapp && `<a class="btn btn-soft btn-sm" href="${esc(/^https?:/.test(s.whatsapp) ? s.whatsapp : 'https://wa.me/' + s.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>`,
    s.telegram && `<a class="btn btn-soft btn-sm" href="${esc(link(s.telegram, 'https://t.me/'))}" target="_blank" rel="noopener">Telegram</a>`,
    s.max && `<a class="btn btn-soft btn-sm" href="${esc(link(s.max, 'https://max.ru/'))}" target="_blank" rel="noopener">MAX</a>`,
  ].filter(Boolean);
  return `
    <section class="req-grid reveal" id="request">
      <form class="card form req-form" novalidate>
        <h2 style="font-size:26px">Оставить заявку</h2>
        <p class="muted small" style="margin-top:-6px">Опишите задачу, мы перезвоним и всё уточним.</p>
        <label class="field"><span>Что нужно сделать</span><textarea class="textarea" name="text" rows="4" placeholder="Например: отсканировать 10 документов и отправить на почту" required></textarea></label>
        <label class="field"><span>Имя</span><input class="input" name="name" autocomplete="name" value="${esc(u && u.phone !== 'admin' ? u.name : '')}" required></label>
        <label class="field"><span>Телефон для связи</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(u && u.phone !== 'admin' ? V.formatPhone(u.phone) : '')}" required></label>
        <div class="form-error hidden"></div>
        <button class="btn btn-block">Отправить заявку</button>
      </form>
      <aside class="card req-contact">
        <h2 style="font-size:26px">Связаться напрямую</h2>
        <p class="muted small" style="margin-top:-6px">Удобнее голосом или в мессенджере? Звоните${s.hours ? `, ${esc(s.hours)}` : ''}.</p>
        ${s.phone ? `<a class="req-phone" href="tel:${esc(tel)}">${icon.phone}<span>${esc(s.phone)}</span></a>` : '<p class="muted">Телефон появится здесь, как только его заполнят в админке.</p>'}
        ${messengers.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${messengers.join('')}</div>` : ''}
      </aside>
    </section>`;
}

function mountRequest(sv) {
  const form = $('.req-form', app);
  if (!form) return;
  phoneMask(form.elements.phone);
  const checkText = (raw) => {
    const r = V.checkComment(raw);
    return r.ok && !r.value ? { ok: false, error: 'Опишите, что нужно сделать' } : r;
  };
  const checkAll = liveCheck(form, { text: checkText, name: V.checkName, phone: V.checkPhone });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    const btn = $('button.btn', form);
    err.classList.add('hidden');
    const fixed = checkAll();
    if (!fixed) return;
    try {
      await requireAuth('Войдите, чтобы отправить заявку. Так вы увидите её статус в личном кабинете.');
    } catch {
      return;
    }
    btn.disabled = true;
    try {
      const res = await api('/api/orders/request', { method: 'POST', body: { ...fixed, service: sv.slug } });
      successView({ id: res.id, title: 'Заявка отправлена', text: `Мы свяжемся с вами по номеру ${fixed.phone} и всё уточним.` });
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      btn.disabled = false;
    }
  };
}

export function renderBlocks(blocks) {
  const pricing = state.site.pricing;
  return (blocks || [])
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return b.text ? `<h2 class="b-heading reveal">${esc(b.text)}</h2>` : '';
        case 'text':
          return `<div class="b-text reveal">${md(b.text)}</div>`;
        case 'image':
          return b.src ? `<div class="b-image reveal"><figure><img src="${esc(b.src)}" alt="${esc(b.caption)}" loading="lazy">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure></div>` : '';
        case 'gallery':
          return (b.images || []).length
            ? `<div class="b-gallery reveal">${b.images.map((src) => `<button type="button" data-src="${esc(src)}" aria-label="Открыть фото"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')}</div>`
            : '';
        case 'prices': {
          // Пустые строки (не заполненные в админке) не показываем, а без строк — и весь блок
          const rows = (b.rows || []).filter((r) => r.name || r.price);
          if (!rows.length) return '';
          return `<div class="reveal">${b.title ? `<h3 class="price-title">${esc(b.title)}</h3>` : ''}<div class="price-cards">${rows
            .map((r) => `<div class="price-card"><span class="nm">${esc(r.name)}</span>${r.note ? `<small>${esc(r.note)}</small>` : ''}<span class="pr">${esc(r.price)}</span></div>`)
            .join('')}</div></div>`;
        }
        case 'print_prices': {
          const p = pricing.print;
          // Одна карточка на каждое доступное сочетание: формат + бумага (+ ЧБ/цвет, если цены разные)
          const cards = [];
          for (const f of p.formats) {
            const bw = P.unitPrice(f, 'plain', 'bw');
            const col = P.unitPrice(f, 'plain', 'color');
            if (bw !== null && col !== null && bw !== col) {
              cards.push([f.name, 'обычная бумага, ЧБ', bw], [f.name, 'обычная бумага, цветная', col]);
            } else if (bw !== null || col !== null) {
              cards.push([f.name, bw !== null && col !== null ? 'обычная бумага, ЧБ или цвет' : col !== null ? 'обычная бумага, цветная' : 'обычная бумага, ЧБ', col !== null ? col : bw]);
            }
            const gl = P.unitPrice(f, 'glossy', 'color');
            const mt = P.unitPrice(f, 'matte', 'color');
            if (gl !== null && gl === mt) cards.push([f.name, 'фотобумага, глянцевая или матовая', gl]);
            else {
              if (gl !== null) cards.push([f.name, 'глянцевая фотобумага', gl]);
              if (mt !== null) cards.push([f.name, 'матовая фотобумага', mt]);
            }
          }
          return `<div class="reveal">${b.title ? `<h3 class="price-title">${esc(b.title)}</h3>` : ''}<div class="price-cards">${cards
            .map(([nm, note, pr]) => `<div class="price-card"><span class="nm">${esc(nm)}</span><small>${esc(note)}</small><span class="pr">${money(pr)}</span></div>`)
            .join('')}</div><p class="muted small print-note">${esc(OTHER_FORMATS_NOTE)}</p></div>`;
        }
        case 'faq':
          return `<div class="faq reveal">${(b.items || []).map((it) => `<details><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join('')}</div>`;
        case 'callout':
          return `<div class="callout reveal">${b.title ? `<h3>${esc(b.title)}</h3>` : ''}${b.text ? `<p>${esc(b.text)}</p>` : ''}</div>`;
        default:
          return '';
      }
    })
    .join('');
}

// ================================================================ проверка полей
const V = window.Validate;
/** Маска телефона: +7 (9XX) XXX-XX-XX. Если ввели буквы (логин admin) — не трогаем */
function phoneMask(input, { prefill = true } = {}) {
  input.addEventListener('input', () => {
    if (/[a-zа-я]/i.test(input.value)) {
      input.value = input.value.replace(/^\+7 \(?/, '');
      return;
    }
    const f = V.formatPhone(input.value);
    if (f !== input.value) input.value = f;
  });
  if (prefill) {
    input.addEventListener('focus', () => !input.value && (input.value = '+7 ('));
    input.addEventListener('blur', () => input.value === '+7 (' && (input.value = ''));
  }
}
/** Подсказки под полями: rules = { имяПоля: функция проверки } */
function liveCheck(form, rules) {
  const show = (name, msg) => {
    const input = form.elements[name];
    if (!input) return;
    let hint = input.parentElement.querySelector('.f-err');
    if (!hint) {
      hint = document.createElement('small');
      hint.className = 'f-err';
      hint.setAttribute('role', 'alert');
      input.insertAdjacentElement('afterend', hint);
    }
    hint.textContent = msg || '';
    hint.hidden = !msg;
    input.classList.toggle('invalid', !!msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  const check = (name) => {
    const r = rules[name](form.elements[name].value);
    show(name, r.ok ? '' : r.error);
    return r;
  };
  for (const name of Object.keys(rules)) {
    const el = form.elements[name];
    if (!el) continue;
    el.addEventListener('blur', () => el.value && check(name));
    el.addEventListener('input', () => el.classList.contains('invalid') && check(name));
  }
  // Проверить всё; вернуть исправленные значения или null
  return () => {
    const out = {};
    let first = null;
    for (const name of Object.keys(rules)) {
      const r = check(name);
      if (!r.ok && !first) first = form.elements[name];
      out[name] = r.value;
    }
    if (first) {
      first.focus();
      return null;
    }
    return out;
  };
}

// ================================================================ авторизация
const VERIFY_TEXT = {
  sms: { label: 'Код из SMS', button: 'Получить код', hint: 'Пришлём SMS на указанный номер, чтобы убедиться, что он ваш', sent: 'Код отправлен в SMS' },
  call: { label: 'Последние 4 цифры входящего номера', button: 'Позвонить мне', hint: 'Мы позвоним и сразу сбросим. Брать трубку не нужно: введите последние 4 цифры номера, с которого был звонок', sent: 'Звоним, посмотрите входящий звонок' },
  whatsapp: { label: 'Код из WhatsApp', button: 'Прислать в WhatsApp', hint: 'Пришлём код в WhatsApp на указанный номер', sent: 'Код отправлен в WhatsApp' },
  max: { label: 'Код из MAX', button: 'Прислать в MAX', hint: 'Пришлём код в мессенджер MAX на указанный номер', sent: 'Код отправлен в MAX' },
};
export function requireAuth(reason) {
  if (state.user) return Promise.resolve(state.user);
  return new Promise((resolve, reject) => {
    let done = false;
    const sheet = openSheet(
      `<div class="sheet-head"><h2>Вход</h2><button class="icon-btn" data-close aria-label="Закрыть">${icon.close}</button></div>
       ${reason ? `<p class="muted" style="margin:-8px 0 18px">${esc(reason)}</p>` : ''}
       <div class="tabs" role="tablist">
         <button role="tab" aria-selected="true" data-tab="login">Вход</button>
         <button role="tab" aria-selected="false" data-tab="reg">Регистрация</button>
       </div>
       <form class="form" data-form="login">
         <label class="field"><span>Телефон</span><input class="input" name="login" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="+7 900 000-00-00" required></label>
         <label class="field"><span>Пароль</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
         <div class="form-error hidden"></div>
         <button class="btn btn-block">Войти</button>
       </form>
       <form class="form hidden" data-form="reg">
         <label class="field"><span>Как вас зовут</span><input class="input" name="name" autocomplete="name" required></label>
         <label class="field"><span>Телефон</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00" required><small>По нему позвоним, когда заказ будет готов</small></label>
         <label class="field"><span>Пароль</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="6" required><small>Минимум 6 символов, не 123456</small></label>
         <label class="sr" aria-hidden="true">Сайт<input name="website" tabindex="-1" autocomplete="off"></label>
         ${
           state.site.verify
             ? `<div class="field"><span>${VERIFY_TEXT[state.site.verify.method].label}</span>
                 <div style="display:flex;gap:8px"><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="4" placeholder="••••" style="max-width:120px;letter-spacing:.3em;font-weight:800">
                 <button type="button" class="btn btn-soft" data-send-code style="flex:1">${VERIFY_TEXT[state.site.verify.method].button}</button></div>
                 <small>${VERIFY_TEXT[state.site.verify.method].hint}</small></div>`
             : ''
         }
         <div class="form-error hidden"></div>
         <button class="btn btn-block">Создать аккаунт</button>
       </form>`,
      { label: 'Вход', onClose: () => !done && reject(new Error('cancelled')) }
    );
    const el = sheet.el;
    $$('[data-tab]', el).forEach(
      (t) =>
        (t.onclick = () => {
          $$('[data-tab]', el).forEach((x) => x.setAttribute('aria-selected', String(x === t)));
          $$('[data-form]', el).forEach((f) => f.classList.toggle('hidden', f.dataset.form !== t.dataset.tab));
          $(`[data-form="${t.dataset.tab}"] input`, el).focus();
        })
    );
    const regForm = $('[data-form="reg"]', el);
    const loginForm = $('[data-form="login"]', el);
    phoneMask(loginForm.elements.login, { prefill: false });
    phoneMask(regForm.elements.phone);
    const checkReg = liveCheck(regForm, { name: V.checkName, phone: V.checkPhone, password: V.checkPassword });
    const sendBtn = $('[data-send-code]', regForm);
    if (sendBtn) {
      sendBtn.onclick = async () => {
        const r = V.checkPhone(regForm.elements.phone.value);
        if (!r.ok) {
          checkReg();
          return;
        }
        sendBtn.disabled = true;
        try {
          await api('/api/auth/send-code', { method: 'POST', body: { phone: r.value } });
          toast(VERIFY_TEXT[state.site.verify.method].sent);
          regForm.elements.code.focus();
          let left = 60;
          const t = setInterval(() => {
            sendBtn.textContent = left > 0 ? `Повторно через ${left--} с` : 'Отправить ещё раз';
            if (left < 0) {
              clearInterval(t);
              sendBtn.disabled = false;
            }
          }, 1000);
        } catch (ex) {
          toast(ex.message, true);
          sendBtn.disabled = false;
        }
      };
    }
    $$('[data-form]', el).forEach((form) => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = $('.form-error', form);
        const btn = $('button:not([data-send-code])', form);
        err.classList.add('hidden');
        let fixed = {};
        if (form === regForm) {
          fixed = checkReg();
          if (!fixed) return;
          if (state.site.verify && !/^\d{4}$/.test(form.elements.code.value.trim())) {
            err.textContent = `Введите 4 цифры кода. Нет кода — нажмите «${VERIFY_TEXT[state.site.verify.method].button}»`;
            err.classList.remove('hidden');
            return;
          }
        }
        btn.disabled = true;
        try {
          const body = { ...Object.fromEntries(new FormData(form)), ...fixed };
          await api(form.dataset.form === 'login' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body });
          await loadMe();
          done = true;
          sheet.close();
          renderHeader();
          toast(`Здравствуйте, ${state.user.name}!`);
          resolve(state.user);
        } catch (ex) {
          err.textContent = ex.message;
          err.classList.remove('hidden');
        } finally {
          btn.disabled = false;
        }
      };
    });
  });
}

async function loadMe() {
  const { user } = await api('/api/me');
  state.user = user;
  return user;
}

// ================================================================ оформление заказа
function checkoutSheet({ title, summaryHtml, submitLabel, onSubmit }) {
  const u = state.user;
  const phone = u.phone === 'admin' ? '' : V.formatPhone(u.phone);
  const sheet = openSheet(
    `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Закрыть">${icon.close}</button></div>
     <form class="form">
       <label class="field"><span>Имя</span><input class="input" name="name" value="${esc(u.phone === 'admin' ? '' : u.name)}" autocomplete="name" required></label>
       <label class="field"><span>Телефон для связи</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(phone)}" required><small>Позвоним или напишем, когда заказ будет готов. Оплата при получении</small></label>
       <label class="field"><span>Комментарий</span><textarea class="textarea" name="comment" placeholder="Например: без полей, заберу в субботу"></textarea></label>
       <div class="card" style="padding:16px;box-shadow:inset 0 0 0 2px var(--line)">${summaryHtml}</div>
       <div class="upl-list hidden"></div>
       <div class="form-error hidden"></div>
       <button class="btn btn-block">${esc(submitLabel)}</button>
     </form>`,
    { label: title }
  );
  const form = $('form', sheet.el);
  phoneMask(form.elements.phone);
  const checkAll = liveCheck(form, { name: V.checkName, phone: V.checkPhone, comment: V.checkComment });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    const btn = $('button.btn', form);
    err.classList.add('hidden');
    const fixed = checkAll();
    if (!fixed) return;
    btn.disabled = true;
    const label = btn.textContent;
    try {
      await onSubmit(fixed, { setButton: (t) => (btn.textContent = t), progressList: $('.upl-list', form) });
      sheet.close();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  return sheet;
}

function successView({ id, title, text }) {
  window.scrollTo(0, 0);
  app.innerHTML = `<div class="wrap success">
      <div class="success-badge"><span>№${id}</span></div>
      <h1 style="font-size:clamp(28px,6vw,44px)">${esc(title)}</h1>
      <p>${esc(text)}</p>
      <a class="btn" href="/account">Мои заказы</a>
    </div>`;
}

const toolHead = (a, b, lead, facts) => `
  <div class="tool-head">
    ${mega(a, b)}
    <p class="lead reveal">${esc(lead)}</p>
    <div class="tool-facts reveal">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
  </div>`;

// ================================================================ печать фото
const print = { items: [], defFormat: null, defPaper: null, defColor: 'color', seq: 0, thumbQueue: Promise.resolve() };
const P = window.Pricing;
const OTHER_FORMATS_NOTE = 'А5 и А6 на обычной бумаге печатаем на листе А4, поэтому цена как у А4. Для других форматов тоже берём лист ближайшего большего размера по его цене — напишите нужный размер в комментарии к заказу.';

const findFormat = (id) => state.site.pricing.print.formats.find((f) => f.id === id);
/** Если у формата нет выбранной бумаги — берём первую доступную */
function fixPaper(fmtId, paper) {
  const list = P.papersFor(findFormat(fmtId));
  return list.some((x) => x.id === paper) ? paper : list[0] && list[0].id;
}

function printDefaults() {
  const p = state.site.pricing.print;
  if (!p.formats.find((f) => f.id === print.defFormat)) print.defFormat = p.formats[0] && p.formats[0].id;
  print.defPaper = fixPaper(print.defFormat, print.defPaper);
}

function viewPrint() {
  printDefaults();
  const p = state.site.pricing.print;
  setMeta(`Печать фото онлайн — ${state.site.salon.name}`);
  const chips = (name, list, cur) =>
    list.map((x) => `<label class="chip chip-sm"><input type="radio" name="${name}" value="${esc(x.id)}" ${x.id === cur ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('');
  const minPrice = p.formats.length ? Math.min(...p.formats.map((f) => f.price)) : 0;
  const facts = [minPrice ? `от ${money(minPrice)} за фото` : 'Любые форматы'];
  if (p.discountEvery) facts.push(`каждый ${p.discountEvery}-й на ${p.discountPercent}% дешевле`);
  facts.push('оплата при получении');

  app.innerHTML = `
    <div class="wrap">
      ${toolHead('Печать', 'фото', 'Добавьте снимки, выберите формат и бумагу. Позвоним, когда всё будет готово.', facts)}
      <div class="tool-grid">
        <div class="stack" style="gap:14px">
          <label class="drop" id="drop">
            <input type="file" accept="image/*,.heic,.heif" multiple class="sr" id="file-in">
            ${icon.upload}
            <strong>Выбрать фото</strong>
            <span class="muted small">Можно сразу много. JPG, PNG, HEIC до 60 МБ</span>
          </label>
          <div class="defaults hidden" id="defaults">
            <div><div class="lbl">Формат для всех</div><div class="chips chips-scroll">${chips('def-format', p.formats, print.defFormat)}</div></div>
            <div><div class="lbl">Бумага для всех</div><div class="chips" id="def-papers"></div></div>
            <div><div class="lbl">Печать для всех</div><div class="chips">${chips('def-color', P.COLORS, print.defColor)}</div></div>
          </div>
          <p class="muted small print-note">${esc(OTHER_FORMATS_NOTE)}</p>
          <div class="photo-list" id="photo-list"></div>
        </div>
        <aside class="summary" id="summary"></aside>
      </div>
    </div>
    <div class="bar desk-hide" id="bar">
      <div class="bar-info"><b id="bar-total"></b><small id="bar-sub"></small></div>
      <button class="btn btn-lime" id="bar-go">Оформить</button>
    </div>`;

  const input = $('#file-in');
  input.onchange = () => {
    addFiles(input.files);
    input.value = '';
  };
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over'))));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });
  const drawDefPapers = () => {
    $('#def-papers').innerHTML = chips('def-paper', P.papersFor(findFormat(print.defFormat)), print.defPaper);
  };
  drawDefPapers();
  $('#defaults').addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'def-format') {
      print.defFormat = t.value;
      print.defPaper = fixPaper(t.value, print.defPaper);
      print.items.forEach((i) => ((i.format = t.value), (i.paper = print.defPaper)));
      drawDefPapers();
    }
    if (t.name === 'def-paper') {
      print.defPaper = t.value;
      print.items.forEach((i) => (i.paper = fixPaper(i.format, t.value)));
    }
    if (t.name === 'def-color') {
      print.defColor = t.value;
      print.items.forEach((i) => (i.color = t.value));
    }
    renderPhotoList(false);
  });
  const list = $('#photo-list');
  list.addEventListener('change', (e) => {
    const card = e.target.closest('.photo');
    if (!card) return;
    const it = print.items.find((x) => x.key === card.dataset.key);
    if (!it) return;
    if (e.target.name === 'format') {
      it.format = e.target.value;
      it.paper = fixPaper(it.format, it.paper);
      $('select[name="paper"]', card).innerHTML = paperOptions(it);
    }
    if (e.target.name === 'paper') it.paper = e.target.value;
    if (e.target.name === 'color') it.color = e.target.value;
    if (e.target.name === 'copies') it.copies = Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1));
    updateCard(card, it);
    updateTotals();
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.photo');
    const it = print.items.find((x) => x.key === card.dataset.key);
    if (!it) return;
    if (btn.dataset.act === 'rm') {
      removeItem(it);
      renderPhotoList(false);
      return;
    }
    it.copies = Math.max(1, Math.min(999, it.copies + (btn.dataset.act === 'plus' ? 1 : -1)));
    $('input[name="copies"]', card).value = it.copies;
    updateCard(card, it);
    updateTotals();
  });
  $('#bar-go').onclick = startPrintCheckout;
  document.body.classList.add('has-bar');
  renderPhotoList(false);
}

function removeItem(it) {
  print.items = print.items.filter((x) => x !== it);
  if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
}

function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
  if (!files.length) return toast('Выберите файлы с фотографиями', true);
  const tooBig = files.filter((f) => f.size > 60 * 1024 * 1024);
  if (tooBig.length) toast(`${tooBig.length} ${plural(tooBig.length, 'файл больше', 'файла больше', 'файлов больше')} 60 МБ — пропустили`, true);
  for (const file of files) {
    if (file.size > 60 * 1024 * 1024) continue;
    const it = { key: 'p' + ++print.seq, file, name: file.name, format: print.defFormat, paper: print.defPaper, color: print.defColor, copies: 1, thumbUrl: '', thumbBlob: null, w: 0, h: 0, fileId: null, thumbId: null, fresh: true };
    print.items.push(it);
    print.thumbQueue = print.thumbQueue.then(async () => {
      if (!print.items.includes(it)) return;
      const t = await makeThumb(file);
      if (t) Object.assign(it, { thumbUrl: t.url, thumbBlob: t.blob, w: t.w, h: t.h });
      else it.noPreview = true;
      const card = document.querySelector(`.photo[data-key="${it.key}"]`);
      if (card) updateCard(card, it, true);
    });
  }
  renderPhotoList(true);
}

const paperOptions = (it) =>
  P.papersFor(findFormat(it.format))
    .map((x) => `<option value="${esc(x.id)}" ${x.id === it.paper ? 'selected' : ''}>${esc(x.name)}</option>`)
    .join('');

function photoCardHtml(it, i, animate) {
  const p = state.site.pricing.print;
  const anim = animate && it.fresh ? `style="animation-delay:${Math.min(i, 12) * 0.04}s"` : 'style="animation:none"';
  it.fresh = false;
  return `<div class="photo" data-key="${it.key}" ${anim}>
    <div class="photo-thumb"></div>
    <div class="photo-main">
      <div class="photo-top"><span class="photo-name">${esc(it.name)}</span><button class="icon-btn" data-act="rm" aria-label="Убрать фото">${icon.trash}</button></div>
      <div class="photo-row">
        <select class="select" name="format" aria-label="Формат">${p.formats.map((f) => `<option value="${esc(f.id)}" ${f.id === it.format ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
        <select class="select" name="paper" aria-label="Бумага">${paperOptions(it)}</select>
        <select class="select" name="color" aria-label="Цветная или чёрно-белая">${P.COLORS.map((c) => `<option value="${c.id}" ${c.id === it.color ? 'selected' : ''}>${c.id === 'bw' ? 'ЧБ' : 'Цвет'}</option>`).join('')}</select>
      </div>
      <div class="photo-foot">
        <div class="stepper"><button type="button" data-act="minus" aria-label="Меньше копий">−</button><input name="copies" type="number" inputmode="numeric" min="1" max="999" value="${it.copies}" aria-label="Копий"><button type="button" data-act="plus" aria-label="Больше копий">+</button></div>
        <span class="photo-price"></span>
      </div>
      <span class="warn hidden"></span>
    </div>
  </div>`;
}

function updateCard(card, it, thumbChanged) {
  const th = $('.photo-thumb', card);
  if (thumbChanged || !th.dataset.done) {
    if (it.thumbUrl) {
      th.innerHTML = `<img src="${it.thumbUrl}" alt="">`;
      th.dataset.done = '1';
    } else if (it.noPreview) {
      th.textContent = (it.name.split('.').pop() || 'фото').toUpperCase();
      th.dataset.done = '1';
    } else th.innerHTML = '<div class="spinner" style="width:24px;height:24px;border-width:3px;margin:0"></div>';
  }
  const calc = window.Pricing.calcPrint(state.site.pricing, [it], 0);
  $('.photo-price', card).textContent = money(calc.lines[0].line);
  const warn = $('.warn', card);
  const fmt = state.site.pricing.print.formats.find((f) => f.id === it.format);
  let low = false;
  if (fmt && it.w && fmt.wcm && fmt.hcm) {
    const needLong = (Math.max(fmt.wcm, fmt.hcm) / 2.54) * 150;
    const needShort = (Math.min(fmt.wcm, fmt.hcm) / 2.54) * 150;
    low = Math.max(it.w, it.h) < needLong || Math.min(it.w, it.h) < needShort;
  }
  warn.textContent = 'Маленькое разрешение: на этом формате может выйти нечётко';
  warn.classList.toggle('hidden', !low);
}

function renderPhotoList(animate) {
  const list = $('#photo-list');
  if (!list) return;
  list.innerHTML = print.items.map((it, i) => photoCardHtml(it, i, animate)).join('');
  $$('.photo', list).forEach((card) => updateCard(card, print.items.find((x) => x.key === card.dataset.key)));
  const has = print.items.length > 0;
  $('#defaults').classList.toggle('hidden', !has);
  $('#drop').classList.toggle('compact', has);
  $('#drop strong').textContent = has ? 'Добавить ещё фото' : 'Выбрать фото';
  updateTotals();
}

function printCalc() {
  const prev = state.user ? state.user.prints || 0 : 0;
  return window.Pricing.calcPrint(state.site.pricing, print.items, prev);
}

function loyaltyDots(loyal) {
  return `<div class="dots" style="--n:${loyal.every}">${Array.from({ length: loyal.every }, (_, i) => `<i class="${i === loyal.every - 1 ? 'gift' : i < loyal.inCycle ? 'on' : ''}"></i>`).join('')}</div>`;
}

function printSummaryHtml(calc, withButton) {
  const p = state.site.pricing.print;
  const prev = state.user ? state.user.prints || 0 : 0;
  const loyal = window.Pricing.loyalty(state.site.pricing, prev + calc.prints);
  return `
    ${withButton ? '<h3>Ваш заказ</h3>' : ''}
    <div class="sum-rows">
      <div class="sum-row"><span>${calc.prints} ${plural(calc.prints, 'отпечаток', 'отпечатка', 'отпечатков')}</span><span>${money(calc.subtotal)}</span></div>
      ${calc.discount ? `<div class="sum-row disc"><span>Скидка ${p.discountPercent}% на ${calc.discountedPrints} шт.</span><span>−${money(calc.discount)}</span></div>` : ''}
    </div>
    <div class="sum-total"><span>Итого</span><b>${money(calc.total)}</b></div>
    <p class="muted small" style="margin-top:8px">Оплата при получении в салоне</p>
    ${
      loyal
        ? `<div class="loyal-mini">${loyaltyDots(loyal)}
          <span>${loyal.nextIn === 1 ? 'Следующий отпечаток будет со скидкой' : `Ещё ${loyal.nextIn - 1} ${plural(loyal.nextIn - 1, 'отпечаток', 'отпечатка', 'отпечатков')}, и следующий со скидкой ${loyal.percent}%`}${state.user ? '' : '. Скидка считается после входа'}</span></div>`
        : ''
    }
    ${withButton ? `<button class="btn btn-block" style="margin-top:16px" data-go ${calc.prints ? '' : 'disabled'}>Оформить заказ</button>` : ''}`;
}

function updateTotals() {
  const calc = printCalc();
  const sum = $('#summary');
  if (sum) {
    sum.innerHTML = calc.prints
      ? printSummaryHtml(calc, true)
      : `<div class="empty" style="padding:20px 0"><strong>Пока пусто</strong>Добавьте фото, и здесь появится стоимость</div>`;
    const b = $('[data-go]', sum);
    b && (b.onclick = startPrintCheckout);
  }
  const bar = $('#bar');
  if (bar) {
    bar.classList.toggle('show', calc.prints > 0);
    $('#bar-total').textContent = money(calc.total);
    $('#bar-sub').textContent = `${print.items.length} фото, ${calc.prints} ${plural(calc.prints, 'отпечаток', 'отпечатка', 'отпечатков')}${calc.discount ? `, скидка ${money(calc.discount)}` : ''}`;
  }
}

async function startPrintCheckout() {
  if (!print.items.length) return;
  try {
    await requireAuth('Войдите, чтобы оформить заказ. Так вы сможете следить за его статусом, а скидка будет копиться.');
  } catch {
    return;
  }
  updateTotals();
  const calc = printCalc();
  checkoutSheet({
    title: 'Оформление',
    summaryHtml: printSummaryHtml(calc, false),
    submitLabel: `Отправить заказ на ${money(calc.total)}`,
    onSubmit: async (form, ui) => {
      await print.thumbQueue;
      const box = ui.progressList;
      box.classList.remove('hidden');
      box.innerHTML = print.items
        .map((it) => `<div class="upl-item" data-u="${it.key}"><span style="width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</span><span class="track"><i></i></span></div>`)
        .join('');
      ui.setButton('Загружаем фото…');
      const queue = print.items.filter((i) => !i.fileId);
      print.items.filter((i) => i.fileId).forEach((it) => ($(`[data-u="${it.key}"] i`, box).style.width = '100%'));
      const worker = async () => {
        while (queue.length) {
          const it = queue.shift();
          const bar = $(`[data-u="${it.key}"] i`, box);
          if (it.thumbBlob && !it.thumbId) it.thumbId = (await upload(it.thumbBlob, { name: 'thumb.jpg' })).id;
          const r = await upload(it.file, { name: it.name, onProgress: (p) => (bar.style.width = Math.round(p * 100) + '%') });
          it.fileId = r.id;
          bar.style.width = '100%';
        }
      };
      await Promise.all([worker(), worker()]);
      ui.setButton('Отправляем заказ…');
      const res = await api('/api/orders/print', {
        method: 'POST',
        body: { ...form, items: print.items.map((i) => ({ file: i.fileId, thumb: i.thumbId, name: i.name, format: i.format, paper: i.paper, color: i.color, copies: i.copies })) },
      });
      print.items.forEach((i) => i.thumbUrl && URL.revokeObjectURL(i.thumbUrl));
      print.items = [];
      await loadMe();
      successView({ id: res.id, title: 'Заказ принят', text: `Мы позвоним по номеру ${form.phone}, когда фото будут готовы. К оплате при получении: ${money(res.total)}.` });
    },
  });
}

// ================================================================ 3D-конструктор футболок
const tee = { templates: null, tpl: null, size: null, qty: 1, stickers: [], selected: null, seq: 0 };
const PANEL_NAMES = { front: 'Перед', back: 'Спина', left: 'Левый рукав', right: 'Правый рукав' };

async function viewTshirt() {
  setMeta(`Футболка со своим принтом — ${state.site.salon.name}`);
  app.innerHTML = loadingHtml();
  const [templates, m] = await Promise.all([tee.templates || api('/api/templates'), import('./tee3d.js?v=7')]);
  tee.templates = templates;
  if (!templates.length) {
    app.innerHTML = `<div class="wrap empty" style="padding:80px 20px"><strong>Конструктор скоро заработает</strong>Мы добавляем модели футболок. Загляните чуть позже.</div>`;
    return;
  }
  if (!tee.tpl || !templates.find((t) => t.id === tee.tpl.id)) tee.tpl = templates[0];

  app.innerHTML = `
    <div class="wrap">
      ${toolHead('Твоя', 'футболка', 'Загрузите картинки и наклейте их куда угодно: на грудь, спину или рукава. Футболку можно крутить, а картинки двигать, увеличивать и поворачивать.', ['3D-примерка', 'сколько угодно картинок', 'оплата при получении'])}
      <div class="tee-tool">
        <div class="tee-stage" id="stage">
          <div class="tee-views" role="group" aria-label="Повернуть футболку">
            ${Object.entries(PANEL_NAMES).map(([k, v]) => `<button type="button" data-view="${k}">${v}</button>`).join('')}
          </div>
          <canvas id="tee-canvas" aria-label="3D-модель футболки"></canvas>
          <div class="tee-zoom"><button type="button" data-z="1.15" aria-label="Приблизить">+</button><button type="button" data-z="0.87" aria-label="Отдалить">−</button></div>
          <div class="tee-hint" id="tee-hint">Крутите футболку пальцем. Нажмите на картинку, чтобы двигать её</div>
        </div>
        <div class="tee-panel">
          <div class="tee-card">
            <div class="panel-lbl">Модель</div>
            <div class="tee-models" id="models">${templates
              .map((t) => `<button type="button" class="model-opt" data-id="${t.id}" aria-pressed="${t.id === tee.tpl.id}"><span class="swatch" style="background:${esc(t.color)}"></span><span>${esc(t.name)}<small>${money(t.price)}</small></span></button>`)
              .join('')}</div>
          </div>
          <div class="tee-card">
            <div class="panel-lbl">Картинки <small>можно несколько</small></div>
            <div class="stickers" id="stickers"></div>
            <div class="sel-tools hidden" id="sel-tools">
              <div class="panel-lbl" style="font-size:14px"><span id="sel-where"></span><small id="sel-size"></small></div>
              <label class="range"><span>Размер</span><input type="range" id="r-w" min="0.03" max="0.8" step="0.002"><output id="o-w"></output></label>
              <label class="range"><span>Наклон</span><input type="range" id="r-rot" min="-180" max="180" step="1"><output id="o-rot"></output></label>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="btn btn-soft btn-sm" data-t="center">По центру</button>
                <button type="button" class="btn btn-soft btn-sm" data-t="show">Показать</button>
                <button type="button" class="btn btn-danger btn-sm" data-t="rm">Удалить</button>
              </div>
            </div>
          </div>
          <div class="tee-card">
            <div class="panel-lbl">Размер <small id="size-extra"></small></div>
            <div class="chips" id="sizes"></div>
            <div class="panel-lbl" style="margin-top:6px">Количество</div>
            <div class="stepper"><button type="button" data-q="-1" aria-label="Меньше">−</button><input id="qty" type="number" inputmode="numeric" min="1" max="99" value="${tee.qty}" aria-label="Количество"><button type="button" data-q="1" aria-label="Больше">+</button></div>
          </div>
          <div class="tee-card desk-only" id="tee-sum"></div>
        </div>
      </div>
      <p class="muted small" style="margin-top:14px;font-size:11px">3D-модель: «T-shirt», Poly by Google, <a href="https://poly.pizza/m/bdOMzzh-fSl" target="_blank" rel="noopener">Poly Pizza</a>, лицензия <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a></p>
    </div>
    <div class="bar desk-hide show" id="bar">
      <div class="bar-info"><b id="bar-total"></b><small id="bar-sub"></small></div>
      <button class="btn btn-lime" id="bar-go">Заказать</button>
    </div>`;
  document.body.classList.add('has-bar');

  const stage = $('#stage');
  const canvas = $('#tee-canvas');
  if (!m.webglSupported()) {
    stage.insertAdjacentHTML('beforeend', '<div class="no3d">Ваш браузер не показывает 3D. Обновите его или откройте сайт в Chrome или Safari.</div>');
    return;
  }
  let t3;
  try {
    t3 = m.createTee(canvas, { color: tee.tpl.color, kind: tee.tpl.kind });
  } catch {
    stage.insertAdjacentHTML('beforeend', '<div class="no3d">Не получилось запустить 3D на этом устройстве.</div>');
    return;
  }
  onLeave(() => t3.destroy());
  t3.setStickers(tee.stickers);
  t3.select(tee.selected);
  if (!reduced) {
    t3.state.yaw = -1.4;
    setTimeout(() => t3.view('front'), 200);
  } else t3.state.yaw = 0;

  const cmOf = (s) => m.stickerCm(tee.tpl.kind, s);

  $('#models').onclick = (e) => {
    const b = e.target.closest('.model-opt');
    if (!b) return;
    tee.tpl = templates.find((x) => x.id === Number(b.dataset.id));
    $$('.model-opt').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    t3.setKind(tee.tpl.kind);
    t3.setColor(tee.tpl.color);
    renderSizes();
    updateTee();
    updateSel();
  };
  $('.tee-views').onclick = (e) => {
    const b = e.target.closest('[data-view]');
    if (b) t3.view(b.dataset.view);
  };
  $$('[data-z]').forEach((b) => (b.onclick = () => t3.zoomBy(Number(b.dataset.z))));

  function drawStickers() {
    $('#stickers').innerHTML =
      tee.stickers.map((s) => `<button type="button" class="sticker-opt" data-id="${s.id}" aria-pressed="${s === tee.selected}" aria-label="Картинка ${esc(s.name)}"><img src="${s.url}" alt=""></button>`).join('') +
      `<label class="sticker-add" aria-label="Добавить картинку">+<input type="file" accept="image/png,image/jpeg,image/webp" multiple class="sr" id="st-in"></label>`;
    $('#st-in').onchange = (e) => {
      addStickers(Array.from(e.target.files || []));
      e.target.value = '';
    };
  }
  function select(s, showIt) {
    tee.selected = s;
    t3.select(s);
    $$('.sticker-opt').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.id) === (s && s.id))));
    updateSel();
    if (s && showIt) t3.view(s.panel);
  }
  function updateSel() {
    const s = tee.selected;
    $('#sel-tools').classList.toggle('hidden', !s);
    if (!s) return;
    const cm = cmOf(s);
    $('#sel-where').textContent = PANEL_NAMES[s.panel];
    $('#sel-size').textContent = `≈ ${Math.round(cm.w)} × ${Math.round(cm.h)} см`;
    $('#r-w').value = s.w;
    $('#r-rot').value = s.rot;
    $('#o-w').textContent = Math.round(cm.w) + ' см';
    $('#o-rot').textContent = Math.round(s.rot) + '°';
  }
  function addStickers(files) {
    const ok = files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type) && f.size <= 60 * 1024 * 1024);
    if (ok.length < files.length) toast('Подойдут PNG, JPG или WEBP до 60 МБ', true);
    if (tee.stickers.length + ok.length > 12) return toast('Можно добавить до 12 картинок', true);
    for (const file of ok) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const panel = t3.facing();
        const s = { id: ++tee.seq, file, url, img, name: file.name, panel, cx: 0.5, cy: 0.3, w: 0.24, rot: 0, fileId: null };
        tee.stickers.push(s);
        t3.setStickers(tee.stickers);
        drawStickers();
        select(s);
        updateTee();
        if (img.naturalWidth < 800) toast('Картинка небольшая, в печати может выйти нечётко');
      };
      img.onerror = () => toast('Не получилось открыть картинку', true);
      img.src = url;
    }
  }
  $('#stickers').onclick = (e) => {
    const b = e.target.closest('.sticker-opt');
    if (!b) return;
    select(tee.stickers.find((x) => x.id === Number(b.dataset.id)), true);
  };
  $('#r-w').oninput = (e) => {
    if (!tee.selected) return;
    tee.selected.w = Number(e.target.value);
    t3.refresh();
    updateSel();
  };
  $('#r-rot').oninput = (e) => {
    if (!tee.selected) return;
    tee.selected.rot = Number(e.target.value);
    t3.refresh();
    updateSel();
  };
  $('#sel-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    const s = tee.selected;
    if (!b || !s) return;
    if (b.dataset.t === 'center') {
      s.cx = 0.5;
      t3.refresh();
    }
    if (b.dataset.t === 'show') t3.view(s.panel);
    if (b.dataset.t === 'rm') {
      tee.stickers = tee.stickers.filter((x) => x !== s);
      URL.revokeObjectURL(s.url);
      t3.setStickers(tee.stickers);
      drawStickers();
      select(null);
      updateTee();
    }
  });

  // Жесты: один палец — крутить или тащить картинку, два — масштаб и поворот
  const pointers = new Map();
  let mode = null;
  let drag = null;
  let pinch = null;
  let moved = 0;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    $('#tee-hint').style.opacity = '0';
    t3.state.anim = null;
    if (pointers.size === 1) {
      moved = 0;
      const hit = t3.pickAt(e.clientX, e.clientY);
      const s = t3.stickerAt(hit);
      if (s) {
        select(s);
        mode = 'drag';
        drag = { s, dx: hit.x - s.cx, dy: hit.y - s.cy };
      } else mode = 'rotate';
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      mode = 'pinch';
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
    if (mode === 'rotate') t3.rotate((cur.x - prev.x) * 0.009, (cur.y - prev.y) * 0.006);
    if (mode === 'drag' && drag) {
      const hit = t3.pickAt(cur.x, cur.y);
      if (hit) {
        const s = drag.s;
        if (hit.panel !== s.panel) {
          s.panel = hit.panel;
          drag.dx = drag.dy = 0;
        }
        s.cx = clamp01(hit.x - drag.dx);
        s.cy = clamp01(hit.y - drag.dy);
        t3.refresh();
        updateSel();
      }
    }
    if (mode === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const s = tee.selected;
      if (s) {
        s.w = Math.max(0.03, Math.min(0.8, s.w * (d / pinch.d)));
        let da = ((ang - pinch.ang) * 180) / Math.PI;
        if (da > 180) da -= 360;
        if (da < -180) da += 360;
        s.rot = Math.max(-180, Math.min(180, s.rot + da));
        t3.refresh();
        updateSel();
      } else t3.zoomBy(d / pinch.d);
      pinch = { d, ang };
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (mode === 'rotate' && moved < 6 && tee.selected) select(null);
    if (pointers.size === 0) {
      mode = null;
      drag = null;
    } else if (pointers.size === 1) mode = 'rotate';
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      t3.zoomBy(e.deltaY < 0 ? 1.06 : 0.94);
    },
    { passive: false }
  );

  function renderSizes() {
    const sizes = state.site.pricing.tshirt.sizes.filter((s) => tee.tpl.sizes.includes(s.name));
    if (!sizes.find((s) => s.name === tee.size)) tee.size = (sizes.find((s) => s.name === 'M') || sizes[0] || {}).name || null;
    $('#sizes').innerHTML = sizes.map((s) => `<label class="chip"><input type="radio" name="size" value="${esc(s.name)}" ${s.name === tee.size ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('');
  }
  $('#sizes').onchange = (e) => {
    tee.size = e.target.value;
    updateTee();
  };
  const setQty = (v) => {
    tee.qty = Math.max(1, Math.min(99, parseInt(v, 10) || 1));
    $('#qty').value = tee.qty;
    updateTee();
  };
  $$('[data-q]').forEach((b) => (b.onclick = () => setQty(tee.qty + Number(b.dataset.q))));
  $('#qty').onchange = (e) => setQty(e.target.value);

  function updateTee() {
    const c = window.Pricing.calcTshirt(state.site.pricing, tee.tpl, tee.size, tee.qty, tee.stickers.length);
    const size = state.site.pricing.tshirt.sizes.find((s) => s.name === tee.size);
    $('#size-extra').textContent = size && size.extra ? `+${money(size.extra)} за ${size.name}` : '';
    $('#bar-total').textContent = money(c.total);
    const n = tee.stickers.length;
    $('#bar-sub').textContent = `${tee.tpl.name}, ${tee.size || 'размер?'}, ${n ? `${n} ${plural(n, 'картинка', 'картинки', 'картинок')}` : 'без картинок'}`;
    $('#tee-sum').innerHTML = `
      <div class="sum-rows">
        <div class="sum-row"><span>${esc(tee.tpl.name)}, ${esc(tee.size || '—')}</span><span>${money(tee.tpl.price + ((size && size.extra) || 0))}</span></div>
        ${c.stickersExtra ? `<div class="sum-row"><span>Дополнительные картинки</span><span>+${money(c.stickersExtra)}</span></div>` : ''}
        <div class="sum-row"><span>Количество</span><span>${tee.qty} шт.</span></div>
      </div>
      <div class="sum-total"><span>Итого</span><b>${money(c.total)}</b></div>
      <p class="muted small" style="margin-top:8px">Оплата при получении</p>
      <button class="btn btn-block" style="margin-top:16px" id="tee-go">Заказать футболку</button>`;
    $('#tee-go').onclick = () => startTeeCheckout(t3, m);
  }
  $('#bar-go').onclick = () => startTeeCheckout(t3, m);

  drawStickers();
  renderSizes();
  updateTee();
  updateSel();
}

/** Картинка-макет: виды с тех сторон, где есть наклейки */
function teePreview(t3) {
  const sides = ['front', 'back'];
  if (tee.stickers.some((s) => s.panel === 'left')) sides.push('left');
  if (tee.stickers.some((s) => s.panel === 'right')) sides.push('right');
  const S = 700;
  const out = document.createElement('canvas');
  out.width = S * sides.length;
  out.height = S + 60;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#FFF8F4';
  ctx.fillRect(0, 0, out.width, out.height);
  sides.forEach((side, i) => {
    const snap = t3.snapshot(side, S);
    ctx.drawImage(snap, i * S, 0);
    ctx.fillStyle = '#1F1652';
    ctx.font = '600 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(PANEL_NAMES[side], i * S + S / 2, S + 40);
  });
  t3.select(tee.selected);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось сделать макет'))), 'image/png'));
}

async function startTeeCheckout(t3, m) {
  if (!tee.stickers.length) return toast('Добавьте хотя бы одну картинку', true);
  if (!tee.size) return toast('Выберите размер', true);
  try {
    await requireAuth('Войдите, чтобы оформить заказ и следить за его статусом.');
  } catch {
    return;
  }
  const c = window.Pricing.calcTshirt(state.site.pricing, tee.tpl, tee.size, tee.qty, tee.stickers.length);
  const n = tee.stickers.length;
  checkoutSheet({
    title: 'Заказ футболки',
    summaryHtml: `<div class="sum-rows"><div class="sum-row"><span>${esc(tee.tpl.name)}, размер ${esc(tee.size)}</span><span>${tee.qty} шт.</span></div>
      <div class="sum-row"><span>Картинок</span><span>${n}</span></div></div>
      <div class="sum-total"><span>Итого</span><b>${money(c.total)}</b></div><p class="muted small" style="margin-top:8px">Оплата при получении</p>`,
    submitLabel: `Отправить заказ на ${money(c.total)}`,
    onSubmit: async (form, ui) => {
      ui.setButton('Готовим макет…');
      const previewBlob = await teePreview(t3);
      ui.setButton('Загружаем картинки…');
      for (const s of tee.stickers) if (!s.fileId) s.fileId = (await upload(s.file, { name: s.name })).id;
      const prev = await upload(previewBlob, { name: 'maket.png' });
      ui.setButton('Отправляем заказ…');
      const res = await api('/api/orders/tshirt', {
        method: 'POST',
        body: {
          ...form,
          templateId: tee.tpl.id,
          size: tee.size,
          qty: tee.qty,
          preview: prev.id,
          stickers: tee.stickers.map((s) => {
            const cm = m.stickerCm(tee.tpl.kind, s);
            return { file: s.fileId, name: s.name, panel: s.panel, cx: s.cx, cy: s.cy, w: s.w, rot: s.rot, cmW: cm.w, cmH: cm.h };
          }),
        },
      });
      tee.stickers.forEach((s) => URL.revokeObjectURL(s.url));
      tee.stickers = [];
      tee.selected = null;
      successView({ id: res.id, title: 'Заказ принят', text: `Мы позвоним по номеру ${form.phone}, когда футболка будет готова. К оплате при получении: ${money(res.total)}.` });
    },
  });
}

// ================================================================ личный кабинет
async function viewAccount() {
  setMeta(`Личный кабинет — ${state.site.salon.name}`);
  if (!state.user) {
    app.innerHTML = `<div class="wrap success"><div class="success-badge"><span>${icon.user}</span></div><h1 style="font-size:32px">Войдите в аккаунт</h1><p>Здесь будут ваши заказы и прогресс скидки.</p><button class="btn" id="login-btn">Войти или зарегистрироваться</button></div>`;
    $('#login-btn').onclick = () => requireAuth().then(() => render(), () => {});
    return;
  }
  app.innerHTML = loadingHtml();
  await loadMe();
  const orders = await api('/api/my/orders');
  const u = state.user;
  const loyal = window.Pricing.loyalty(state.site.pricing, u.prints);
  app.innerHTML = `
    <div class="wrap">
      <div class="tool-head">${mega('Мой', 'кабинет')}</div>
      <div class="acct">
        <div class="stack" style="gap:12px">
          <div class="card acct-hello stack" style="gap:14px">
            <h1>${esc(u.name)}</h1>
            <p class="muted">${u.phone === 'admin' ? 'Запасной вход администратора' : esc(fmtPhone(u.phone)) + (u.role === 'admin' ? ', администратор' : '')}</p>
            ${u.role === 'admin' ? '<a class="btn btn-lime" href="/admin">Открыть админку</a>' : ''}
            ${
              loyal
                ? `<div class="loyal-mini" style="margin:0">${loyaltyDots(loyal)}<span>${loyal.nextIn === 1 ? 'Ваш следующий отпечаток со скидкой!' : `До скидки ${loyal.percent}%: ещё ${loyal.nextIn - 1} ${plural(loyal.nextIn - 1, 'отпечаток', 'отпечатка', 'отпечатков')}`}</span></div>`
                : ''
            }
          </div>
          <details class="card">
            <summary style="cursor:pointer;font-weight:700">Сменить пароль</summary>
            <form class="form" id="pw-form" style="margin-top:16px">
              <label class="field"><span>Текущий пароль</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
              <label class="field"><span>Новый пароль</span><input class="input" type="password" name="next" minlength="6" autocomplete="new-password" required></label>
              <button class="btn">Сохранить пароль</button>
            </form>
          </details>
          <button class="btn btn-ghost" id="logout">Выйти</button>
        </div>
        <div class="stack" style="gap:12px">
          <h2 style="font-size:24px">Мои заказы</h2>
          ${
            orders.length
              ? orders
                  .map(
                    (o) => `<div class="order-card">
                <div class="order-top"><h3>№${o.id}, ${o.type === 'print' ? 'печать фото' : o.type === 'request' ? 'заявка' : 'футболка'}</h3><span class="badge st-${o.status}">${STATUS[o.status]}</span></div>
                <div class="thumbs">${o.items
                  .map((i) => {
                    const src = i.preview || i.thumb;
                    return src ? `<img src="/files/${src}" alt="" loading="lazy">` : '<span class="noimg"></span>';
                  })
                  .join('')}</div>
                <div class="order-top"><span class="muted small">${fmtDate(o.createdAt)}${o.type === 'print' ? `, ${o.prints} ${plural(o.prints, 'отпечаток', 'отпечатка', 'отпечатков')}` : o.type === 'request' ? `, ${esc((o.items[0] || {}).serviceTitle || '')}` : `, ${esc(o.items[0].size)}, ${o.items[0].qty} шт.`}</span>${o.type === 'request' ? '' : `<b>${money(o.total)}</b>`}</div>
              </div>`
                  )
                  .join('')
              : `<div class="card empty"><strong>Заказов пока нет</strong><p style="margin-bottom:16px">Самое время напечатать любимые фото.</p><a class="btn" href="/print">Заказать печать</a></div>`
          }
        </div>
      </div>
    </div>`;
  $('#logout').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    go('/');
  };
  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      toast('Пароль изменён');
    } catch (ex) {
      toast(ex.message, true);
    }
  };
}

// ================================================================ админка
async function viewAdmin(sub = '') {
  setMeta(`Админка — ${state.site.salon.name}`);
  if (!state.user || state.user.role !== 'admin') {
    app.innerHTML = `<div class="wrap success"><div class="success-badge"><span>${icon.user}</span></div>
      <h1 style="font-size:32px">Вход для администратора</h1>
      <p>Войдите со своим номером телефона. Если вы ещё не администратор, попросите, чтобы вас добавили в разделе «Настройки» → «Администраторы».</p>
      <button class="btn" id="login-btn">Войти</button></div>`;
    $('#login-btn').onclick = () => requireAuth().then(() => render(), () => {});
    return;
  }
  const admin = await import('./admin.js?v=10');
  await admin.render(sub || '/', { app, go, onLeave, renderBlocks, reloadSite });
}

async function reloadSite() {
  state.site = await api('/api/site');
  renderFooter();
}

function loadingHtml() {
  return '<div class="loading"><div class="spinner"></div>Загружаем…</div>';
}

// ================================================================ старт
(async function start() {
  try {
    const [site] = await Promise.all([api('/api/site'), loadMe()]);
    state.site = site;
  } catch (e) {
    app.innerHTML = `<div class="wrap empty" style="padding:80px 20px"><strong>Сайт временно недоступен</strong>${esc(e.message)}</div>`;
    return;
  }
  renderFooter();
  render();
})();
