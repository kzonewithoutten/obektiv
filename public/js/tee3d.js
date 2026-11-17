/*
 * 3D-футболка на чистом WebGL, без внешних библиотек.
 * Модель строится из настоящего контура футболки (тело и рукава одним силуэтом),
 * который «надувается», как подушка: перёд и спина плавно сходятся по боковым швам.
 * Наклейки рисуются в текстуру: верхняя половина — перёд, нижняя — спина.
 */

// Части футболки на развёртке (u, v, ширина, высота в долях текстуры; v=0 — верх)
export const PANELS = {
  front: { x: 0, y: 0, w: 1, h: 0.5, name: 'Перед' },
  back: { x: 0, y: 0.5, w: 1, h: 0.5, name: 'Спина' },
};

// Фасоны: правая половина контура от центра горловины по часовой стрелке до центра низа.
// neckF — насколько глубже вырез спереди; depth — толщина «подушки».
export const KINDS = {
  tee: {
    name: 'Футболка', depth: 0.14, round: 0.13, neckW: 0.23, neckF: 0.15,
    outline: [[0, 0.6], [0.23, 0.64], [0.62, 0.55], [0.92, 0.12], [0.66, -0.08], [0.565, 0.12], [0.56, -0.4], [0.57, -0.97], [0, -0.99]],
  },
  oversize: {
    name: 'Оверсайз', depth: 0.15, round: 0.14, neckW: 0.24, neckF: 0.14,
    outline: [[0, 0.58], [0.24, 0.62], [0.76, 0.5], [1.04, 0.0], [0.78, -0.17], [0.69, 0.0], [0.68, -0.45], [0.69, -1.0], [0, -1.02]],
  },
  long: {
    name: 'Лонгслив', depth: 0.14, round: 0.13, neckW: 0.23, neckF: 0.15,
    outline: [[0, 0.6], [0.23, 0.64], [0.62, 0.55], [0.9, -0.62], [0.73, -0.67], [0.565, 0.1], [0.56, -0.4], [0.57, -0.97], [0, -0.99]],
  },
  // Кружка строится отдельно (цилиндр с ручкой), контур ей не нужен
  mug: { name: 'Кружка', mug: true },
};

// Кружка: радиус и высота в единицах модели, cm — сколько сантиметров в одной единице (высота ≈ 9,6 см)
const MUG = { R: 0.4, H: 1, wall: 0.035, bottom: 0.07, cm: 9.6 };

const UNIT_CM = 46; // 1 единица модели ≈ 46 см для размера M (для подсказки о размере наклейки)

// Готовая модель обычной футболки: "T-shirt" by Poly by Google, CC-BY 3.0 (https://poly.pizza/m/bdOMzzh-fSl).
// Подготовлена заранее: вершины сварены, нормали сглажены, перёд смотрит на +Z, высота 1.67.
// Используется для футболки и оверсайза (чуть шире); лонгслив и запасной вариант — контурная модель ниже.
const MODEL_KINDS = { tee: { sx: 1, sz: 1 }, oversize: { sx: 1.1, sz: 1.06 } };
let MODEL = null;
try {
  const r = await fetch('/img/tee-model.json?v=1');
  if (r.ok) MODEL = await r.json();
} catch {
  MODEL = null;
}
const useModel = (kind) => Boolean(MODEL && MODEL_KINDS[kind]);

function modelBounds(kind) {
  const { sx } = MODEL_KINDS[kind];
  let xw = 0;
  let top = -Infinity;
  let bot = Infinity;
  for (let i = 0; i < MODEL.pos.length; i += 3) {
    xw = Math.max(xw, Math.abs(MODEL.pos[i] * sx));
    top = Math.max(top, MODEL.pos[i + 1]);
    bot = Math.min(bot, MODEL.pos[i + 1]);
  }
  top += 0.02;
  bot -= 0.02;
  return { xw: xw + 0.02, top, bot, center: (top + bot) / 2 };
}

function bounds(kind) {
  if (useModel(kind)) return modelBounds(kind);
  const k = KINDS[kind] || KINDS.tee;
  const xs = k.outline.map((p) => p[0]);
  const ys = k.outline.map((p) => p[1]);
  const top = Math.max(...ys) + 0.02;
  const bot = Math.min(...ys) - 0.02;
  return { xw: Math.max(...xs) + 0.02, top, bot, center: (top + bot) / 2 };
}
// Реальные размеры части (в единицах модели)
function panelReal(kind) {
  // у кружки перёд и зад — две половины окружности
  if (kind === 'mug') return { w: Math.PI * MUG.R, h: MUG.H };
  const b = bounds(kind);
  return { w: 2 * b.xw, h: b.top - b.bot };
}
export function panelSizeCm(kind, panel) {
  const r = panelReal(kind, panel);
  const unit = kind === 'mug' ? MUG.cm : UNIT_CM;
  return { w: r.w * unit, h: r.h * unit };
}
/** Во сколько раз растянуть высоту картинки на развёртке, чтобы на футболке она не искажалась */
export function aspectK(kind, panel, texW = 1, texH = 1) {
  const r = panelReal(kind);
  const p = PANELS[panel] || PANELS.front;
  return ((r.w / (p.w * texW)) / (r.h / (p.h * texH))) * (texW / texH) * (p.h / p.w) * (p.w / p.h);
}
/** Размер наклейки в сантиметрах */
export function stickerCm(kind, s) {
  const r = panelSizeCm(kind, PANELS[s.panel] ? s.panel : 'front');
  const w = s.w * r.w;
  const a = s.img && s.img.naturalWidth ? s.img.naturalHeight / s.img.naturalWidth : s.aspect || 1;
  return { w, h: w * a };
}

function hexToRgb(hex) {
  const m = String(hex || '#ffffff').replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16) || 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------- геометрия
/** Сглаживание углов контура (алгоритм Чайкина) */
function chaikin(pts, iters, closed) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const out = [];
    const n = p.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i];
      const b = p[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.unshift(p[0]), out.push(p[n - 1]);
    p = out;
  }
  return p;
}
function insidePoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distToPoly(x, y, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}
const sdf = (x, y, poly) => (insidePoly(x, y, poly) ? -1 : 1) * distToPoly(x, y, poly);

const geoCache = new Map();
function buildGeometry(kind) {
  if (geoCache.has(kind)) return geoCache.get(kind);
  const g = buildGeometryRaw(kind);
  geoCache.set(kind, g);
  return g;
}
/** Геометрия из готовой модели: треугольник смотрит вперёд — берёт развёртку переда, иначе спины */
function buildModelGeometry(kind) {
  const { sx, sz } = MODEL_KINDS[kind];
  const B = bounds(kind);
  const H = B.top - B.bot;
  const src = MODEL.pos;
  const srcN = MODEL.nor;
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const map = new Map();
  const clamp01 = (x) => Math.min(0.999, Math.max(0.001, x));
  const vert = (v, side) => {
    const key = v * 2 + (side > 0 ? 1 : 0);
    if (map.has(key)) return map.get(key);
    const id = pos.length / 3;
    const x = src[v * 3] * sx;
    const y = src[v * 3 + 1];
    pos.push(x, y, src[v * 3 + 2] * sz);
    const n = norm([srcN[v * 3] / sx, srcN[v * 3 + 1], srcN[v * 3 + 2] / sz]);
    nor.push(n[0], n[1], n[2]);
    const panel = side > 0 ? PANELS.front : PANELS.back;
    const px = clamp01(side > 0 ? (x + B.xw) / (2 * B.xw) : (B.xw - x) / (2 * B.xw));
    const py = clamp01((B.top - y) / H);
    uv.push(panel.x + px * panel.w, panel.y + py * panel.h);
    map.set(key, id);
    return id;
  };
  const I = MODEL.idx;
  for (let t = 0; t < I.length; t += 3) {
    // сторона по средней нормали треугольника
    let nz = 0;
    for (let q = 0; q < 3; q++) nz += srcN[I[t + q] * 3 + 2];
    const side = nz >= 0 ? 1 : -1;
    idx.push(vert(I[t], side), vert(I[t + 1], side), vert(I[t + 2], side));
  }
  const empty = new Float32Array(0);
  return {
    band: { pos: empty, nor: empty, uv: empty, shade: empty, idx: new Uint16Array(0) },
    shade: new Float32Array(pos.length / 3).fill(1),
    arm: [0, 0],
    folds: 0,
    pos: new Float32Array(pos),
    nor: new Float32Array(nor),
    uv: new Float32Array(uv),
    idx: new Uint16Array(idx),
    height: H,
    center: B.center,
    span: 2 * B.xw,
  };
}

/**
 * Кружка: наружная стенка — две половины (перёд и зад) с развёрткой под картинки,
 * остальное (дно, внутренность, край, ручка) — сплошным цветом.
 */
function buildMugGeometry() {
  const { R, H, wall, bottom } = MUG;
  const SEG = 48;
  const ROWS = 8;
  const clamp01 = (x) => Math.min(0.999, Math.max(0.001, x));
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  // перёд: от -90° до 90° (смотрит на +Z), зад: от 90° до 270°; слева направо, как видит зритель
  const strip = (a0, panel) => {
    const base = pos.length / 3;
    for (let j = 0; j <= ROWS; j++) {
      const y = (H * j) / ROWS;
      for (let i = 0; i <= SEG; i++) {
        const th = a0 + (Math.PI * i) / SEG;
        pos.push(R * Math.sin(th), y, R * Math.cos(th));
        nor.push(Math.sin(th), 0, Math.cos(th));
        uv.push(panel.x + clamp01(i / SEG) * panel.w, panel.y + clamp01((H - y) / H) * panel.h);
      }
    }
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = base + j * (SEG + 1) + i;
        const c = a + SEG + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
  };
  strip(-Math.PI / 2, PANELS.front);
  strip(Math.PI / 2, PANELS.back);

  // ---- сплошные части
  const bpos = [];
  const bnor = [];
  const bidx = [];
  const ring = (n) => Array.from({ length: n + 1 }, (_, i) => (i / n) * Math.PI * 2);
  // плоское кольцо или диск на высоте y между радиусами r0 и r1, нормаль ny
  const disk = (y, r0, r1, ny) => {
    const base = bpos.length / 3;
    for (const t of ring(SEG)) {
      bpos.push(r0 * Math.sin(t), y, r0 * Math.cos(t), r1 * Math.sin(t), y, r1 * Math.cos(t));
      bnor.push(0, ny, 0, 0, ny, 0);
    }
    for (let i = 0; i < SEG; i++) {
      const a = base + i * 2;
      bidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  // цилиндр радиуса r от y0 до y1, нормаль внутрь (inward = -1) или наружу
  const tubeWall = (r, y0, y1, dir) => {
    const base = bpos.length / 3;
    for (const t of ring(SEG)) {
      bpos.push(r * Math.sin(t), y0, r * Math.cos(t), r * Math.sin(t), y1, r * Math.cos(t));
      bnor.push(dir * Math.sin(t), 0, dir * Math.cos(t), dir * Math.sin(t), 0, dir * Math.cos(t));
    }
    for (let i = 0; i < SEG; i++) {
      const a = base + i * 2;
      bidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  disk(0, 0, R, -1); // дно снаружи
  tubeWall(R - wall, bottom, H, -1); // стенка внутри
  disk(bottom, 0, R - wall, 1); // дно внутри
  // скруглённый край: полукруглый валик поверх стенки
  {
    const base = bpos.length / 3;
    const rc = R - wall / 2;
    const rr = wall / 2;
    const K = 8;
    for (const t of ring(SEG)) {
      for (let k = 0; k <= K; k++) {
        const a = (k / K) * Math.PI; // от внешней стороны через верх к внутренней
        const rx = Math.cos(a);
        const ry = Math.sin(a);
        bpos.push((rc + rr * rx) * Math.sin(t), H + rr * ry * 0.8, (rc + rr * rx) * Math.cos(t));
        bnor.push(rx * Math.sin(t), ry, rx * Math.cos(t));
      }
    }
    for (let i = 0; i < SEG; i++) {
      for (let k = 0; k < K; k++) {
        const a = base + i * (K + 1) + k;
        const b = a + K + 1;
        bidx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  // ручка справа (+X): дуга с плоским овальным сечением, концы уходят в стенку
  {
    const base = bpos.length / 3;
    const cx = R + 0.07;
    const cy = H / 2;
    const Rm = 0.25;
    const rx = 0.045;
    const rz = 0.065;
    const N = 32;
    const K = 14;
    for (let i = 0; i <= N; i++) {
      const phi = -1.9 + (3.8 * i) / N;
      const dx = Math.cos(phi);
      const dy = Math.sin(phi);
      for (let k = 0; k <= K; k++) {
        const a = (k / K) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        bpos.push(cx + (Rm + rx * ca) * dx, cy + (Rm + rx * ca) * dy, rz * sa);
        const n = norm([(ca / rx) * dx, (ca / rx) * dy, sa / rz]);
        bnor.push(n[0], n[1], n[2]);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < K; k++) {
        const a = base + i * (K + 1) + k;
        const b = a + K + 1;
        bidx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const nb = bpos.length / 3;
  return {
    band: { pos: new Float32Array(bpos), nor: new Float32Array(bnor), uv: new Float32Array(nb * 2), shade: new Float32Array(nb).fill(1), idx: new Uint16Array(bidx) },
    shade: new Float32Array(pos.length / 3).fill(1),
    arm: [0, 0],
    folds: 0,
    gloss: 1,
    pos: new Float32Array(pos),
    nor: new Float32Array(nor),
    uv: new Float32Array(uv),
    idx: new Uint16Array(idx),
    height: H,
    center: H / 2,
    span: 2 * (R + 0.37),
  };
}

function buildGeometryRaw(kind) {
  if (kind === 'mug') return buildMugGeometry();
  if (useModel(kind)) return buildModelGeometry(kind);
  const k = KINDS[kind] || KINDS.tee;
  const B = bounds(kind);
  // Полный силуэт: правая половина + зеркальная левая
  const half = k.outline;
  const full = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
  const dense = [];
  for (let i = 0; i < full.length; i++) {
    const [ax, ay] = full[i];
    const [bx, by] = full[(i + 1) % full.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.07));
    for (let j = 0; j < n; j++) dense.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  const sil = chaikin(dense, 1, true);
  // Силуэт для переда: сверху вырез горловины глубже
  const neckTop = k.outline[1][1];
  const frontPoly = sil.map(([x, y]) => {
    const u = Math.abs(x) / k.neckW;
    if (u < 1 && y > neckTop - 0.2) return [x, Math.min(y, neckTop - k.neckF * Math.pow(1 - u * u, 0.8))];
    return [x, y];
  });

  // Низ и концы рукавов открыты, как у настоящей футболки; остальные края — швы
  const O = k.outline;
  const openSegs = [];
  for (const [a, b] of [[3, 4], [7, 8]]) {
    openSegs.push([O[a], O[b]], [[-O[a][0], O[a][1]], [-O[b][0], O[b][1]]]);
  }
  const segDist = (x, y, [[ax, ay], [bx, by]]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const seams = [];
  for (let i = 0; i < sil.length; i++) {
    const a = sil[i];
    const b = sil[(i + 1) % sil.length];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    if (Math.min(...openSegs.map((sg) => segDist(mx, my, sg))) > 0.03) seams.push([a, b]);
  }
  const CELL = k.round;
  const buckets = new Map();
  const bkey = (i, j) => i * 10007 + j;
  for (const sg of seams) {
    const [[ax, ay], [bx, by]] = sg;
    const i0 = Math.floor((Math.min(ax, bx) - CELL) / CELL);
    const i1 = Math.floor((Math.max(ax, bx) + CELL) / CELL);
    const j0 = Math.floor((Math.min(ay, by) - CELL) / CELL);
    const j1 = Math.floor((Math.max(ay, by) + CELL) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const kk = bkey(i, j);
        if (!buckets.has(kk)) buckets.set(kk, []);
        buckets.get(kk).push(sg);
      }
  }
  // расстояние до ближайшего шва (дальше CELL — не важно, там полная толщина)
  const seamDist = (x, y) => {
    const list = buckets.get(bkey(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!list) return CELL;
    let best = CELL;
    for (let i = 0; i < list.length; i++) {
      const d = segDist(x, y, list[i]);
      if (d < best) best = d;
    }
    return best;
  };
  // Толщина: чем дальше от шва, тем толще, у шва край скруглён по дуге
  const bodyW = k.outline[6][0];
  const thick = (x, y) => {
    const u = Math.min(1, seamDist(x, y) / k.round);
    const edge = Math.sqrt(1 - (1 - u) * (1 - u));
    const ax = Math.min(1, Math.abs(x) / bodyW);
    const torso = Math.abs(x) <= bodyW ? 0.62 + 0.38 * Math.sqrt(1 - ax * ax) : 0.62;
    return k.depth * edge * torso;
  };

  const pos = [];
  const uv = [];
  const shade = [];
  const idx = [];
  const H = B.top - B.bot;
  const arm = k.outline[5];
  const shadeAt = (x, y) => {
    const seam = 0.86 + 0.14 * Math.min(1, seamDist(x, y) / 0.08);
    const da = Math.hypot(Math.abs(x) - arm[0], y - arm[1]);
    const pit = 1 - 0.13 * Math.exp(-(da * da) / 0.004);
    return seam * pit;
  };
  const P = PANELS;
  const clamp01 = (x) => Math.min(0.999, Math.max(0.001, x));

  // Поверхность по сетке с аккуратным краем (marching squares)
  const surface = (poly, side) => {
    const step = 0.018;
    const nx = Math.ceil((2 * B.xw) / step) + 1;
    const ny = Math.ceil(H / step) + 1;
    const vals = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const y = B.bot + j * step;
      const xs = [];
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [xa, ya] = poly[a];
        const [xb, yb] = poly[b];
        if (ya > y !== yb > y) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i < nx; i++) {
        const x = -B.xw + i * step;
        let c = 0;
        while (c < xs.length && xs[c] < x) c++;
        vals[j * nx + i] = c % 2 ? -1 : 1;
      }
    }
    const sign = vals.slice();
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = sign[j * nx + i];
        const nb = (a, b) => a >= 0 && b >= 0 && a < nx && b < ny && sign[b * nx + a] !== v;
        if (nb(i + 1, j) || nb(i - 1, j) || nb(i, j + 1) || nb(i, j - 1)) vals[j * nx + i] = v * Math.max(1e-5, distToPoly(-B.xw + i * step, B.bot + j * step, poly));
      }
    const map = new Map();
    const vert = (key, x, y) => {
      if (map.has(key)) return map.get(key);
      const id = pos.length / 3;
      const z = thick(x, y);
      pos.push(x, y, side * z);
      shade.push(shadeAt(x, y));
      const panel = side > 0 ? P.front : P.back;
      const px = clamp01(side > 0 ? (x + B.xw) / (2 * B.xw) : (B.xw - x) / (2 * B.xw));
      const py = clamp01((B.top - y) / H);
      uv.push(panel.x + px * panel.w, panel.y + py * panel.h);
      map.set(key, id);
      return id;
    };
    const corner = (i, j) => vert(`c${i},${j}`, -B.xw + i * step, B.bot + j * step);
    const edge = (i1, j1, i2, j2) => {
      const a = vals[j1 * nx + i1];
      const b = vals[j2 * nx + i2];
      const t = a / (a - b);
      const x = -B.xw + (i1 + (i2 - i1) * t) * step;
      const y = B.bot + (j1 + (j2 - j1) * t) * step;
      const key = i1 < i2 || j1 < j2 ? `e${i1},${j1},${i2},${j2}` : `e${i2},${j2},${i1},${j1}`;
      return vert(key, x, y);
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const ins = c.map(([a, b]) => vals[b * nx + a] < 0);
        if (!ins.some(Boolean)) continue;
        const ring = [];
        for (let q = 0; q < 4; q++) {
          const [a1, b1] = c[q];
          const [a2, b2] = c[(q + 1) % 4];
          if (ins[q]) ring.push(corner(a1, b1));
          if (ins[q] !== ins[(q + 1) % 4]) ring.push(edge(a1, b1, a2, b2));
        }
        for (let q = 1; q < ring.length - 1; q++) {
          if (side > 0) idx.push(ring[0], ring[q], ring[q + 1]);
          else idx.push(ring[0], ring[q + 1], ring[q]);
        }
      }
    }
  };
  surface(frontPoly, 1);
  surface(sil, -1);

  // Плавные нормали по треугольникам
  const nor = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      nor[v] += nx;
      nor[v + 1] += ny;
      nor[v + 2] += nz;
    }
  }
  for (let v = 0; v < nor.length; v += 3) {
    const l = Math.hypot(nor[v], nor[v + 1], nor[v + 2]) || 1;
    nor[v] /= l;
    nor[v + 1] /= l;
    nor[v + 2] /= l;
    // на самом краю нормаль смотрит в сторону, чтобы перёд и спина сходились без шва
    if (Math.abs(pos[v + 2]) < 2e-3) {
      // перпендикуляр к ближайшему шву, наружу
      const x = pos[v], y = pos[v + 1];
      const list = buckets.get(bkey(Math.floor(x / CELL), Math.floor(y / CELL))) || [];
      let best = Infinity, sg = null;
      for (const q of list) {
        const d = segDist(x, y, q);
        if (d < best) (best = d), (sg = q);
      }
      if (!sg) continue;
      let ex = -(sg[1][1] - sg[0][1]), ey = sg[1][0] - sg[0][0];
      const el = Math.hypot(ex, ey) || 1;
      ex /= el;
      ey /= el;
      if (insidePoly(x + ex * 0.01, y + ey * 0.01, sil)) (ex = -ex), (ey = -ey);
      nor[v] = ex;
      nor[v + 1] = ey;
      nor[v + 2] = 0;
    }
  }

  // ---- окантовка ворота (рисуется сплошным цветом)
  const bpos = [];
  const bnor = [];
  const bidx = [];
  const tube = (loop, radius, seg = 10) => {
    const base = bpos.length / 3;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[(i - 1 + n) % n];
      const c = loop[(i + 1) % n];
      const T = norm([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
      let Bn = cross(T, [0, 0, 1]);
      if (Math.hypot(...Bn) < 1e-3) Bn = cross(T, [0, 1, 0]);
      Bn = norm(Bn);
      const N = cross(Bn, T);
      for (let j = 0; j <= seg; j++) {
        const ang = (j / seg) * Math.PI * 2;
        const d = [0, 1, 2].map((q) => Bn[q] * Math.cos(ang) + N[q] * Math.sin(ang));
        bpos.push(loop[i][0] + d[0] * radius, loop[i][1] + d[1] * radius, loop[i][2] + d[2] * radius);
        bnor.push(...d);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < seg; j++) {
        const q = base + i * (seg + 1) + j;
        const q2 = base + ((i + 1) % n) * (seg + 1) + j;
        bidx.push(q, q + 1, q2, q + 1, q2 + 1, q2);
      }
    }
  };
  const collar = [];
  const nw = k.neckW;
  for (let i = 0; i <= 40; i++) {
    const x = nw - (2 * nw * i) / 40;
    const u = Math.abs(x) / nw;
    const y = neckTop - k.neckF * Math.pow(Math.max(0, 1 - u * u), 0.8);
    collar.push([x, y, thick(x, y) * 0.96]);
  }
  for (let i = 1; i < 40; i++) {
    const x = -nw + (2 * nw * i) / 40;
    // край спины по силуэту: ищем верхнюю границу при этом x
    let y = neckTop;
    for (let yy = neckTop + 0.06; yy > neckTop - 0.2; yy -= 0.002) {
      if (insidePoly(x, yy, sil)) {
        y = yy;
        break;
      }
    }
    collar.push([x, y, -0.008]);
  }
  tube(collar, 0.024);
  // край, который проходит по открытому отрезку: перёд туда, спина обратно
  const openLoop = ([[ax, ay], [bx, by]]) => {
    // точки вдоль открытого края, сдвинутые внутрь фигуры, пока не окажутся внутри
    const pts = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      let x = ax + ((bx - ax) * i) / n;
      let y = ay + ((by - ay) * i) / n;
      let ok = false;
      let dx0 = -(by - ay);
      let dy0 = bx - ax;
      const l0 = Math.hypot(dx0, dy0) || 1;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      if (!insidePoly(mx + (dx0 / l0) * 0.03, my + (dy0 / l0) * 0.03, sil)) (dx0 = -dx0), (dy0 = -dy0);
      for (let q = 0; q < 5; q++) {
        if (insidePoly(x, y, sil) && insidePoly(x - (dx0 / l0) * 0.01, y - (dy0 / l0) * 0.01, sil)) {
          ok = true;
          break;
        }
        x += (dx0 / l0) * 0.005;
        y += (dy0 / l0) * 0.005;
      }
      if (ok) pts.push([x, y]);
    }
    if (pts.length < 3) return null;
    const loop = pts.map(([x, y]) => [x, y, thick(x, y) * 0.97]);
    for (let i = pts.length - 2; i > 0; i--) loop.push([pts[i][0], pts[i][1], -thick(pts[i][0], pts[i][1]) * 0.97]);
    return loop;
  };
  const hemSeg = [[O[7][0], O[7][1]], [-O[7][0], O[7][1]]];
  hemSeg[0][1] = hemSeg[1][1] = (O[7][1] + O[8][1]) / 2;
  const hl = openLoop(hemSeg);
  hl && tube(hl, 0.016);
  for (const sx of [1, -1]) {
    const cl = openLoop([[sx * O[3][0], O[3][1]], [sx * O[4][0], O[4][1]]]);
    cl && tube(cl, 0.015);
  }

  return {
    band: { pos: new Float32Array(bpos), nor: new Float32Array(bnor), uv: new Float32Array((bpos.length / 3) * 2), shade: new Float32Array(bpos.length / 3).fill(0.9), idx: new Uint16Array(bidx) },
    shade: new Float32Array(shade),
    arm: [Math.abs(arm[0]), arm[1]],
    folds: 1,
    pos: new Float32Array(pos),
    nor,
    uv: new Float32Array(uv),
    idx: new Uint16Array(idx),
    height: H,
    center: B.center,
    span: 2 * B.xw,
  };
}

// ---------------------------------------------------------------- шейдеры
const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv; attribute float aShade;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vNor; varying vec2 vUv; varying vec3 vPos; varying float vShade;
void main(){
  vNor = mat3(uModel) * aNor; vUv = aUv; vPos = (uModel * vec4(aPos,1.0)).xyz; vShade = aShade;
  gl_Position = uMVP * vec4(aPos,1.0);
}`;
const FS = `
precision mediump float;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uSolid; uniform vec3 uColor; uniform vec2 uArm; uniform float uFolds; uniform float uGloss;
varying vec3 vNor; varying vec2 vUv; varying vec3 vPos; varying float vShade;
void main(){
  vec3 n = normalize(vNor);
  vec3 V = normalize(uEye - vPos);
  float inside = 0.0;
  if (dot(n, V) < 0.0) { n = -n; inside = 1.0; }
  // складки: от подмышек по диагонали к груди и мягкие горизонтальные на талии
  vec2 p = vPos.xy;
  vec2 a = vec2(abs(p.x), p.y) - uArm;
  float armMask = exp(-dot(a, a) / 0.045) * step(abs(p.x), uArm.x + 0.02);
  vec2 dir = normalize(vec2(-0.8, -0.6));
  float f1 = sin(dot(a, dir) * 38.0) * armMask;
  float waist = exp(-pow((p.y + 0.55) / 0.22, 2.0)) * (1.0 - smoothstep(0.35, 0.56, abs(p.x)) * 0.5);
  float f2 = sin(p.y * 20.0 + sin(p.x * 5.0) * 1.4) * waist;
  float sgn = sign(p.x);
  n = normalize(n + uFolds * (vec3(f1 * 0.07 * sgn * dir.x, f1 * 0.07 * dir.y + f2 * 0.08, 0.0) + 0.02 * vec3(sin(p.y * 13.0 + p.x * 4.0), 0.0, cos(p.x * 11.0 - p.y * 3.0))));
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), V));
  vec3 L1 = normalize(V + vec3(0.0, 0.75, 0.0) - side * 0.45);
  vec3 L2 = normalize(-V + side * 0.8 + vec3(0.0, 0.3, 0.0));
  float d = max(dot(n, L1), 0.0);
  float shade = 0.52 + 0.5 * d + 0.12 * max(dot(n, L2), 0.0);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 2.5);
  vec4 tex = uSolid > 0.5 ? vec4(uColor, 1.0) : texture2D(uTex, vUv);
  vec3 col = tex.rgb * shade * (1.0 - 0.18 * rim) * vShade;
  col = mix(col, col * 0.62, inside);
  // блик для керамики (у ткани uGloss = 0)
  col += uGloss * (1.0 - inside) * 0.45 * pow(max(dot(reflect(-L1, n), V), 0.0), 48.0);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}`;
const PICK_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vNor; varying vec2 vUv; varying vec3 vPos;
void main(){
  float U = floor(clamp(vUv.x, 0.0, 0.99998) * 65535.0);
  float V = floor(clamp(vUv.y, 0.0, 0.99998) * 65535.0);
  gl_FragColor = vec4(floor(U / 256.0) / 255.0, mod(U, 256.0) / 255.0, floor(V / 256.0) / 255.0, mod(V, 256.0) / 255.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.bindAttribLocation(p, 1, 'aNor');
  gl.bindAttribLocation(p, 2, 'aUv');
  gl.bindAttribLocation(p, 3, 'aShade');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ---------------------------------------------------------------- матрицы
const M = {
  persp(fov, asp, n, f) {
    const t = 1 / Math.tan(fov / 2);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
  },
  mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  },
  lookAt(e, t, u) {
    const z = norm([e[0] - t[0], e[1] - t[1], e[2] - t[2]]);
    const x = norm(cross(u, z));
    const y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  },
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((c) => c / l);
};

export const VIEWS = { front: 0, right: 1.05, back: Math.PI, left: -1.05 };

// ---------------------------------------------------------------- основной объект
export function createTee(canvas, { color = '#ffffff', kind = 'tee' } = {}) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false });
  if (!gl) throw new Error('no-webgl');

  const prog = compile(gl, VS, FS);
  const pickProg = compile(gl, VS, PICK_FS);
  const buffers = { pos: gl.createBuffer(), nor: gl.createBuffer(), uv: gl.createBuffer(), shade: gl.createBuffer(), idx: gl.createBuffer() };
  const bbuf = { pos: gl.createBuffer(), nor: gl.createBuffer(), uv: gl.createBuffer(), shade: gl.createBuffer(), idx: gl.createBuffer() };
  let bcount = 0;
  let geo;
  let count = 0;

  const texCanvas = document.createElement('canvas');
  const TW = 1024;
  const TH = 1536;
  texCanvas.width = TW;
  texCanvas.height = TH;
  const tctx = texCanvas.getContext('2d');
  const tex = gl.createTexture();

  const st = {
    color,
    kind,
    stickers: [],
    selected: null,
    yaw: 0.35,
    pitch: 0.08,
    zoom: 1,
    auto: false,
    dirtyTex: true,
    anim: null,
    raf: 0,
    destroyed: false,
  };

  function setGeometry() {
    geo = buildGeometry(st.kind);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos);
    gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.nor);
    gl.bufferData(gl.ARRAY_BUFFER, geo.nor, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
    gl.bufferData(gl.ARRAY_BUFFER, geo.uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.shade);
    gl.bufferData(gl.ARRAY_BUFFER, geo.shade, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
    count = geo.idx.length;
    for (const k of ['pos', 'nor', 'uv', 'shade']) {
      gl.bindBuffer(gl.ARRAY_BUFFER, bbuf[k]);
      gl.bufferData(gl.ARRAY_BUFFER, geo.band[k], gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bbuf.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.band.idx, gl.STATIC_DRAW);
    bcount = geo.band.idx.length;
  }

  // Насколько растянуть высоту картинки на развёртке, чтобы на футболке были верные пропорции
  const stretch = (pw, ph) => {
    const R = panelReal(st.kind);
    return R.w / pw / (R.h / ph);
  };
  function paintTexture(withSelection = true) {
    const [r, g, b] = hexToRgb(st.color);
    tctx.fillStyle = `rgb(${r},${g},${b})`;
    tctx.fillRect(0, 0, TW, TH);
    for (const s of st.stickers) {
      if (!s.img || !s.img.complete || !s.img.naturalWidth) continue;
      const p = PANELS[s.panel];
      if (!p) continue;
      const px = p.x * TW;
      const py = p.y * TH;
      const pw = p.w * TW;
      const ph = p.h * TH;
      const w = s.w * pw;
      const h = ((w * s.img.naturalHeight) / s.img.naturalWidth) * stretch(pw, ph);
      tctx.save();
      tctx.beginPath();
      tctx.rect(px, py, pw, ph);
      tctx.clip();
      tctx.translate(px + s.cx * pw, py + s.cy * ph);
      tctx.rotate((s.rot * Math.PI) / 180);
      tctx.drawImage(s.img, -w / 2, -h / 2, w, h);
      if (withSelection && s === st.selected) {
        tctx.lineWidth = Math.max(2, TW / 350);
        tctx.setLineDash([TW / 100, TW / 140]);
        tctx.strokeStyle = 'rgba(115,96,249,.95)';
        tctx.strokeRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8);
      }
      tctx.restore();
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    st.dirtyTex = false;
  }

  function matrices(w, h) {
    // Отодвигаем камеру так, чтобы футболка целиком влезала и в узкий, и в широкий экран
    const vf = (32 * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * (w / h));
    const fitV = (geo.height + 0.35) / 2 / Math.tan(vf / 2);
    const fitH = (geo.span + 0.25) / 2 / Math.tan(hf / 2);
    const dist = (Math.max(fitV, fitH) * 1.08 + 0.3) / st.zoom;
    const target = [0, geo.center + 0.02, 0];
    const eye = [
      target[0] + dist * Math.sin(st.yaw) * Math.cos(st.pitch),
      target[1] + dist * Math.sin(st.pitch),
      target[2] + dist * Math.cos(st.yaw) * Math.cos(st.pitch),
    ];
    const proj = M.persp((32 * Math.PI) / 180, w / h, 0.1, 50);
    const view = M.lookAt(eye, target, [0, 1, 0]);
    const model = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return { mvp: M.mul(proj, view), model, eye };
  }

  function bindAttrs(B = buffers) {
    const buffers = B;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.nor);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.shade);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.idx);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function draw(withSelection = true) {
    resize();
    if (st.dirtyTex) paintTexture(withSelection);
    const { mvp, model, eye } = matrices(canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uModel'), false, model);
    gl.uniform3fv(gl.getUniformLocation(prog, 'uEye'), eye);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    drawMeshes(prog);
  }

  function drawMeshes(pr) {
    const [r, g, b] = hexToRgb(st.color);
    gl.uniform2f(gl.getUniformLocation(pr, 'uArm'), geo.arm[0], geo.arm[1]);
    gl.uniform1f(gl.getUniformLocation(pr, 'uFolds'), geo.folds);
    gl.uniform1f(gl.getUniformLocation(pr, 'uGloss'), geo.gloss || 0);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSolid'), 0);
    bindAttrs();
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSolid'), 1);
    gl.uniform3f(gl.getUniformLocation(pr, 'uColor'), (r / 255) * 0.93, (g / 255) * 0.93, (b / 255) * 0.93);
    bindAttrs(bbuf);
    gl.drawElements(gl.TRIANGLES, bcount, gl.UNSIGNED_SHORT, 0);
  }

  // Что под пальцем: часть футболки и координаты внутри неё (0..1)
  let fbo = null;
  let fboTex = null;
  let fboDepth = null;
  let fboW = 0;
  let fboH = 0;
  function pickAt(clientX, clientY) {
    resize();
    const rect = canvas.getBoundingClientRect();
    const sx = Math.round(((clientX - rect.left) / rect.width) * canvas.width);
    const sy = Math.round(((clientY - rect.top) / rect.height) * canvas.height);
    if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) return null;
    if (!fbo || fboW !== canvas.width || fboH !== canvas.height) {
      fboW = canvas.width;
      fboH = canvas.height;
      fbo = fbo || gl.createFramebuffer();
      fboTex = fboTex || gl.createTexture();
      fboDepth = fboDepth || gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fboW, fboH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindRenderbuffer(gl.RENDERBUFFER, fboDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, fboW, fboH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fboDepth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const { mvp, model } = matrices(canvas.width, canvas.height);
    gl.viewport(0, 0, fboW, fboH);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(pickProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(pickProg, 'uMVP'), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(pickProg, 'uModel'), false, model);
    bindAttrs();
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    const px = new Uint8Array(4);
    gl.readPixels(sx, fboH - sy - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (px[0] === 255 && px[1] === 255 && px[2] === 255 && px[3] === 255) return null;
    const u = (px[0] * 256 + px[1]) / 65535;
    const v = (px[2] * 256 + px[3]) / 65535;
    for (const [id, p] of Object.entries(PANELS)) {
      if (u >= p.x && u <= p.x + p.w && v >= p.y && v <= p.y + p.h) {
        return { panel: id, x: (u - p.x) / p.w, y: (v - p.y) / p.h };
      }
    }
    return null;
  }

  /** Какая наклейка под точкой части футболки */
  function stickerAt(hit) {
    if (!hit) return null;
    for (let i = st.stickers.length - 1; i >= 0; i--) {
      const s = st.stickers[i];
      if (s.panel !== hit.panel || !s.img || !s.img.naturalWidth) continue;
      const p = PANELS[s.panel];
      const pw = p.w * TW;
      const ph = p.h * TH;
      const dx = (hit.x - s.cx) * pw;
      const dy = (hit.y - s.cy) * ph;
      const a = (-s.rot * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const w = s.w * pw;
      const h = ((w * s.img.naturalHeight) / s.img.naturalWidth) * stretch(pw, ph);
      if (Math.abs(lx) <= w / 2 + 6 && Math.abs(ly) <= h / 2 + 6) return s;
    }
    return null;
  }

  function loop(t) {
    if (st.destroyed) return;
    if (st.anim) {
      const k = Math.min(1, (t - st.anim.t0) / st.anim.dur);
      const e = 1 - Math.pow(1 - k, 3);
      st.yaw = st.anim.from + (st.anim.to - st.anim.from) * e;
      if (k >= 1) st.anim = null;
      st.needs = true;
    } else if (st.auto) {
      st.yaw += 0.006;
      st.needs = true;
    }
    if (st.needs || st.dirtyTex) {
      st.needs = false;
      draw();
    }
    st.raf = requestAnimationFrame(loop);
  }

  setGeometry();
  st.raf = requestAnimationFrame(loop);
  const ro = new ResizeObserver(() => (st.needs = true));
  ro.observe(canvas);

  const api = {
    state: st,
    setColor(c) {
      st.color = c;
      st.dirtyTex = true;
    },
    setKind(k) {
      st.kind = KINDS[k] ? k : 'tee';
      setGeometry();
      st.needs = true;
    },
    setStickers(list) {
      list.forEach((x) => {
        if (!PANELS[x.panel]) x.panel = 'front';
      });
      st.stickers = list;
      st.dirtyTex = true;
    },
    select(s) {
      st.selected = s;
      st.dirtyTex = true;
    },
    refresh() {
      st.dirtyTex = true;
    },
    rotate(dy, dp = 0) {
      st.anim = null;
      st.yaw += dy;
      st.pitch = Math.max(-0.45, Math.min(0.7, st.pitch + dp));
      st.needs = true;
    },
    zoomBy(f) {
      st.zoom = Math.max(0.7, Math.min(2.6, st.zoom * f));
      st.needs = true;
    },
    view(name) {
      let to = VIEWS[name] ?? 0;
      const tau = Math.PI * 2;
      while (to - st.yaw > Math.PI) to -= tau;
      while (to - st.yaw < -Math.PI) to += tau;
      st.anim = { from: st.yaw, to, t0: performance.now(), dur: 650 };
      st.pitch = 0.06;
    },
    /** Часть футболки, которая сейчас лицом к зрителю */
    facing() {
      const a = ((st.yaw % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      return Math.abs(a) < Math.PI / 2 ? 'front' : 'back';
    },
    setAuto(v) {
      st.auto = v;
    },
    pickAt,
    stickerAt,
    /** Снимок с нужной стороны без рамки выделения → canvas */
    snapshot(viewName, size = 700) {
      const saved = { yaw: st.yaw, pitch: st.pitch, zoom: st.zoom, w: canvas.style.width, h: canvas.style.height, anim: st.anim };
      st.anim = null;
      st.yaw = VIEWS[viewName] ?? 0;
      st.pitch = 0.04;
      st.zoom = 1;
      paintTexture(false);
      const W0 = canvas.width;
      const H0 = canvas.height;
      canvas.width = size;
      canvas.height = size;
      const ctxSize = { clientWidth: canvas.clientWidth };
      // рисуем в нужном размере без пересчёта по CSS
      const { mvp, model, eye } = matrices(size, size);
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, mvp);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uModel'), false, model);
      gl.uniform3fv(gl.getUniformLocation(prog, 'uEye'), eye);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      drawMeshes(prog);
      const out = document.createElement('canvas');
      out.width = out.height = size;
      out.getContext('2d').drawImage(canvas, 0, 0);
      void ctxSize;
      canvas.width = W0;
      canvas.height = H0;
      Object.assign(st, { yaw: saved.yaw, pitch: saved.pitch, zoom: saved.zoom });
      st.dirtyTex = true;
      st.needs = true;
      return out;
    },
    destroy() {
      st.destroyed = true;
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      const ext = gl.getExtension('WEBGL_lose_context');
      ext && ext.loseContext();
    },
  };
  return api;
}

export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}
