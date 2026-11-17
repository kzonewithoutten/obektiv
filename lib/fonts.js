// Шрифты с кириллицей из Google Fonts, которые можно выбрать в админке.
// weights — какие начертания у шрифта есть (если запросить несуществующее, Google не отдаст шрифт).
const DISPLAY = [
  { name: 'Montserrat Alternates', weights: [600, 700, 800], note: 'мягкий геометричный' },
  { name: 'Unbounded', weights: [500, 600, 700, 800], note: 'широкий, современный' },
  { name: 'Sofia Sans Extra Condensed', weights: [600, 700, 800], note: 'высокий и узкий, как в логотипе' },
  { name: 'Oswald', weights: [500, 600, 700], note: 'узкий плакатный' },
  { name: 'Yanone Kaffeesatz', weights: [500, 600, 700], note: 'узкий, тёплый' },
  { name: 'Amatic SC', weights: [700], note: 'рукописный, высокий' },
  { name: 'Dela Gothic One', weights: [400], note: 'очень жирный, необычный' },
  { name: 'Rubik', weights: [600, 700, 800], note: 'округлый, дружелюбный' },
  { name: 'Geologica', weights: [600, 700, 800], note: 'чёткий, современный' },
  { name: 'Jost', weights: [600, 700, 800], note: 'классический геометричный' },
  { name: 'Comfortaa', weights: [600, 700], note: 'круглый, нежный' },
  { name: 'Exo 2', weights: [600, 700, 800], note: 'технологичный' },
  { name: 'Playfair Display', weights: [600, 700, 800], note: 'контрастный с засечками' },
  { name: 'Cormorant', weights: [600, 700], note: 'изящный с засечками' },
  { name: 'Prata', weights: [400], note: 'элегантный, журнальный' },
  { name: 'Yeseva One', weights: [400], note: 'кокетливый с засечками' },
  { name: 'Forum', weights: [400], note: 'античный' },
  { name: 'Tenor Sans', weights: [400], note: 'лёгкий, модный' },
  { name: 'Caveat', weights: [600, 700], note: 'рукописный' },
  { name: 'Marck Script', weights: [400], note: 'каллиграфия' },
  { name: 'Lobster', weights: [400], note: 'ретро-надпись' },
  { name: 'Russo One', weights: [400], note: 'спортивный' },
  { name: 'Press Start 2P', weights: [400], note: 'пиксельный, как в играх' },
];
const BODY = [
  { name: 'Manrope', weights: [400, 500, 600, 700, 800] },
  { name: 'Montserrat', weights: [400, 500, 600, 700, 800] },
  { name: 'Inter', weights: [400, 500, 600, 700, 800] },
  { name: 'Onest', weights: [400, 500, 600, 700, 800] },
  { name: 'Golos Text', weights: [400, 500, 600, 700, 800] },
  { name: 'Rubik', weights: [400, 500, 600, 700, 800] },
  { name: 'Nunito', weights: [400, 500, 600, 700, 800] },
  { name: 'Raleway', weights: [400, 500, 600, 700, 800] },
  { name: 'Open Sans', weights: [400, 500, 600, 700, 800] },
  { name: 'Geologica', weights: [400, 500, 600, 700, 800] },
  { name: 'Jost', weights: [400, 500, 600, 700, 800] },
  { name: 'Comfortaa', weights: [400, 500, 600, 700] },
  { name: 'Roboto', weights: [400, 500, 700] },
  { name: 'Ubuntu', weights: [400, 500, 700] },
  { name: 'PT Sans', weights: [400, 700] },
  { name: 'Lora', weights: [400, 500, 600, 700] },
  { name: 'PT Serif', weights: [400, 700] },
];
const DEFAULT_DISPLAY = 'Montserrat Alternates';
const DEFAULT_BODY = 'Manrope';
const SERIF = ['Playfair Display', 'Cormorant', 'Prata', 'Yeseva One', 'Forum', 'Lora', 'PT Serif'];

function find(list, name) {
  return list.find((f) => f.name === name);
}
/** Сведения о шрифте; для «своего» шрифта с Google Fonts — только обычное начертание */
function resolve(name, kind) {
  const list = kind === 'display' ? DISPLAY : BODY;
  const clean = String(name || '').trim();
  if (!clean) return find(list, kind === 'display' ? DEFAULT_DISPLAY : DEFAULT_BODY);
  return find(list, clean) || find(kind === 'display' ? BODY : DISPLAY, clean) || { name: clean, weights: [400], custom: true };
}
function isValidName(name) {
  return /^[A-Za-z0-9 ]{2,60}$/.test(String(name || '').trim());
}
/** Ссылка на Google Fonts и CSS-переменные для страницы */
function headTags(salon) {
  const d = resolve(salon.fontDisplay, 'display');
  const b = resolve(salon.fontBody, 'body');
  const fam = (f, wanted) => {
    const w = f.custom ? [] : f.weights.filter((x) => wanted.includes(x));
    const ws = w.length ? w : f.weights.slice(-1);
    return `family=${f.name.replace(/ /g, '+')}${f.custom ? '' : ':wght@' + ws.join(';')}`;
  };
  const families = d.name === b.name ? [fam(b, [...new Set([...b.weights, ...d.weights])].sort((x, y) => x - y))] : [fam(d, d.weights), fam(b, b.weights)];
  const href = `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
  const dmax = Math.max(...d.weights);
  const dw = Math.min(800, dmax);
  const dw2 = d.weights.includes(700) ? 700 : d.weights.includes(600) ? 600 : dw;
  const fallback = (f) => (SERIF.includes(f.name) ? "Georgia, 'Times New Roman', serif" : "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
  const css = `html:root{--display:'${d.name}', ${fallback(d)};--body:'${b.name}', ${fallback(b)};--dw:${dw};--dw2:${dw2}}`;
  return `<link href="${href}" rel="stylesheet">\n  <style>${css}</style>`;
}

module.exports = { DISPLAY, BODY, resolve, isValidName, headTags, DEFAULT_DISPLAY, DEFAULT_BODY };
