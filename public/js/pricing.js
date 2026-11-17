/*
 * Расчёт цен. Этот файл используется и в браузере, и на сервере,
 * поэтому цена, которую видит клиент, всегда совпадает с ценой в заказе.
 * Сами цифры (цены форматов, доплаты за бумагу, размеры футболок, скидка)
 * задаются в админке → «Настройки» и сюда приходят параметром `pricing`.
 */
(function (root) {
  'use strict';

  const round2 = (n) => Math.round(n * 100) / 100;
  const byId = (list, id) => (list || []).find((x) => x.id === id);

  // Бумага и режим печати фиксированы, цены задаются у каждого формата отдельно
  const PAPERS = [
    { id: 'plain', name: 'Обычная' },
    { id: 'glossy', name: 'Глянцевая' },
    { id: 'matte', name: 'Матовая' },
  ];
  // Поле с ценой для фотобумаги (у обычной цена зависит от ЧБ/цвета)
  const PHOTO_PRICE = { glossy: 'priceGlossy', matte: 'priceMatte' };
  const COLORS = [
    { id: 'color', name: 'Цветная' },
    { id: 'bw', name: 'Чёрно-белая' },
  ];

  /** Цена одного отпечатка или null, если такого сочетания нет (0 или пусто = недоступно) */
  function unitPrice(fmt, paper, color) {
    if (!fmt) return null;
    let v;
    if (PHOTO_PRICE[paper]) v = fmt[PHOTO_PRICE[paper]];
    else if (paper === 'plain') v = color === 'bw' ? fmt.priceBw : fmt.priceColor;
    else return null;
    v = Number(v);
    return v > 0 ? v : null;
  }

  /** Какие бумаги есть у формата */
  function papersFor(fmt) {
    return PAPERS.filter((p) => COLORS.some((c) => unitPrice(fmt, p.id, c.id) !== null));
  }

  /** Самая низкая цена формата — для надписей «от … ₽» */
  function minFormatPrice(fmt) {
    const all = ['priceBw', 'priceColor', 'priceGlossy', 'priceMatte'].map((k) => Number(fmt && fmt[k])).filter((v) => v > 0);
    return all.length ? Math.min(...all) : 0;
  }

  /**
   * Печать фото.
   * items: [{ format, paper, color, copies }]
   * prevPrints: сколько отпечатков клиент уже заказал раньше (для скидки на каждый N-й).
   */
  function calcPrint(pricing, items, prevPrints) {
    const p = (pricing && pricing.print) || {};
    const every = Math.max(0, parseInt(p.discountEvery, 10) || 0);
    const pct = Math.max(0, Math.min(100, Number(p.discountPercent) || 0));
    let counter = Math.max(0, parseInt(prevPrints, 10) || 0);
    let subtotal = 0;
    let discount = 0;
    let discountedPrints = 0;
    let prints = 0;
    const lines = [];

    for (const item of items || []) {
      const price = unitPrice(byId(p.formats, item.format), item.paper, item.color);
      if (price === null) {
        lines.push({ ok: false, unit: 0, line: 0, discount: 0 });
        continue;
      }
      const copies = Math.max(1, Math.min(999, parseInt(item.copies, 10) || 1));
      const unit = round2(price);
      const line = round2(unit * copies);
      let d = 0;
      for (let c = 0; c < copies; c++) {
        counter++;
        if (every > 0 && pct > 0 && counter % every === 0) {
          d += (unit * pct) / 100;
          discountedPrints++;
        }
      }
      d = round2(d);
      subtotal += line;
      discount += d;
      prints += copies;
      lines.push({ ok: true, copies, unit, line, discount: d });
    }

    subtotal = round2(subtotal);
    discount = round2(discount);
    return {
      lines,
      prints,
      subtotal,
      discount,
      total: round2(subtotal - discount),
      discountedPrints,
      printsAfter: counter,
      // Какой по счёту из следующих отпечатков будет со скидкой (1 = прямо следующий)
      nextDiscountIn: every > 0 ? every - (counter % every) : null,
    };
  }

  /** Футболки: базовая цена шаблона + доплата за размер, × количество */
  function calcTshirt(pricing, template, sizeName, qty, stickers) {
    const t = (pricing && pricing.tshirt) || {};
    const size = (t.sizes || []).find((s) => s.name === sizeName);
    const q = Math.max(1, Math.min(99, parseInt(qty, 10) || 1));
    const n = Math.max(1, parseInt(stickers, 10) || 1);
    const stickersExtra = round2((Number(t.stickerExtra) || 0) * (n - 1));
    const unit = round2((Number(template && template.price) || 0) + (Number(size && size.extra) || 0) + stickersExtra);
    return { ok: Boolean(template && size), qty: q, unit, stickersExtra, total: round2(unit * q) };
  }

  /** Кружки: цена модели (уже с печатью) × количество */
  function calcMug(template, qty) {
    const q = Math.max(1, Math.min(99, parseInt(qty, 10) || 1));
    const unit = round2(Number(template && template.price) || 0);
    return { ok: Boolean(template), qty: q, unit, total: round2(unit * q) };
  }

  /** Сколько отпечатков осталось до следующего со скидкой */
  function loyalty(pricing, prevPrints) {
    const p = (pricing && pricing.print) || {};
    const every = Math.max(0, parseInt(p.discountEvery, 10) || 0);
    const done = Math.max(0, parseInt(prevPrints, 10) || 0);
    if (!every) return null;
    const inCycle = done % every; // сколько уже набрано в текущем круге
    return { every, percent: Number(p.discountPercent) || 0, inCycle, nextIn: every - inCycle };
  }

  const api = { calcPrint, calcTshirt, calcMug, loyalty, round2, unitPrice, papersFor, minFormatPrice, PAPERS, COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(typeof window !== 'undefined' ? window : globalThis);
