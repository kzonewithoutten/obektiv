// Всё для поисковиков и красивых превью ссылок в мессенджерах.
// Сервер сразу отдаёт каждой странице свой заголовок, описание, картинку превью
// и основной текст — так Яндекс и Google видят содержимое без JavaScript.
const fs = require('fs');
const path = require('path');
const fonts = require('./fonts');

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
};

function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

let template = null;
let templateMtime = 0;
function loadTemplate(publicDir) {
  const file = path.join(publicDir, 'index.html');
  const m = fs.statSync(file).mtimeMs;
  if (!template || m !== templateMtime) {
    template = fs.readFileSync(file, 'utf8');
    templateMtime = m;
  }
  return template;
}

/** Данные для конкретной страницы */
function pageData(pathname, { salon, pricing, services, getService }) {
  const name = salon.name || 'Объектив';
  const inCity = salon.city ? ` в ${salon.city}` : '';
  const p = pricing.print || {};
  const fmts = (p.formats || []).map((f) => f.name).join(', ');
  const minPrice = (p.formats || []).length ? Math.min(...p.formats.map((f) => f.price)) : 0;
  const discount = p.discountEvery ? ` Каждый ${p.discountEvery}-й отпечаток со скидкой ${p.discountPercent}%.` : '';

  if (pathname === '/') {
    return {
      title: `${name} — печать фото${inCity} и футболки со своим принтом`,
      description: cut(salon.seoDescription || `${salon.heroText}${discount}`, 170),
      body: `<h1>${esc(salon.heroTitle)}</h1><p>${esc(salon.heroText)}</p>
        <h2>Услуги</h2><ul>${services.map((s) => `<li><a href="/service/${esc(s.slug)}">${esc(s.title)}</a>${s.summary ? ` — ${esc(s.summary)}` : ''}</li>`).join('')}
        <li><a href="/print">Печать фото онлайн</a></li><li><a href="/tshirt">Футболка со своим принтом</a></li></ul>
        ${salon.address ? `<h2>Контакты</h2><p>${esc(salon.address)}${salon.hours ? `, ${esc(salon.hours)}` : ''}${salon.phone ? `, ${esc(salon.phone)}` : ''}</p>` : ''}`,
    };
  }
  if (pathname === '/print') {
    return {
      title: `Печать фото онлайн${inCity} — ${name}`,
      description: cut(`Загрузите фото с телефона, выберите формат${fmts ? ` (${fmts})` : ''} и бумагу — глянцевую, матовую или обычную. ${minPrice ? `От ${minPrice} ₽ за фото. ` : ''}Оплата при получении.${discount}`, 170),
      body: `<h1>Печать фото онлайн</h1><p>Форматы: ${esc(fmts)}. Бумага: ${esc((p.papers || []).map((x) => x.name.toLowerCase()).join(', '))}. Оплата при получении в салоне.${esc(discount)}</p>`,
    };
  }
  if (pathname === '/tshirt') {
    return {
      title: `Футболка со своим принтом${inCity} — ${name}`,
      description: cut(`Соберите футболку в 3D-конструкторе: загрузите свои картинки и разместите их где угодно — на груди, спине или рукавах. Футболки, оверсайз и лонгсливы. Оплата при получении.`, 170),
      body: `<h1>Футболка со своим принтом</h1><p>3D-конструктор: загрузите картинки и разместите их на груди, спине или рукавах.</p>`,
    };
  }
  if (pathname === '/mug') {
    return {
      title: `Кружка со своим принтом${inCity} — ${name}`,
      description: cut('Соберите кружку в 3D-конструкторе: загрузите фото или картинки и разместите их спереди и сзади. Оплата при получении.', 170),
      body: '<h1>Кружка со своим принтом</h1><p>3D-конструктор: загрузите картинки и разместите их на кружке.</p>',
    };
  }
  const m = pathname.match(/^\/service\/([a-z0-9-]+)$/);
  if (m) {
    const s = getService(m[1]);
    if (!s) return { status: 404, title: `Страница не найдена — ${name}`, description: '', noindex: true, body: '<h1>Такой страницы нет</h1>' };
    const blocks = s.blocks || [];
    const firstText = (blocks.find((b) => b.type === 'text') || {}).text || '';
    const text = blocks
      .map((b) => {
        if (b.type === 'heading') return `<h2>${esc(b.text)}</h2>`;
        if (b.type === 'text') return `<p>${esc(b.text)}</p>`;
        if (b.type === 'callout') return `<p><strong>${esc(b.title)}</strong> ${esc(b.text)}</p>`;
        if (b.type === 'prices') return `<ul>${(b.rows || []).map((r) => `<li>${esc(r.name)} — ${esc(r.price)}</li>`).join('')}</ul>`;
        if (b.type === 'faq') return (b.items || []).map((r) => `<h3>${esc(r.q)}</h3><p>${esc(r.a)}</p>`).join('');
        return '';
      })
      .join('');
    return {
      title: s.seoTitle || `${s.title}${inCity} — ${name}`,
      description: cut(s.seoDescription || s.summary || firstText, 170),
      image: s.cover || '',
      body: `<h1>${esc(s.title)}</h1>${s.summary ? `<p>${esc(s.summary)}</p>` : ''}${text}`,
    };
  }
  if (pathname.startsWith('/admin') || pathname.startsWith('/account')) {
    return { title: `${name}`, description: '', noindex: true, body: '' };
  }
  return { status: 404, title: `Страница не найдена — ${name}`, description: '', noindex: true, body: '<h1>Такой страницы нет</h1>' };
}

function renderPage(req, res, publicDir, data) {
  const base = baseUrl(req);
  const url = new URL(req.url, base);
  const page = pageData(url.pathname, data);
  const { salon } = data;
  const abs = (u) => (!u ? '' : /^https?:/.test(u) ? u : base + u);
  const image = abs(page.image || salon.ogImage || '/img/og.png');
  const canonical = base + url.pathname;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: salon.name,
    url: base + '/',
    image: abs(salon.ogImage || '/img/og.png'),
    description: cut(salon.seoDescription || salon.heroText, 200),
  };
  if (salon.phone) ld.telephone = salon.phone;
  if (salon.address) ld.address = { '@type': 'PostalAddress', streetAddress: salon.address, ...(salon.city ? { addressLocality: salon.city } : {}) };
  if (salon.hours) ld.openingHours = salon.hours;
  if (salon.email) ld.email = salon.email;

  const head = [
    `<title>${esc(page.title)}</title>`,
    page.description && `<meta name="description" content="${esc(page.description)}">`,
    page.noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${esc(canonical)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="ru_RU">',
    `<meta property="og:site_name" content="${esc(salon.name)}">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    page.description && `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    !page.image && !salon.ogImage && '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${esc(image)}">`,
    salon.yandexVerification && `<meta name="yandex-verification" content="${esc(salon.yandexVerification)}">`,
    salon.googleVerification && `<meta name="google-site-verification" content="${esc(salon.googleVerification)}">`,
    url.pathname === '/' && `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ]
    .filter(Boolean)
    .join('\n  ');

  const html = loadTemplate(publicDir)
    .replace(/<title>[\s\S]*?<\/title>\s*(<meta name="description"[^>]*>)?/, head)
    .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/, fonts.headTags(salon))
    .replace('<!--SSR-->', `<div class="ssr">${page.body}</div>`);
  res.writeHead(page.status || 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

function sitemap(req, res, services) {
  const base = baseUrl(req);
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: '/', pr: '1.0', mod: today },
    { loc: '/print', pr: '0.9', mod: today },
    { loc: '/tshirt', pr: '0.8', mod: today },
    { loc: '/mug', pr: '0.8', mod: today },
    ...services.map((s) => ({ loc: `/service/${s.slug}`, pr: '0.7', mod: String(s.updatedAt || today).slice(0, 10) })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(base + u.loc)}</loc><lastmod>${u.mod}</lastmod><priority>${u.pr}</priority></url>`).join('\n')}
</urlset>`;
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.end(xml);
}

function robots(req, res) {
  const base = baseUrl(req);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /api/\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
}

module.exports = { renderPage, sitemap, robots };
