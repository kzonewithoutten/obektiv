import { state, $, $$, esc, api, upload, money, plural, fmtDate, fmtPhone, toast, openSheet, icon, STATUS } from './core.js';

let ctx; // { app, go, onLeave, renderBlocks, reloadSite }
let lastSeenOrder = 0;

export async function render(sub, c) {
  ctx = c;
  document.title = 'Админка — ' + state.site.salon.name;
  const m = (re) => sub.match(re);
  let r;
  if (sub === '/' || sub === '/orders') return withShell('orders', viewOrders);
  if (sub === '/services') return withShell('services', viewServices);
  if ((r = m(/^\/services\/(new|\d+)$/))) return withShell('services', () => viewServiceEditor(r[1]));
  if (sub === '/templates') return withShell('templates', viewTemplates);
  if ((r = m(/^\/templates\/(new|\d+)$/))) return withShell('templates', () => viewTemplateEditor(r[1]));
  if (sub === '/settings') return withShell('settings', viewSettings);
  ctx.go('/admin', { replace: true });
}

async function withShell(tab, fn) {
  const tabs = [
    ['orders', '/admin', 'Заказы'],
    ['services', '/admin/services', 'Услуги'],
    ['templates', '/admin/templates', 'Футболки'],
    ['settings', '/admin/settings', 'Настройки'],
  ];
  const warn =
    !state.site.pricing.configured || !state.site.salon.configured
      ? `<div class="notice">Сейчас на сайте стоят примерные ${!state.site.pricing.configured ? 'цены' : ''}${
          !state.site.pricing.configured && !state.site.salon.configured ? ' и ' : ''
        }${!state.site.salon.configured ? 'контакты' : ''}. Впишите свои данные в разделе <a href="/admin/settings">Настройки</a>.</div>`
      : '';
  ctx.app.innerHTML = `<div class="wrap admin">
      <nav class="admin-tabs" aria-label="Разделы админки">${tabs
        .map(([k, h, t]) => `<a href="${h}" class="${k === tab ? 'active' : ''}">${t}${k === 'orders' ? '<span class="count hidden" id="new-count"></span>' : ''}</a>`)
        .join('')}</nav>
      ${warn}
      <div id="admin-body"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;
  pollNew();
  const t = setInterval(pollNew, 30000);
  ctx.onLeave(() => clearInterval(t));
  await fn($('#admin-body'));
}

async function pollNew() {
  try {
    const s = await api('/api/admin/stats');
    const el = $('#new-count');
    if (el) {
      el.textContent = s.newOrders;
      el.classList.toggle('hidden', !s.newOrders);
    }
    document.title = (s.newOrders ? `(${s.newOrders}) ` : '') + 'Админка — ' + state.site.salon.name;
    if (lastSeenOrder && s.lastId > lastSeenOrder) toast(`Новый заказ №${s.lastId}`);
    lastSeenOrder = Math.max(lastSeenOrder, s.lastId);
  } catch {}
}

/** Уменьшает картинку для сайта (обложки, галереи), чтобы страницы быстро грузились с телефона */
function prepImage(file, max = 2000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      if (k === 1 && file.size < 1.5e6) return resolve(file);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const png = file.type === 'image/png';
      c.toBlob((b) => resolve(b || file), png ? 'image/png' : 'image/jpeg', 0.86);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}
async function pickAndUpload({ multiple = false, max = 2000 } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.multiple = multiple;
  const files = await new Promise((res) => {
    input.onchange = () => res(Array.from(input.files || []));
    input.click();
  });
  const urls = [];
  for (const f of files) {
    toast('Загружаем фото…');
    const blob = await prepImage(f, max);
    const r = await upload(blob, { name: f.name, isPublic: true });
    urls.push(r.url);
  }
  if (files.length) toast('Фото загружено');
  return urls;
}

// ================================================================ заказы
const ordersFilter = { status: 'active', type: '', q: '' };

async function viewOrders(body) {
  const st = [
    ['active', 'Активные'],
    ['new', 'Новые'],
    ['work', 'В работе'],
    ['ready', 'Готовы'],
    ['done', 'Выданы'],
    ['cancelled', 'Отменены'],
    ['', 'Все'],
  ];
  body.innerHTML = `
    <div class="admin-head"><h1>Заказы</h1></div>
    <div class="filters">
      <div class="chips chips-scroll" id="st-chips">${st
        .map(([v, t]) => `<label class="chip chip-sm"><input type="radio" name="st" value="${v}" ${v === ordersFilter.status ? 'checked' : ''}><span>${t}</span></label>`)
        .join('')}</div>
      <div style="display:flex;gap:8px">
        <select class="select" id="type-f" style="min-height:44px;width:auto"><option value="">Все типы</option><option value="print" ${ordersFilter.type === 'print' ? 'selected' : ''}>Печать</option><option value="tshirt" ${ordersFilter.type === 'tshirt' ? 'selected' : ''}>Футболки</option><option value="request" ${ordersFilter.type === 'request' ? 'selected' : ''}>Заявки</option></select>
        <input class="input" id="q-f" type="search" placeholder="Номер, имя, телефон" value="${esc(ordersFilter.q)}" style="min-height:44px">
      </div>
    </div>
    <div class="a-orders" id="orders"><div class="loading"><div class="spinner"></div></div></div>`;
  $('#st-chips').onchange = (e) => ((ordersFilter.status = e.target.value), load());
  $('#type-f').onchange = (e) => ((ordersFilter.type = e.target.value), load());
  let qt;
  $('#q-f').oninput = (e) => {
    clearTimeout(qt);
    qt = setTimeout(() => ((ordersFilter.q = e.target.value), load()), 300);
  };

  async function load() {
    const qs = new URLSearchParams(ordersFilter).toString();
    const { orders, counts } = await api('/api/admin/orders?' + qs);
    const el = $('#orders');
    if (!el) return;
    if (!orders.length) {
      el.innerHTML = `<div class="card empty"><strong>Заказов нет</strong>${ordersFilter.status === 'active' ? 'Новые заказы появятся здесь сами — страница проверяет их каждые 30 секунд.' : 'Попробуйте другой фильтр.'}</div>`;
      return;
    }
    el.innerHTML = orders.map(orderHtml).join('');
    $$('[data-save]', el).forEach((btn) => (btn.onclick = () => saveOrder(btn.dataset.save)));
    $$('[data-del]', el).forEach(
      (btn) =>
        (btn.onclick = async () => {
          const id = btn.dataset.del;
          if (!confirm(`Удалить заказ №${id} вместе с фото? Вернуть его будет нельзя.`)) return;
          try {
            await api('/api/admin/orders/' + id, { method: 'DELETE' });
            toast(`Заказ №${id} удалён`);
            pollNew();
            load();
          } catch (e) {
            toast(e.message, true);
          }
        })
    );
    $$('[data-copy]', el).forEach(
      (btn) =>
        (btn.onclick = () => {
          navigator.clipboard && navigator.clipboard.writeText(btn.dataset.copy).then(() => toast('Телефон скопирован'));
        })
    );
  }
  async function saveOrder(id) {
    const card = $(`[data-order="${id}"]`);
    try {
      await api('/api/admin/orders/' + id, {
        method: 'PATCH',
        body: { status: $('[name="status"]', card).value, adminNote: $('[name="note"]', card).value },
      });
      toast('Заказ №' + id + ' сохранён');
      pollNew();
      load();
    } catch (e) {
      toast(e.message, true);
    }
  }
  await load();
}

function orderHtml(o) {
  const isPrint = o.type === 'print';
  // Сводка «что печатать»: формат + бумага → сколько штук
  let groups = '';
  if (isPrint) {
    const g = {};
    o.items.forEach((i) => {
      const k = `${i.formatName}, ${i.paperName.toLowerCase()}${i.colorName ? ', ' + i.colorName.toLowerCase() : ''}`;
      g[k] = (g[k] || 0) + i.copies;
    });
    groups = Object.entries(g)
      .map(([k, n]) => `<span class="badge st-done" style="color:var(--ink)">${esc(k)}: ${n} шт.</span>`)
      .join(' ');
  }
  const PANEL_RU = { front: 'перед', back: 'спина', left: 'левый рукав', right: 'правый рукав' };
  let files;
  if (isPrint) {
    files = o.items
      .map((i, idx) => `<div class="o-file">
        ${i.thumb ? `<img src="/files/${i.thumb}" alt="" loading="lazy">` : `<span class="noimg">${esc((i.name || '').split('.').pop().toUpperCase())}</span>`}
        <b>${esc(i.formatName)}, ${esc(i.paperName.toLowerCase())}${i.colorName ? ', ' + esc(i.colorName.toLowerCase()) : ''}, ×${i.copies}</b>
        <a class="btn btn-soft" href="/api/admin/orders/${o.id}/file/${idx}" download>${icon.download}Оригинал</a>
      </div>`)
      .join('');
  } else if (o.type === 'request') {
    const it = o.items[0] || {};
    files = `<div class="o-file wide"><b>${esc(it.serviceTitle || 'Заявка')}</b><p style="white-space:pre-wrap;margin:0">${esc(it.text || '')}</p></div>`;
  } else {
    const it = o.items[0];
    files =
      `<div class="o-file wide">${it.preview ? `<img src="/files/${it.preview}" alt="Макет футболки" loading="lazy">` : ''}
        <b>${esc(it.templateName)}, размер ${esc(it.size)}, ${it.qty} шт.</b>
        <a class="btn btn-soft" href="/api/admin/orders/${o.id}/file/preview" download style="align-self:start">${icon.download}Макет</a></div>` +
      (it.stickers || [])
        .map((s, k) => `<div class="o-file">
          <img src="/files/${s.file}" alt="Картинка ${k + 1}" loading="lazy" style="object-fit:contain;background:#fff">
          <b>${PANEL_RU[s.panel]}, ≈ ${Math.round(s.cmW)}×${Math.round(s.cmH)} см${s.rot ? `, наклон ${Math.round(s.rot)}°` : ''}</b>
          <a class="btn btn-soft" href="/api/admin/orders/${o.id}/file/s${k}" download>${icon.download}Картинка ${k + 1}</a>
        </div>`)
        .join('') +
      (it.file ? `<div class="o-file"><span class="noimg">IMG</span><b>Изображение</b><a class="btn btn-soft" href="/api/admin/orders/${o.id}/file/old" download>${icon.download}Оригинал</a></div>` : '');
  }
  const tel = o.phone.replace(/[^\d+]/g, '');
  return `<details class="a-order" data-order="${o.id}" ${o.status === 'new' ? 'open' : ''}>
    <summary>
      <span class="o-title">№${o.id}, ${isPrint ? 'печать' : o.type === 'request' ? 'заявка' : 'футболка'}</span>
      <span class="o-total">${money(o.total)}</span>
      <span class="o-meta">${esc(o.name)}, ${fmtDate(o.createdAt)}</span>
      <span class="badge st-${o.status}" style="justify-self:end">${STATUS[o.status]}</span>
    </summary>
    <div class="a-order-body">
      <div class="o-contact">
        <a class="btn btn-sm" href="tel:${esc(tel)}">${icon.phone}${esc(fmtPhone(o.phone))}</a>
        <button class="btn btn-sm btn-soft" data-copy="${esc(o.phone)}">Скопировать номер</button>
      </div>
      ${o.comment ? `<div class="help"><b>Комментарий:</b> ${esc(o.comment)}</div>` : ''}
      ${groups ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${groups}</div>` : ''}
      <div class="o-files">${files}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
        ${o.type === 'request' ? '<span></span>' : `<a class="btn btn-ghost btn-sm" href="/api/admin/orders/${o.id}/zip" download>${icon.download}Скачать все файлы (ZIP)</a>`}
        <span class="muted small">${
          o.type === 'request'
            ? 'Заявка с сайта: перезвоните клиенту'
            : isPrint
            ? `${o.prints} ${plural(o.prints, 'отпечаток', 'отпечатка', 'отпечатков')}, без скидки ${money(o.subtotal)}${o.discount ? `, скидка ${money(o.discount)}` : ''}`
            : `${(o.items[0].stickers || []).length} ${plural((o.items[0].stickers || []).length, 'картинка', 'картинки', 'картинок')}. Картинки в архиве подписаны: где клеить и размер`
        }</span>
      </div>
      <div class="o-actions">
        <label class="field"><span>Статус</span><select class="select" name="status">${Object.entries(STATUS)
          .map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`)
          .join('')}</select></label>
        <label class="field"><span>Заметка для себя</span><input class="input" name="note" value="${esc(o.adminNote)}" placeholder="Например: позвонили, заберёт в пятницу"></label>
        <button class="btn" data-save="${o.id}">Сохранить</button>
      </div>
      <button class="btn btn-danger btn-sm" data-del="${o.id}" style="justify-self:start">${icon.trash}Удалить заказ</button>
    </div>
  </details>`;
}

// ================================================================ услуги
async function viewServices(body) {
  const list = await api('/api/admin/services');
  body.innerHTML = `
    <div class="admin-head"><h1>Услуги</h1><a class="btn" href="/admin/services/new">Новая услуга</a></div>
    <p class="muted" style="margin-bottom:16px;max-width:60ch">Каждая услуга — отдельная страница сайта. Порядок здесь = порядок на главной. Кнопка заказа появляется только у услуги, где выбрано действие «Заказать печать».</p>
    <div class="a-list" id="svc-list">${
      list.length
        ? list
            .map(
              (s, i) => `<div class="a-row" data-id="${s.id}">
          ${s.cover ? `<img src="${esc(s.cover)}" alt="">` : '<span class="noimg"></span>'}
          <div class="info"><b>${esc(s.title)}</b><small>${s.published ? 'Опубликована' : 'Черновик, не видна на сайте'}${s.action === 'print' ? ', с заказом печати' : s.action === 'tshirt' ? ', ведёт в конструктор футболок' : s.action === 'request' ? ', с формой заявки' : ''}</small></div>
          <div class="acts">
            <button class="icon-btn" data-mv="-1" aria-label="Выше" ${i === 0 ? 'disabled' : ''}>${icon.up}</button>
            <button class="icon-btn" data-mv="1" aria-label="Ниже" ${i === list.length - 1 ? 'disabled' : ''}>${icon.down}</button>
            <a class="icon-btn" href="/admin/services/${s.id}" aria-label="Редактировать">${icon.edit}</a>
          </div>
        </div>`
            )
            .join('')
        : '<div class="card empty"><strong>Услуг пока нет</strong>Создайте первую — например, «Фото на документы».</div>'
    }</div>`;
  $$('[data-mv]', body).forEach(
    (b) =>
      (b.onclick = async () => {
        const ids = list.map((s) => s.id);
        const id = Number(b.closest('.a-row').dataset.id);
        const i = ids.indexOf(id);
        const j = i + Number(b.dataset.mv);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await api('/api/admin/services/order', { method: 'POST', body: { ids } });
        await ctx.reloadSite();
        viewServices(body);
      })
  );
}

const BLOCKS = {
  heading: { name: 'Заголовок', make: () => ({ type: 'heading', text: '' }) },
  text: { name: 'Текст', make: () => ({ type: 'text', text: '' }) },
  image: { name: 'Фото', make: () => ({ type: 'image', src: '', caption: '' }) },
  gallery: { name: 'Галерея', make: () => ({ type: 'gallery', images: [] }) },
  prices: { name: 'Прайс', make: () => ({ type: 'prices', title: 'Цены', rows: [{ name: '', price: '', note: '' }] }) },
  print_prices: { name: 'Цены на печать (из настроек)', make: () => ({ type: 'print_prices', title: 'Цены на печать' }) },
  faq: { name: 'Вопросы и ответы', make: () => ({ type: 'faq', items: [{ q: '', a: '' }] }) },
  callout: { name: 'Выделенный блок', make: () => ({ type: 'callout', title: '', text: '' }) },
};

async function viewServiceEditor(idParam) {
  const body = $('#admin-body');
  const isNew = idParam === 'new';
  const svc = isNew
    ? { title: '', slug: '', summary: '', priceFrom: '', cover: '', action: 'none', published: true, blocks: [BLOCKS.text.make(), BLOCKS.prices.make()] }
    : await api('/api/admin/services/' + idParam);
  let dirty = false;
  const markDirty = () => (dirty = true);
  const beforeUnload = (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  ctx.onLeave(() => window.removeEventListener('beforeunload', beforeUnload));

  body.innerHTML = `
    <div class="admin-head"><h1>${isNew ? 'Новая услуга' : 'Редактирование'}</h1><a class="btn btn-ghost btn-sm" href="/admin/services">К списку</a></div>
    <div class="editor">
      <div class="card form" id="svc-main">
        <label class="field"><span>Название</span><input class="input" name="title" value="${esc(svc.title)}" placeholder="Фото на документы" required></label>
        <label class="field"><span>Короткое описание</span><textarea class="textarea" name="summary" placeholder="Видно в карточке на главной и под заголовком">${esc(svc.summary)}</textarea></label>
        <label class="field"><span>Цена в карточке</span><input class="input" name="priceFrom" value="${esc(svc.priceFrom)}" placeholder="от 350 ₽"></label>
        <div class="field"><span>Обложка</span>
          <div class="img-field">${svc.cover ? `<img class="preview" src="${esc(svc.cover)}" alt="">` : '<span class="preview"></span>'}
          <button type="button" class="btn btn-soft btn-sm" data-cover>${svc.cover ? 'Заменить' : 'Загрузить'}</button>
          ${svc.cover ? '<button type="button" class="btn btn-sm btn-danger" data-cover-rm>Убрать</button>' : ''}</div>
        </div>
        <label class="field"><span>Кнопка на странице</span>
          <select class="select" name="action">
            <option value="none" ${svc.action === 'none' ? 'selected' : ''}>Без кнопки</option>
            <option value="print" ${svc.action === 'print' ? 'selected' : ''}>Заказать печать</option>
            <option value="tshirt" ${svc.action === 'tshirt' ? 'selected' : ''}>Открыть конструктор футболок</option>
            <option value="request" ${svc.action === 'request' ? 'selected' : ''}>Форма заявки и телефон</option>
          </select></label>
        <label class="field"><span>Адрес страницы</span><input class="input" name="slug" value="${esc(svc.slug)}" placeholder="заполнится сам из названия"><small>Только латиница и дефисы: /service/${esc(svc.slug || '…')}</small></label>
        <label class="check"><input type="checkbox" name="published" ${svc.published ? 'checked' : ''}>Показывать на сайте</label>
        <details class="help" style="background:var(--cream-2)" ${svc.seoTitle || svc.seoDescription ? 'open' : ''}>
          <summary style="cursor:pointer;font-weight:800">Как услуга выглядит в поиске</summary>
          <div class="form" style="margin-top:12px">
            <label class="field"><span>Заголовок в поиске</span><input class="input" name="seoTitle" value="${esc(svc.seoTitle)}" maxlength="120" placeholder="Если пусто — возьмём название услуги"><span class="counter" data-for="seoTitle"></span></label>
            <label class="field"><span>Описание в поиске</span><textarea class="textarea" name="seoDescription" maxlength="300" placeholder="Если пусто — возьмём короткое описание">${esc(svc.seoDescription)}</textarea><span class="counter" data-for="seoDescription"></span></label>
            <div class="serp" id="serp"></div>
            <small class="muted">Так примерно будет в Яндексе и Google. Лучше всего: заголовок до 60 знаков, описание до 160. Картинка для превью ссылки в мессенджерах — обложка услуги.</small>
          </div>
        </details>
      </div>
      <div class="stack" style="gap:12px">
        <h2 style="font-size:22px">Содержимое страницы</h2>
        <div class="stack" style="gap:12px" id="blocks"></div>
        <div class="card" style="padding:16px"><div class="panel-lbl">Добавить блок</div><div class="add-blocks">${Object.entries(BLOCKS)
          .map(([k, b]) => `<button type="button" class="btn btn-soft btn-sm" data-add="${k}">${b.name}</button>`)
          .join('')}</div></div>
      </div>
    </div>
    <div class="save-bar">
      <button class="btn" id="save">Сохранить</button>
      <button class="btn btn-soft" id="preview">Предпросмотр</button>
    </div>
    ${!isNew ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px"><a class="btn btn-ghost btn-sm" href="/service/${esc(svc.slug)}" target="_blank" rel="noopener">Открыть на сайте</a><button class="btn btn-danger btn-sm" id="del">Удалить услугу</button></div>` : ''}`;

  const main = $('#svc-main');
  main.addEventListener('input', markDirty);
  const drawSerp = () => {
    const v = (n) => $(`[name="${n}"]`, main).value.trim();
    const title = v('seoTitle') || `${v('title') || 'Название услуги'} — ${state.site.salon.name}`;
    const desc = v('seoDescription') || v('summary') || 'Описание появится здесь';
    $('#serp').innerHTML = `<div class="u">${esc(location.host)} › service › ${esc(v('slug') || '…')}</div><div class="t">${esc(title.length > 62 ? title.slice(0, 60) + '…' : title)}</div><div class="d">${esc(desc.length > 162 ? desc.slice(0, 160) + '…' : desc)}</div>`;
    for (const [n, lim] of [['seoTitle', 60], ['seoDescription', 160]]) {
      const c = $(`.counter[data-for="${n}"]`, main);
      const len = v(n).length;
      c.textContent = `${len} / ${lim}`;
      c.classList.toggle('over', len > lim);
    }
  };
  main.addEventListener('input', drawSerp);
  drawSerp();
  $('[data-cover]', main).onclick = async () => {
    const [url] = await pickAndUpload();
    if (!url) return;
    svc.cover = url;
    const img = document.createElement('img');
    img.className = 'preview';
    img.src = url;
    $('.img-field .preview', main).replaceWith(img);
    markDirty();
  };
  const rmC = $('[data-cover-rm]', main);
  rmC && (rmC.onclick = () => ((svc.cover = ''), $('.img-field .preview', main).replaceWith(Object.assign(document.createElement('span'), { className: 'preview' })), rmC.remove(), markDirty()));

  const wrap = $('#blocks');
  const draw = () => {
    wrap.innerHTML = svc.blocks.map((b, i) => blockEditorHtml(b, i, svc.blocks.length)).join('') || '<div class="card empty">Добавьте первый блок ниже</div>';
  };
  draw();

  // Ввод текста в поля блоков
  wrap.addEventListener('input', (e) => {
    const t = e.target;
    const blk = t.closest('[data-b]');
    if (!blk || !t.dataset.f) return;
    const b = svc.blocks[Number(blk.dataset.b)];
    const row = t.closest('[data-r]');
    if (row) {
      const arr = b.type === 'faq' ? b.items : b.rows;
      arr[Number(row.dataset.r)][t.dataset.f] = t.value;
    } else b[t.dataset.f] = t.value;
    markDirty();
  });
  // Кнопки внутри блоков
  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-a]');
    if (!btn) return;
    const i = Number(btn.closest('[data-b]').dataset.b);
    const b = svc.blocks[i];
    const a = btn.dataset.a;
    if (a === 'up' && i > 0) [svc.blocks[i - 1], svc.blocks[i]] = [svc.blocks[i], svc.blocks[i - 1]];
    if (a === 'down' && i < svc.blocks.length - 1) [svc.blocks[i + 1], svc.blocks[i]] = [svc.blocks[i], svc.blocks[i + 1]];
    if (a === 'rm') {
      if (!confirm('Удалить этот блок?')) return;
      svc.blocks.splice(i, 1);
    }
    if (a === 'row-add') (b.type === 'faq' ? b.items : b.rows).push(b.type === 'faq' ? { q: '', a: '' } : { name: '', price: '', note: '' });
    if (a === 'row-rm') (b.type === 'faq' ? b.items : b.rows).splice(Number(btn.closest('[data-r]').dataset.r), 1);
    if (a === 'img') {
      const [url] = await pickAndUpload();
      if (!url) return;
      b.src = url;
    }
    if (a === 'gal-add') b.images.push(...(await pickAndUpload({ multiple: true })));
    if (a === 'gal-rm') b.images.splice(Number(btn.dataset.i), 1);
    markDirty();
    draw();
  });
  $$('[data-add]', body).forEach(
    (b) =>
      (b.onclick = () => {
        svc.blocks.push(BLOCKS[b.dataset.add].make());
        markDirty();
        draw();
        wrap.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
  );

  const collect = () => {
    const val = (n) => $(`[name="${n}"]`, main);
    return {
      title: val('title').value,
      summary: val('summary').value,
      priceFrom: val('priceFrom').value,
      action: val('action').value,
      slug: val('slug').value,
      published: val('published').checked,
      cover: svc.cover,
      blocks: svc.blocks,
      sort: svc.sort || 0,
      seoTitle: val('seoTitle').value,
      seoDescription: val('seoDescription').value,
    };
  };

  $('#preview').onclick = () => {
    const d = collect();
    openSheet(
      `<div class="sheet-head"><h2>${esc(d.title || 'Без названия')}</h2><button class="icon-btn" data-close aria-label="Закрыть">${icon.close}</button></div>
       ${d.summary ? `<p class="muted" style="margin-bottom:16px">${esc(d.summary)}</p>` : ''}<div class="blocks" style="padding:0">${ctx.renderBlocks(d.blocks)}</div>`,
      { label: 'Предпросмотр' }
    );
  };
  $('#save').onclick = async () => {
    const d = collect();
    if (!d.title.trim()) return toast('Укажите название услуги', true);
    try {
      const saved = await api(isNew ? '/api/admin/services' : '/api/admin/services/' + svc.id, { method: isNew ? 'POST' : 'PUT', body: d });
      dirty = false;
      toast('Услуга сохранена');
      await ctx.reloadSite();
      if (isNew) ctx.go('/admin/services/' + saved.id, { replace: true });
      else {
        Object.assign(svc, saved);
        $('[name="slug"]', main).value = saved.slug;
      }
    } catch (e) {
      toast(e.message, true);
    }
  };
  const del = $('#del');
  del &&
    (del.onclick = async () => {
      if (!confirm(`Удалить услугу «${svc.title}»? Страница пропадёт с сайта.`)) return;
      await api('/api/admin/services/' + svc.id, { method: 'DELETE' });
      dirty = false;
      await ctx.reloadSite();
      toast('Услуга удалена');
      ctx.go('/admin/services');
    });
}

function blockEditorHtml(b, i, n) {
  const head = `<div class="blk-head"><b>${BLOCKS[b.type].name}</b>
    <button type="button" class="icon-btn" data-a="up" aria-label="Выше" ${i === 0 ? 'disabled' : ''}>${icon.up}</button>
    <button type="button" class="icon-btn" data-a="down" aria-label="Ниже" ${i === n - 1 ? 'disabled' : ''}>${icon.down}</button>
    <button type="button" class="icon-btn" data-a="rm" aria-label="Удалить блок">${icon.trash}</button></div>`;
  let inner = '';
  switch (b.type) {
    case 'heading':
      inner = `<input class="input" data-f="text" value="${esc(b.text)}" placeholder="Текст заголовка">`;
      break;
    case 'text':
      inner = `<textarea class="textarea" data-f="text" rows="6" placeholder="Текст">${esc(b.text)}</textarea>
        <small class="muted">Пустая строка — новый абзац. «- » в начале строки — пункт списка. **так** — жирный. [текст](https://ссылка) — ссылка.</small>`;
      break;
    case 'image':
      inner = `<div class="img-field">${b.src ? `<img class="preview" src="${esc(b.src)}" alt="">` : '<span class="preview"></span>'}<button type="button" class="btn btn-soft btn-sm" data-a="img">${b.src ? 'Заменить фото' : 'Загрузить фото'}</button></div>
        <input class="input" data-f="caption" value="${esc(b.caption)}" placeholder="Подпись (необязательно)">`;
      break;
    case 'gallery':
      inner = `<div class="gal-edit">${b.images.map((src, k) => `<div><img src="${esc(src)}" alt=""><button type="button" data-a="gal-rm" data-i="${k}" aria-label="Убрать">×</button></div>`).join('')}</div>
        <button type="button" class="btn btn-soft btn-sm" data-a="gal-add">Добавить фото</button>`;
      break;
    case 'prices':
      inner = `<input class="input" data-f="title" value="${esc(b.title)}" placeholder="Заголовок прайса">
        <div class="blk-rows">${b.rows
          .map(
            (r, k) => `<div class="blk-row" data-r="${k}"><input class="input" data-f="name" value="${esc(r.name)}" placeholder="Название"><input class="input" data-f="price" value="${esc(r.price)}" placeholder="500 ₽"><button type="button" class="icon-btn" data-a="row-rm" aria-label="Удалить строку">${icon.trash}</button>
            <input class="input" data-f="note" value="${esc(r.note)}" placeholder="Пояснение (необязательно)" style="grid-column:1/3"></div>`
          )
          .join('')}</div>
        <button type="button" class="btn btn-soft btn-sm" data-a="row-add">Добавить строку</button>`;
      break;
    case 'print_prices':
      inner = `<input class="input" data-f="title" value="${esc(b.title)}" placeholder="Заголовок">
        <small class="muted">Таблица цен на печать подставится сама из раздела «Настройки». Меняете цены там — меняются и здесь.</small>`;
      break;
    case 'faq':
      inner = `<div class="blk-rows">${b.items
        .map(
          (r, k) => `<div class="blk-row faq-row" data-r="${k}"><input class="input" data-f="q" value="${esc(r.q)}" placeholder="Вопрос"><button type="button" class="icon-btn" data-a="row-rm" aria-label="Удалить вопрос">${icon.trash}</button>
          <textarea class="textarea" data-f="a" placeholder="Ответ" style="grid-column:1/2;min-height:72px">${esc(r.a)}</textarea></div>`
        )
        .join('')}</div>
        <button type="button" class="btn btn-soft btn-sm" data-a="row-add">Добавить вопрос</button>`;
      break;
    case 'callout':
      inner = `<input class="input" data-f="title" value="${esc(b.title)}" placeholder="Заголовок">
        <textarea class="textarea" data-f="text" placeholder="Текст">${esc(b.text)}</textarea>`;
      break;
  }
  return `<div class="blk" data-b="${i}">${head}${inner}</div>`;
}

// ================================================================ шаблоны футболок
async function viewTemplates(body) {
  const list = await api('/api/admin/templates');
  const KIND = { tee: 'Футболка', oversize: 'Оверсайз', long: 'Лонгслив' };
  body.innerHTML = `
    <div class="admin-head"><h1>Модели футболок</h1><a class="btn" href="/admin/templates/new">Новая модель</a></div>
    <div class="help" style="margin-bottom:16px">
      <b>Модель — это фасон и цвет футболки в 3D-конструкторе.</b> Фотографии не нужны: футболка рисуется сама.
      Выберите фасон (футболка, оверсайз, лонгслив), цвет, цену и размеры в наличии. Каждый цвет — отдельная модель.
    </div>
    <div class="a-list">${
      list.length
        ? list
            .map(
              (t) => `<a class="a-row" href="/admin/templates/${t.id}" style="text-decoration:none;color:inherit">
          <span class="noimg" style="background:${esc(t.color)};box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)"></span>
          <div class="info"><b>${esc(t.name)}</b><small>${KIND[t.kind] || ''}, ${money(t.price)}, ${t.sizes.join(', ')}${t.active ? '' : ', скрыта'}</small></div>
          <span class="icon-btn">${icon.edit}</span></a>`
            )
            .join('')
        : '<div class="card empty"><strong>Моделей нет</strong>Без них конструктор футболок не работает.</div>'
    }</div>`;
}

async function viewTemplateEditor(idParam) {
  const body = $('#admin-body');
  const isNew = idParam === 'new';
  const sizesAll = state.site.pricing.tshirt.sizes.map((s) => s.name);
  let t;
  if (isNew) t = { name: '', kind: 'tee', color: '#F4F2EE', price: 0, sizes: sizesAll.slice(), active: true, sort: 0 };
  else {
    const all = await api('/api/admin/templates');
    t = all.find((x) => x.id === Number(idParam));
    if (!t) throw new Error('Модель не найдена');
  }
  const presets = [
    '#FFFFFF', '#F4F2EE', '#E8D9C4', '#C9B79C', '#8A8A8A', '#4A4A4F', '#24222A', '#000000',
    '#F2A7B8', '#E85A8C', '#C8352E', '#F07A3A', '#F6C744', '#FFF1A8', '#B9D440', '#6FA35A',
    '#2F5D46', '#9FD3C7', '#3FA7C9', '#9FB7D9', '#2C4A8A', '#1F2B4A', '#BC9BF3', '#7360F9',
  ];

  body.innerHTML = `
    <div class="admin-head"><h1>${isNew ? 'Новая модель' : esc(t.name)}</h1><a class="btn btn-ghost btn-sm" href="/admin/templates">К списку</a></div>
    <div class="editor">
      <div class="card form" id="tpl-form">
        <label class="field"><span>Название</span><input class="input" name="name" value="${esc(t.name)}" placeholder="Белая футболка" required></label>
        <label class="field"><span>Фасон</span><select class="select" name="kind">
          <option value="tee" ${t.kind === 'tee' ? 'selected' : ''}>Футболка</option>
          <option value="oversize" ${t.kind === 'oversize' ? 'selected' : ''}>Оверсайз</option>
          <option value="long" ${t.kind === 'long' ? 'selected' : ''}>Лонгслив</option>
        </select></label>
        <div class="field"><span>Цвет</span>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <input type="color" name="color" value="${esc(t.color)}" aria-label="Выбрать любой цвет">
            <input class="input" name="hex" value="${esc(t.color.toUpperCase())}" maxlength="7" style="max-width:130px;font-family:monospace" aria-label="Код цвета">
          </div>
          <div class="chips" style="margin-top:8px">${presets.map((c) => `<button type="button" class="swatch" data-c="${c}" style="width:34px;height:34px;border:0;cursor:pointer;background:${c}" aria-label="Цвет ${c}"></button>`).join('')}</div>
          <small>Нажмите на большой квадрат — откроется палитра с любым цветом. Или вставьте код цвета, например #FF6B9D</small>
        </div>
        <label class="field"><span>Цена футболки с одной картинкой, ${esc(state.site.pricing.currency)}</span><input class="input" name="price" type="number" inputmode="decimal" min="0" step="1" value="${t.price}"><small>Доплата за размер и за каждую следующую картинку — в «Настройках»</small></label>
        <div class="field"><span>Размеры в наличии</span><div class="chips">${sizesAll
          .map((s) => `<label class="chip chip-sm"><input type="checkbox" name="sizes" value="${esc(s)}" ${t.sizes.includes(s) ? 'checked' : ''}><span>${esc(s)}</span></label>`)
          .join('')}</div></div>
        <label class="field"><span>Порядок</span><input class="input" name="sort" type="number" value="${t.sort}"><small>Меньше число — выше в списке</small></label>
        <label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}>Показывать в конструкторе</label>
      </div>
      <div class="stack" style="gap:12px">
        <h2 style="font-size:22px">Как увидит клиент</h2>
        <div class="tpl-preview"><canvas></canvas></div>
        <p class="muted small">Футболку можно покрутить мышкой или пальцем.</p>
      </div>
    </div>
    <div class="save-bar"><button class="btn" id="save">Сохранить</button></div>
    ${!isNew ? '<button class="btn btn-danger btn-sm" id="del" style="margin-top:8px">Удалить модель</button>' : ''}`;

  const f = $('#tpl-form');
  let t3 = null;
  try {
    const m = await import('./tee3d.js?v=7');
    if (m.webglSupported()) {
      const cv = $('.tpl-preview canvas');
      t3 = m.createTee(cv, { color: t.color, kind: t.kind });
      t3.setAuto(true);
      ctx.onLeave(() => t3.destroy());
      let last = null;
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId);
        last = e.clientX;
        t3.setAuto(false);
      });
      cv.addEventListener('pointermove', (e) => {
        if (last == null) return;
        t3.rotate((e.clientX - last) * 0.01);
        last = e.clientX;
      });
      cv.addEventListener('pointerup', () => (last = null));
    }
  } catch {}
  const setColor = (c) => {
    $('[name="color"]', f).value = c;
    $('[name="hex"]', f).value = c.toUpperCase();
    t3 && t3.setColor(c);
  };
  f.addEventListener('input', (e) => {
    if (e.target.name === 'color') setColor(e.target.value);
    if (e.target.name === 'hex') {
      let v = e.target.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        $('[name="color"]', f).value = v.toLowerCase();
        t3 && t3.setColor(v);
      }
    }
    if (e.target.name === 'kind' && t3) t3.setKind(e.target.value);
  });
  f.addEventListener('change', (e) => t3 && e.target.name === 'kind' && t3.setKind(e.target.value));
  $$('[data-c]', f).forEach(
    (b) =>
      (b.onclick = () => setColor(b.dataset.c.toLowerCase()))
  );

  $('#save').onclick = async () => {
    const data = {
      name: $('[name="name"]', f).value,
      kind: $('[name="kind"]', f).value,
      color: $('[name="color"]', f).value,
      price: Number($('[name="price"]', f).value),
      sort: Number($('[name="sort"]', f).value),
      active: $('[name="active"]', f).checked,
      sizes: $$('[name="sizes"]:checked', f).map((x) => x.value),
    };
    try {
      const saved = await api(isNew ? '/api/admin/templates' : '/api/admin/templates/' + t.id, { method: isNew ? 'POST' : 'PUT', body: data });
      toast('Модель сохранена');
      if (isNew) ctx.go('/admin/templates/' + saved.id, { replace: true });
    } catch (e) {
      toast(e.message, true);
    }
  };
  const del = $('#del');
  del &&
    (del.onclick = async () => {
      if (!confirm(`Удалить модель «${t.name}»? Старые заказы останутся.`)) return;
      await api('/api/admin/templates/' + t.id, { method: 'DELETE' });
      toast('Модель удалена');
      ctx.go('/admin/templates');
    });
}

// ================================================================ настройки
async function viewSettings(body) {
  const s = await api('/api/admin/settings');
  const salon = s.salon;
  const pr = s.pricing;
  const cur = esc(pr.currency);

  body.innerHTML = `
    <div class="admin-head"><h1>Настройки</h1></div>
    <div class="stack">
      <section class="card form" id="salon-form">
        <h2 style="font-size:22px">Салон и контакты</h2>
        <div class="grid-2">
          <label class="field"><span>Название</span><input class="input" name="name" value="${esc(salon.name)}"></label>
          <label class="field"><span>Подпись к названию</span><input class="input" name="tagline" value="${esc(salon.tagline)}" placeholder="Фотосалон"></label>
          <label class="field"><span>Телефон</span><input class="input" name="phone" type="tel" value="${esc(salon.phone)}" placeholder="+7 900 000-00-00"></label>
          <label class="field"><span>Часы работы</span><input class="input" name="hours" value="${esc(salon.hours)}" placeholder="Пн–Пт 10:00–20:00, Сб 11:00–18:00"></label>
          <label class="field"><span>Адрес</span><input class="input" name="address" value="${esc(salon.address)}" placeholder="ул. Ленина, 1"></label>
          <label class="field"><span>Ссылка на карту</span><input class="input" name="mapUrl" value="${esc(salon.mapUrl)}" placeholder="https://yandex.ru/maps/..."><small>Откройте салон в Яндекс или Google Картах, нажмите «Поделиться» и вставьте ссылку</small></label>
          <label class="field"><span>Почта</span><input class="input" name="email" type="email" value="${esc(salon.email)}"></label>
          <label class="field"><span>Telegram</span><input class="input" name="telegram" value="${esc(salon.telegram)}" placeholder="@obektiv"></label>
          <label class="field"><span>ВКонтакте</span><input class="input" name="vk" value="${esc(salon.vk)}" placeholder="https://vk.com/..."></label>
          <label class="field"><span>MAX</span><input class="input" name="max" value="${esc(salon.max)}" placeholder="https://max.ru/..."><small>В MAX откройте свой профиль или канал → «Поделиться» → скопируйте ссылку</small></label>
          <label class="field"><span>WhatsApp</span><input class="input" name="whatsapp" value="${esc(salon.whatsapp)}" placeholder="+7 900 000-00-00"><small>Номер или ссылка wa.me</small></label>
        </div>
        <label class="field"><span>Заголовок на главной</span><input class="input" name="heroTitle" value="${esc(salon.heroTitle)}"></label>
        <label class="field"><span>Текст под заголовком</span><textarea class="textarea" name="heroText">${esc(salon.heroText)}</textarea></label>
        <h3 style="margin-top:8px">Поиск и превью ссылок</h3>
        <div class="grid-2">
          <label class="field"><span>Город</span><input class="input" name="city" value="${esc(salon.city)}" placeholder="Казани"><small>Как во фразе «печать фото в …» — добавится в заголовки для поиска</small></label>
          <label class="field"><span>Описание сайта для поиска</span><textarea class="textarea" name="seoDescription" maxlength="300" placeholder="Если пусто — возьмём текст под заголовком">${esc(salon.seoDescription)}</textarea></label>
          <label class="field"><span>Код Яндекс Вебмастера</span><input class="input" name="yandexVerification" value="${esc(salon.yandexVerification)}" placeholder="например 4a1b2c3d4e5f6a7b"><small>Из мета-тега, который даст Вебмастер: только значение content</small></label>
          <label class="field"><span>Код Google Search Console</span><input class="input" name="googleVerification" value="${esc(salon.googleVerification)}"><small>Так же: только значение content</small></label>
        </div>
        <div class="field"><span>Картинка превью ссылки (для мессенджеров)</span>
          <div class="img-field"><img class="preview" id="og-prev" src="${esc(salon.ogImage || '/img/og.png')}" alt="" style="width:160px;height:84px">
          <button type="button" class="btn btn-soft btn-sm" id="og-up">Загрузить свою</button>
          ${salon.ogImage ? '<button type="button" class="btn btn-danger btn-sm" id="og-rm">Вернуть стандартную</button>' : ''}</div>
          <small>Лучше всего горизонтальная, 1200×630. Для страниц услуг используется их обложка</small>
        </div>
        <div class="field"><span>Картинка карточки «Футболка со своим принтом» в услугах</span>
          <div class="img-field">${salon.teeCover ? `<img class="preview" id="tee-cover" src="${esc(salon.teeCover)}" alt="">` : '<span class="preview" id="tee-cover"></span>'}
          <button type="button" class="btn btn-soft btn-sm" id="tee-cover-up">${salon.teeCover ? 'Заменить' : 'Загрузить'}</button>
          ${salon.teeCover ? '<button type="button" class="btn btn-danger btn-sm" id="tee-cover-rm">Убрать</button>' : ''}</div>
          <small>Лучше вертикальная, примерно 4:5. Пока картинки нет, стоит узор</small>
        </div>
        <div class="field"><span>Фото на главной (до 2 штук, в рамках-полароидах)</span>
          <div class="gal-edit" id="hero-photos" style="max-width:280px"></div>
          <button type="button" class="btn btn-soft btn-sm" id="hero-add" style="align-self:start">Добавить фото</button>
          <small>Пока фото нет, в рамках стоят цветные узоры</small>
        </div>
        <button class="btn" id="save-salon" style="align-self:start">Сохранить контакты и картинки</button>
      </section>

      <section class="card form" id="price-form">
        <h2 style="font-size:22px">Цены</h2>
        <p class="muted small">Цены на сайте считаются автоматически по этой таблице. У каждого формата четыре цены за отпечаток: обычная бумага ЧБ, обычная бумага цветная, глянцевая и матовая фотобумага.</p>

        <div><div class="panel-lbl">Форматы печати</div>
          <div class="set-table" id="fmt-rows"></div>
          <button type="button" class="btn btn-soft btn-sm" id="fmt-add" style="margin-top:8px">Добавить формат</button>
          <p class="muted small" style="margin-top:6px">0 или пусто — такого варианта нет (например, А6 только на фотобумаге). Ширина и высота в сантиметрах нужны, чтобы предупредить клиента о слишком маленьком фото.</p>
        </div>

        <div class="grid-2">
          <label class="field"><span>Скидка на каждый N-й отпечаток</span><input class="input" name="discountEvery" type="number" min="0" value="${pr.print.discountEvery}"><small>0 — скидка выключена</small></label>
          <label class="field"><span>Размер скидки, %</span><input class="input" name="discountPercent" type="number" min="0" max="100" value="${pr.print.discountPercent}"></label>
        </div>

        <div><div class="panel-lbl">Размеры футболок и доплата</div>
          <div class="set-table" id="size-rows"></div>
          <button type="button" class="btn btn-soft btn-sm" id="size-add" style="margin-top:8px">Добавить размер</button>
          <p class="muted small" style="margin-top:6px">Базовая цена футболки задаётся в каждой модели.</p>
          <label class="field" style="margin-top:12px;max-width:320px"><span>Доплата за каждую картинку после первой, ${cur}</span><input class="input" name="stickerExtra" type="number" min="0" value="${pr.tshirt.stickerExtra || 0}"><small>0 — сколько угодно картинок за одну цену</small></label>
        </div>

        <label class="field" style="max-width:160px"><span>Валюта</span><input class="input" name="currency" value="${cur}"></label>
        <button class="btn" id="save-price" style="align-self:start">Сохранить цены</button>
      </section>

      <section class="card form" id="fonts-box">
        <h2 style="font-size:22px">Шрифты</h2>
        <p class="muted small">Выберите шрифт для заголовков и для текста. Все шрифты из списка поддерживают русские буквы.</p>
        <div class="grid-2">
          <label class="field"><span>Заголовки</span><select class="select" id="f-display"></select></label>
          <label class="field"><span>Основной текст</span><select class="select" id="f-body"></select></label>
        </div>
        <details>
          <summary style="cursor:pointer;font-weight:700;font-size:14px">Хочу другой шрифт с Google Fonts</summary>
          <div class="grid-2" style="margin-top:12px">
            <label class="field"><span>Заголовки: название</span><input class="input" id="f-display-custom" placeholder="например Bad Script"></label>
            <label class="field"><span>Текст: название</span><input class="input" id="f-body-custom" placeholder="например Ubuntu"></label>
          </div>
          <small class="muted">Откройте fonts.google.com, в фильтре «Language» выберите Cyrillic, скопируйте название шрифта латиницей. Если поле заполнено, оно важнее списка выше.</small>
        </details>
        <div id="font-preview" style="border-radius:var(--r-lg);padding:24px;background:var(--cream);display:grid;gap:12px">
          <div data-pv="d" style="font-size:clamp(30px,6vw,52px);line-height:1;text-transform:uppercase;letter-spacing:-0.03em;color:var(--violet)">Печать фото</div>
          <div data-pv="d2" style="font-size:22px;line-height:1.2">Футболка с твоим принтом</div>
          <p data-pv="b" style="font-size:16px;line-height:1.55;color:var(--ink-2)">Загрузите снимки с телефона, выберите формат и бумагу — заберёте готовые отпечатки в салоне. Оплата при получении. 0123456789 ₽</p>
        </div>
        <button class="btn" id="save-fonts" style="align-self:start">Сохранить шрифты</button>
      </section>

      <section class="card form" id="admins-box">
        <h2 style="font-size:22px">Администраторы</h2>
        <p class="muted small">Администратор входит на сайт со своим номером и паролем, как обычный клиент, и видит админку. Человек должен сначала зарегистрироваться на сайте.</p>
        <div class="a-list" id="admins"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="input" id="admin-phone" type="tel" inputmode="tel" placeholder="+7 (900) 000-00-00" style="flex:1;min-width:200px">
          <button type="button" class="btn" id="admin-add">Сделать админом</button>
        </div>
      </section>

      <section class="card form" id="verify-box">
        <h2 style="font-size:22px">Подтверждение номера при регистрации</h2>
        <p class="muted small">Клиент получает 4-значный код и вводит его на сайте. Так зарегистрироваться с чужим или выдуманным номером не получится.</p>
        <div class="chips" id="v-method">${[
          ['off', 'Выключено'],
          ['call', 'Звонок'],
          ['sms', 'SMS'],
          ['whatsapp', 'WhatsApp'],
          ['max', 'MAX'],
        ]
          .map(([k, t]) => `<label class="chip chip-sm"><input type="radio" name="vmethod" value="${k}" ${s.verify.method === k ? 'checked' : ''}><span>${t}</span></label>`)
          .join('')}</div>
        <div class="help" data-v="call sms">
          <b>Звонок и SMS — через SMS.ru.</b> Звонок дешевле: сервис звонит клиенту и сразу сбрасывает, а код — последние 4 цифры номера, с которого звонили.
          <ol><li>Зарегистрируйтесь на sms.ru и пополните баланс.</li><li>В личном кабинете откройте раздел для программистов и скопируйте api_id.</li></ol>
        </div>
        <label class="field" data-v="call sms"><span>api_id из SMS.ru</span><input class="input" name="smsruApiId" value="${esc(s.verify.smsruApiId)}" autocomplete="off" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"></label>
        <div class="help" data-v="whatsapp max">
          <b>WhatsApp и MAX — через сервис GREEN-API.</b> Код приходит сообщением с вашего номера, как будто вы написали клиенту сами.
          <ol><li>Зарегистрируйтесь на green-api.com и создайте инстанс: для WhatsApp или для MAX.</li><li>Привяжите к нему телефон салона: отсканируйте QR-код в приложении.</li><li>Скопируйте из кабинета apiUrl, idInstance и apiTokenInstance.</li></ol>
          Для рассылки лучше завести отдельный номер: мессенджеры иногда блокируют номера, которые много пишут незнакомым людям.
        </div>
        <div class="grid-2" data-v="whatsapp max">
          <label class="field"><span>apiUrl</span><input class="input" name="greenApiUrl" value="${esc(s.verify.greenApiUrl)}" placeholder="https://1103.api.green-api.com"></label>
          <label class="field"><span>idInstance</span><input class="input" name="greenId" value="${esc(s.verify.greenId)}"></label>
        </div>
        <label class="field" data-v="whatsapp max"><span>apiTokenInstance</span><input class="input" name="greenToken" value="${esc(s.verify.greenToken)}" autocomplete="off"></label>
        <button class="btn" id="save-verify" style="align-self:start">Сохранить</button>
      </section>
    </div>`;

  // --- шрифты
  const F = s.fonts;
  const loaded = new Set();
  const loadFont = (name, weights) => {
    const key = name + weights;
    if (!name || loaded.has(key)) return;
    loaded.add(key);
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}${weights ? ':wght@' + weights : ''}&display=swap`;
    document.head.appendChild(l);
  };
  const opt = (f, cur) => `<option value="${esc(f.name)}" ${f.name === cur ? 'selected' : ''}>${esc(f.name)}${f.note ? ' — ' + esc(f.note) : ''}</option>`;
  const curD = salon.fontDisplay || F.defaultDisplay;
  const curB = salon.fontBody || F.defaultBody;
  const inD = F.display.some((f) => f.name === curD);
  const inB = F.body.some((f) => f.name === curB);
  $('#f-display').innerHTML = F.display.map((f) => opt(f, curD)).join('');
  $('#f-body').innerHTML = F.body.map((f) => opt(f, curB)).join('');
  if (!inD) $('#f-display-custom').value = curD;
  if (!inB) $('#f-body-custom').value = curB;
  const chosen = () => ({
    d: $('#f-display-custom').value.trim() || $('#f-display').value,
    b: $('#f-body-custom').value.trim() || $('#f-body').value,
  });
  const preview = () => {
    const { d, b } = chosen();
    const fd = F.display.find((f) => f.name === d) || F.body.find((f) => f.name === d);
    const fb = F.body.find((f) => f.name === b) || F.display.find((f) => f.name === b);
    loadFont(d, fd ? fd.weights.join(';') : '');
    loadFont(b, fb ? fb.weights.join(';') : '');
    const dw = fd ? Math.min(800, Math.max(...fd.weights)) : 400;
    $$('#font-preview [data-pv="d"], #font-preview [data-pv="d2"]').forEach((el) => {
      el.style.fontFamily = `'${d}', system-ui, sans-serif`;
      el.style.fontWeight = dw;
    });
    $('#font-preview [data-pv="b"]').style.fontFamily = `'${b}', system-ui, sans-serif`;
  };
  ['#f-display', '#f-body'].forEach((id) => ($(id).onchange = preview));
  let pt;
  ['#f-display-custom', '#f-body-custom'].forEach((id) => ($(id).oninput = () => (clearTimeout(pt), (pt = setTimeout(preview, 500)))));
  preview();

  // --- администраторы
  const drawAdmins = async () => {
    const list = await api('/api/admin/admins');
    $('#admins').innerHTML = list
      .map(
        (a) => `<div class="a-row"><span class="noimg" style="display:grid;place-items:center;font-weight:800">${esc((a.name || '?')[0])}</span>
        <div class="info"><b>${esc(a.phone === 'admin' ? 'Запасной вход (логин admin)' : a.name)}</b><small>${esc(a.phone === 'admin' ? 'пароль из терминала' : fmtPhone(a.phone))}${a.id === state.user.id ? ', это вы' : ''}</small></div>
        ${a.phone !== 'admin' && a.id !== state.user.id ? `<button class="btn btn-danger btn-sm" data-unadmin="${a.id}">Убрать</button>` : ''}</div>`
      )
      .join('');
  };
  await drawAdmins();
  $('#admins').onclick = async (e) => {
    const b = e.target.closest('[data-unadmin]');
    if (!b || !confirm('Убрать права администратора?')) return;
    try {
      await api('/api/admin/admins/' + b.dataset.unadmin, { method: 'DELETE' });
      drawAdmins();
    } catch (ex) {
      toast(ex.message, true);
    }
  };
  $('#admin-phone').addEventListener('input', (e) => (e.target.value = window.Validate.formatPhone(e.target.value)));
  $('#admin-add').onclick = async () => {
    try {
      const r = await api('/api/admin/admins', { method: 'POST', body: { phone: $('#admin-phone').value } });
      toast(`${r.name} теперь администратор`);
      $('#admin-phone').value = '';
      drawAdmins();
    } catch (ex) {
      toast(ex.message, true);
    }
  };
  const vbox = $('#verify-box');
  const vShow = () => {
    const m = $('[name="vmethod"]:checked', vbox).value;
    $$('[data-v]', vbox).forEach((el) => el.classList.toggle('hidden', !el.dataset.v.split(' ').includes(m)));
  };
  $('#v-method').onchange = vShow;
  vShow();
  $('#save-verify').onclick = async () => {
    const val = (n) => $(`[name="${n}"]`, vbox).value.trim();
    try {
      await api('/api/admin/settings/verify', {
        method: 'PUT',
        body: { method: $('[name="vmethod"]:checked', vbox).value, smsruApiId: val('smsruApiId'), greenApiUrl: val('greenApiUrl'), greenId: val('greenId'), greenToken: val('greenToken') },
      });
      await ctx.reloadSite();
      toast('Сохранено');
    } catch (ex) {
      toast(ex.message, true);
    }
  };

  // --- фото на главной
  const heroBox = $('#hero-photos');
  const drawHero = () => {
    heroBox.innerHTML = salon.heroPhotos.map((src, i) => `<div><img src="${esc(src)}" alt=""><button type="button" data-i="${i}" aria-label="Убрать">×</button></div>`).join('');
    $('#hero-add').classList.toggle('hidden', salon.heroPhotos.length >= 2);
  };
  drawHero();
  heroBox.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    salon.heroPhotos.splice(Number(b.dataset.i), 1);
    drawHero();
  };
  $('#hero-add').onclick = async () => {
    const urls = await pickAndUpload({ multiple: true, max: 1400 });
    salon.heroPhotos = salon.heroPhotos.concat(urls).slice(0, 2);
    drawHero();
  };
  $('#tee-cover-up').onclick = async () => {
    const [url] = await pickAndUpload({ max: 1400 });
    if (!url) return;
    salon.teeCover = url;
    const img = document.createElement('img');
    img.className = 'preview';
    img.id = 'tee-cover';
    img.src = url;
    $('#tee-cover').replaceWith(img);
    toast('Не забудьте нажать «Сохранить контакты»');
  };
  const teeRm = $('#tee-cover-rm');
  teeRm &&
    (teeRm.onclick = () => {
      salon.teeCover = '';
      $('#tee-cover').replaceWith(Object.assign(document.createElement('span'), { className: 'preview', id: 'tee-cover' }));
      teeRm.remove();
      toast('Не забудьте нажать «Сохранить контакты»');
    });
  $('#og-up').onclick = async () => {
    const [url] = await pickAndUpload({ max: 1600 });
    if (!url) return;
    salon.ogImage = url;
    $('#og-prev').src = url;
    toast('Не забудьте сохранить');
  };
  const ogRm = $('#og-rm');
  ogRm && (ogRm.onclick = () => ((salon.ogImage = ''), ($('#og-prev').src = '/img/og.png'), ogRm.remove()));
  const saveSalon = async (msg) => {
    const f = $('#salon-form');
    const { d, b } = chosen();
    const data = { heroPhotos: salon.heroPhotos, ogImage: salon.ogImage || '', teeCover: salon.teeCover || '', fontDisplay: d, fontBody: b };
    $$('input[name], textarea[name]', f).forEach((i) => (data[i.name] = i.value));
    try {
      await api('/api/admin/settings/salon', { method: 'PUT', body: data });
      await ctx.reloadSite();
      toast(msg);
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    }
  };
  $('#save-salon').onclick = () => saveSalon('Контакты сохранены');
  $('#save-fonts').onclick = async () => {
    if (await saveSalon('Шрифты сохранены, обновляем страницу…')) setTimeout(() => location.reload(), 800);
  };

  // --- таблицы цен
  const rowsCfg = {
    fmt: {
      list: pr.print.formats,
      head: `<div class="set-row fmt head"><span>Название</span><span>Шир., см</span><span>Выс., см</span><span>Обычн. ЧБ, ${cur}</span><span>Обычн. цвет, ${cur}</span><span>Глянце&shy;вая, ${cur}</span><span>Мато&shy;вая, ${cur}</span><span></span></div>`,
      row: (r, i) =>
        `<div class="set-row fmt" data-i="${i}"><input class="input" data-k="name" value="${esc(r.name)}" placeholder="А4"><input class="input" data-k="wcm" type="number" inputmode="decimal" value="${r.wcm}"><input class="input" data-k="hcm" type="number" inputmode="decimal" value="${r.hcm}">${['priceBw', 'priceColor', 'priceGlossy', 'priceMatte']
          .map((k) => `<input class="input" data-k="${k}" type="number" inputmode="decimal" min="0" value="${Number(r[k]) || 0}">`)
          .join('')}<button type="button" class="icon-btn" data-rm aria-label="Удалить">${icon.trash}</button></div>`,
      make: () => ({ id: '', name: '', wcm: 21, hcm: 29.7, priceBw: 0, priceColor: 0, priceGlossy: 0, priceMatte: 0 }),
    },
    size: {
      list: pr.tshirt.sizes,
      head: `<div class="set-row head"><span>Размер</span><span>Доплата, ${cur}</span><span></span></div>`,
      row: (r, i) =>
        `<div class="set-row" data-i="${i}"><input class="input" data-k="name" value="${esc(r.name)}"><input class="input" data-k="extra" type="number" inputmode="decimal" value="${r.extra}"><button type="button" class="icon-btn" data-rm aria-label="Удалить">${icon.trash}</button></div>`,
      make: () => ({ name: '', extra: 0 }),
    },
  };
  for (const [key, cfg] of Object.entries(rowsCfg)) {
    const box = $(`#${key}-rows`);
    const draw = () => (box.innerHTML = cfg.head + cfg.list.map(cfg.row).join(''));
    draw();
    box.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const r = cfg.list[Number(e.target.closest('[data-i]').dataset.i)];
      r[k] = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    });
    box.addEventListener('click', (e) => {
      if (!e.target.closest('[data-rm]')) return;
      if (cfg.list.length <= 1) return toast('Должна остаться хотя бы одна строка', true);
      cfg.list.splice(Number(e.target.closest('[data-i]').dataset.i), 1);
      draw();
    });
    $(`#${key}-add`).onclick = () => {
      cfg.list.push(cfg.make());
      draw();
      $('[data-i]:last-child input', box).focus();
    };
  }

  $('#save-price').onclick = async () => {
    const f = $('#price-form');
    const data = {
      currency: $('[name="currency"]', f).value,
      print: {
        formats: pr.print.formats,
        discountEvery: Number($('[name="discountEvery"]', f).value),
        discountPercent: Number($('[name="discountPercent"]', f).value),
      },
      tshirt: { sizes: pr.tshirt.sizes, stickerExtra: Number($('[name="stickerExtra"]', f).value) },
    };
    try {
      const saved = await api('/api/admin/settings/pricing', { method: 'PUT', body: data });
      Object.assign(pr, saved);
      await ctx.reloadSite();
      toast('Цены сохранены');
      viewSettings(body);
    } catch (e) {
      toast(e.message, true);
    }
  };
}
