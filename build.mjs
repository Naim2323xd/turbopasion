// TurboPasión — generador automático del sitio.
// Lee los feeds RSS de config.json, crea el sitio estático en ./public
// Uso:  node build.mjs      (no necesita instalar nada, solo Node 18+)

import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'public');
const cfg = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
const SITE_URL = (cfg.siteUrl || process.env.SITE_URL || '').replace(/\/+$/, '');
const BUILD_DATE = new Date();

// ---------------------------------------------------------------- utilidades

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  iexcl: '¡', iquest: '¿', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€', deg: '°', ordm: 'º', ordf: 'ª',
};

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    return NAMED[e] ?? m;
  });
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const uncdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const stripTags = (s) => s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const safeUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(u || '') ? u : '');
const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,.;:]+$/, '') + '…';
}

function slugify(s) {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// ---------------------------------------------------------------- lectura RSS

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? uncdata(m[1]).trim() : '';
}

function attr(block, tagName, attrName, filter) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  for (const m of block.matchAll(re)) {
    if (filter && !filter(m[0])) continue;
    const a = m[0].match(new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']+)["']`, 'i'));
    if (a) return decode(a[1]);
  }
  return '';
}

function parseFeed(xml, source) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) || [];
  const items = [];
  for (const b of blocks) {
    const title = clean(stripTags(decode(tag(b, 'title'))));
    let link = tag(b, 'link');
    if (!link) link = attr(b, 'link', 'href', (t) => !/rel=["'](?!alternate)/i.test(t));
    link = safeUrl(decode(link).trim());
    if (!title || !link) continue;

    const rawDate = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    let date = new Date(rawDate);
    if (isNaN(date) || date > BUILD_DATE) date = BUILD_DATE;

    const rawBody = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content');
    const html = decode(rawBody);
    let excerpt = clean(decode(stripTags(html)))
      .replace(/(The post|La entrada) .* (appeared first on|se publicó primero en|aparece primero en) .*$/i, '')
      .replace(/\s*(Leer más|Seguir leyendo|Continuar leyendo|\[…\]|\[\.\.\.\])\s*$/i, '')
      .trim();
    excerpt = truncate(excerpt, cfg.excerptLength);

    let image = '';
    if (cfg.showImages) {
      image =
        attr(b, 'media:content', 'url', (t) => !/type=["'](?!image)/i.test(t)) ||
        attr(b, 'media:thumbnail', 'url') ||
        attr(b, 'enclosure', 'url', (t) => /type=["']image/i.test(t)) ||
        attr(html + decode(tag(b, 'content:encoded')), 'img', 'src');
      image = safeUrl(image.trim()).replace(/^http:/, 'https:');
    }

    items.push({ title, link, date, excerpt, image, source: source.name, forceCategory: source.category || '' });
  }
  return items;
}

async function fetchFeed(source) {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TurboPasionBot/1.0; RSS reader)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    // Algunos medios publican el RSS en UTF-16: se detecta por los bytes nulos del inicio
    const buf = new Uint8Array(await res.arrayBuffer());
    const enc = buf[0] === 0xfe && buf[1] === 0xff ? 'utf-16be' : (buf[0] === 0xff && buf[1] === 0xfe) || buf[1] === 0 ? 'utf-16le' : 'utf-8';
    const items = parseFeed(new TextDecoder(enc).decode(buf), source)
      .sort((a, b) => b.date - a.date)
      .slice(0, cfg.maxPerSource);
    console.log(`  ✓ ${source.name}: ${items.length} noticias`);
    return items;
  } catch (e) {
    console.warn(`  ✗ ${source.name}: ${e.message}`);
    return [];
  }
}

function categorize(item) {
  const text = ' ' + normalize(item.title + ' ' + item.excerpt) + ' ';
  for (const cat of cfg.categories) {
    for (const kw of cat.keywords) {
      const k = normalize(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`[^a-z0-9]${k}[^a-z0-9]`).test(text)) return cat;
    }
  }
  return cfg.defaultCategory;
}

// ---------------------------------------------------------------- artículos propios (carpeta posts/)

function inlineMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|[\w./#-]+)\)/g, '<a href="$2">$1</a>');
}

function markdown(md) {
  return md.replace(/\r/g, '').split(/\n{2,}/).map((blk) => {
    blk = blk.trim();
    if (!blk) return '';
    const h = blk.match(/^(#{1,3})\s+(.*)$/);
    if (h) return `<h${h[1].length + 1}>${inlineMd(h[2])}</h${h[1].length + 1}>`;
    const img = blk.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+|[\w./-]+)\)$/);
    if (img) return `<figure><img src="${esc(img[2])}" alt="${esc(img[1])}" loading="lazy"></figure>`;
    if (/^[-*]\s+/.test(blk)) {
      return '<ul>' + blk.split('\n').map((l) => `<li>${inlineMd(l.replace(/^[-*]\s+/, ''))}</li>`).join('') + '</ul>';
    }
    if (/^\d+\.\s+/.test(blk)) {
      return '<ol>' + blk.split('\n').map((l) => `<li>${inlineMd(l.replace(/^\d+\.\s+/, ''))}</li>`).join('') + '</ol>';
    }
    return `<p>${inlineMd(blk.replace(/\n/g, ' '))}</p>`;
  }).join('\n');
}

async function loadPosts() {
  const dir = path.join(ROOT, 'posts');
  if (!existsSync(dir)) return [];
  const posts = [];
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.md'))) {
    const raw = (await readFile(path.join(dir, f), 'utf8')).replace(/^﻿/, '');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const meta = {};
    if (m) for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
    const body = m ? m[2] : raw;
    const date = new Date(/^\d{4}-\d\d-\d\d$/.test(meta.date || '') ? meta.date + 'T12:00:00' : meta.date || BUILD_DATE);
    posts.push({
      slug: slugify(f.replace(/\.md$/, '')),
      title: meta.title || f.replace(/\.md$/, ''),
      description: meta.description || truncate(clean(stripTags(markdown(body))), 160),
      image: meta.image || '',
      author: meta.author || cfg.author || cfg.siteName,
      date: isNaN(date) ? BUILD_DATE : date,
      html: markdown(body),
    });
  }
  return posts.sort((a, b) => b.date - a.date);
}

// ---------------------------------------------------------------- plantillas HTML

const ads = cfg.adsense || {};
const SOCIAL = (cfg.social || []).filter((r) => safeUrl(r.url));
const socialLinks = () => SOCIAL.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener me">${esc(r.name)}</a>`).join(' ');

function ad(slotName) {
  if (!ads.client) {
    return ads.showPlaceholders ? `<div class="ad ad--placeholder" aria-hidden="true">Espacio publicitario</div>` : '';
  }
  const slot = ads.slots?.[slotName];
  if (!slot) return ''; // sin bloque manual: Google coloca los anuncios automáticos
  return `<div class="ad"><span class="ad__label">Publicidad</span>
<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(ads.client)}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;
}

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23e10600'/%3E%3Cpath d='M14 18h36l-3 9H37l-7 21H19l7-21H11z' fill='%23fff'/%3E%3C/svg%3E";

function layout({ title, description, file, active = '', body, ogImage = '', ogType = 'website', jsonLd = null, author = '' }) {
  const fullTitle = title ? `${title} | ${cfg.siteName}` : `${cfg.siteName} — ${cfg.tagline}`;
  const canonical = SITE_URL ? `${SITE_URL}/${file === 'index.html' ? '' : file}` : '';
  const nav = [{ slug: '', name: 'Portada', href: 'index.html' },
    ...[...cfg.categories, cfg.defaultCategory].map((c) => ({ slug: c.slug, name: c.name, href: `cat-${c.slug}.html` })),
    { slug: 'redaccion', name: 'Redacción', href: 'redaccion.html' }];
  return `<!doctype html>
<html lang="${esc(cfg.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || cfg.description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:site_name" content="${esc(cfg.siteName)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || cfg.description)}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:locale" content="es_MX">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${author ? `<meta name="author" content="${esc(author)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="robots" content="max-image-preview:large">
${SITE_URL ? `<link rel="alternate" type="application/rss+xml" title="${esc(cfg.siteName)}: artículos" href="${esc(SITE_URL)}/feed.xml">` : ''}
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="theme-color" content="#0d0f12">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="style.css">
${ads.client ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ads.client)}" crossorigin="anonymous"></script>` : ''}
</head>
<body>
<header class="site-header">
  <div class="wrap site-header__in">
    <a class="logo" href="index.html" aria-label="${esc(cfg.siteName)}, portada"><span class="logo__mark">T</span>TURBO<b>PASIÓN</b></a>
    <p class="tagline">${esc(cfg.tagline)}</p>
  </div>
  <nav class="nav" aria-label="Secciones"><div class="wrap nav__in">
    ${nav.map((n) => `<a href="${n.href}"${n.slug === active ? ' class="is-active" aria-current="page"' : ''}>${esc(n.name)}</a>`).join('\n    ')}
  </div></nav>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p class="logo logo--small">TURBO<b>PASIÓN</b></p>
    <p>${esc(cfg.siteName)} es un agregador: cada titular enlaza a su medio original, que conserva todos los derechos sobre su contenido.</p>
    <p class="site-footer__links">
      <a href="acerca.html">Acerca de</a>
      <a href="contacto.html">Contacto</a>
      <a href="privacidad.html">Privacidad y cookies</a>
      <a href="aviso-legal.html">Aviso legal</a>
    </p>
    ${SOCIAL.length ? `<p class="site-footer__links site-footer__social"><span class="muted">Síguenos:</span>
      ${socialLinks()}</p>` : ""}
    <p class="muted">Última actualización: <time datetime="${BUILD_DATE.toISOString()}" data-full>${BUILD_DATE.toISOString()}</time> · © ${BUILD_DATE.getFullYear()} ${esc(cfg.siteName)}</p>
  </div>
</footer>
<script>
(function(){
  var rtf = new Intl.RelativeTimeFormat('es', {numeric:'auto'});
  document.querySelectorAll('time[datetime]').forEach(function(t){
    var d = new Date(t.getAttribute('datetime')); if (isNaN(d)) return;
    if (t.hasAttribute('data-full')) { t.textContent = d.toLocaleString('es', {dateStyle:'long', timeStyle:'short'}); return; }
    var min = Math.round((d - Date.now()) / 60000);
    t.textContent = Math.abs(min) < 60 ? rtf.format(min, 'minute')
      : Math.abs(min) < 1440 ? rtf.format(Math.round(min/60), 'hour')
      : Math.abs(min) < 10080 ? rtf.format(Math.round(min/1440), 'day')
      : d.toLocaleDateString('es', {day:'numeric', month:'short', year:'numeric'});
    t.title = d.toLocaleString('es');
  });
})();
</script>
</body>
</html>
`;
}

const fmtDate = (d) => d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

function thumb(item) {
  if (!item.image) return `<div class="thumb noimg"></div>`;
  return `<div class="thumb"><img src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('noimg');this.remove()"></div>`;
}

function card(item, big = false) {
  return `<article class="card${big ? ' card--hero' : ''}">
  <a class="card__link" href="${esc(item.link)}" target="_blank" rel="noopener">
    ${thumb(item)}
    <div class="card__body">
      <span class="chip">${esc(item.category.name)}</span>
      <h${big ? 2 : 3} class="card__title">${esc(item.title)}</h${big ? 2 : 3}>
      ${item.excerpt ? `<p class="card__excerpt">${esc(item.excerpt)}</p>` : ''}
      <p class="card__meta"><span class="source">${esc(item.source)} ↗</span><time datetime="${item.date.toISOString()}">${fmtDate(item.date)}</time></p>
    </div>
  </a>
</article>`;
}

function grid(items) {
  const out = [];
  items.forEach((it, i) => {
    out.push(card(it));
    if ((i + 1) % 9 === 0 && i + 1 < items.length) out.push(`<div class="grid__ad">${ad('infeed')}</div>`);
  });
  return `<div class="grid">${out.join('\n')}</div>`;
}

function postCard(p) {
  return `<article class="card card--post">
  <a class="card__link" href="post-${p.slug}.html">
    <div class="card__body">
      <span class="chip chip--own">TurboPasión</span>
      <h3 class="card__title">${esc(p.title)}</h3>
      <p class="card__excerpt">${esc(p.description)}</p>
      <p class="card__meta"><span class="source">Por ${esc(p.author)}</span><time datetime="${p.date.toISOString()}">${fmtDate(p.date)}</time></p>
    </div>
  </a>
</article>`;
}

function pager(page, total) {
  if (total < 2) return '';
  const href = (n) => (n === 1 ? 'index.html' : `pagina-${n}.html`);
  return `<nav class="pager" aria-label="Paginación">
  ${page > 1 ? `<a href="${href(page - 1)}" rel="prev">← Más recientes</a>` : '<span></span>'}
  <span class="muted">Página ${page} de ${total}</span>
  ${page < total ? `<a href="${href(page + 1)}" rel="next">Anteriores →</a>` : '<span></span>'}
</nav>`;
}

function staticPage(title, html) {
  return `<article class="prose"><h1>${esc(title)}</h1>${html}</article>`;
}

// ---------------------------------------------------------------- construcción

console.log('Descargando feeds…');
const fetched = (await Promise.all(cfg.feeds.map(fetchFeed))).flat();

const seen = new Set();
const items = [];
for (const it of fetched.sort((a, b) => b.date - a.date)) {
  const kLink = it.link.replace(/[?#].*$/, '');
  const kTitle = normalize(it.title);
  if (seen.has(kLink) || seen.has(kTitle)) continue;
  seen.add(kLink); seen.add(kTitle);
  it.category = cfg.categories.find((c) => c.slug === it.forceCategory) || categorize(it);
  items.push(it);
}
if (items.length === 0) {
  console.error('No se pudo descargar ninguna noticia: se conserva el sitio anterior.');
  process.exit(1);
}

const posts = await loadPosts();

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const written = [];
async function write(file, html) {
  await writeFile(path.join(OUT, file), html, 'utf8');
  if (file.endsWith('.html')) written.push(file);
}

await copyFile(path.join(ROOT, 'src', 'style.css'), path.join(OUT, 'style.css'));

// Portada y páginas siguientes
const per = cfg.itemsPerPage;
const totalPages = Math.min(cfg.maxPages, Math.ceil(items.length / per));
for (let p = 1; p <= totalPages; p++) {
  const slice = items.slice((p - 1) * per, p * per);
  let body;
  if (p === 1) {
    const [hero, ...rest] = slice;
    body = `<h1 class="sr-only">${esc(cfg.siteName)}: ${esc(cfg.tagline)}</h1>
${card(hero, true)}
${ad('top')}
${posts.length ? `<section><h2 class="section-title">De la redacción</h2><div class="grid grid--posts">${posts.slice(0, 3).map(postCard).join('\n')}</div>${posts.length > 3 ? `<p class="more"><a href="redaccion.html">Ver todos los artículos →</a></p>` : ''}</section>` : ''}
<section><h2 class="section-title">Últimas noticias</h2>
${grid(rest)}</section>`;
  } else {
    body = `<h1 class="section-title">Noticias anteriores · página ${p}</h1>\n${grid(slice)}`;
  }
  body += `\n${pager(p, totalPages)}\n${ad('bottom')}`;
  await write(p === 1 ? 'index.html' : `pagina-${p}.html`, layout({
    title: p === 1 ? '' : `Noticias del motor, página ${p}`,
    file: p === 1 ? 'index.html' : `pagina-${p}.html`,
    body, ogImage: slice[0]?.image,
    jsonLd: p === 1 ? { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.siteName, description: cfg.description, inLanguage: cfg.language, ...(SITE_URL ? { url: SITE_URL + '/' } : {}), ...(SOCIAL.length ? { sameAs: SOCIAL.map((r) => r.url) } : {}) } : null,
  }));
}

// Categorías
for (const cat of [...cfg.categories, cfg.defaultCategory]) {
  const list = items.filter((i) => i.category.slug === cat.slug).slice(0, per * 2);
  const body = `<h1 class="section-title">${esc(cat.name)}</h1>
${ad('top')}
${list.length ? grid(list) : '<p class="muted">Ahora mismo no hay noticias en esta sección. Vuelve en un rato.</p>'}
${ad('bottom')}`;
  await write(`cat-${cat.slug}.html`, layout({
    title: `${cat.name}: últimas noticias`,
    description: `Últimas noticias de ${cat.name.toLowerCase()} en ${cfg.siteName}, actualizadas cada hora.`,
    file: `cat-${cat.slug}.html`, active: cat.slug, body,
  }));
}

// Artículos propios
function shareLinks(p) {
  if (!SITE_URL) return '';
  const url = encodeURIComponent(`${SITE_URL}/post-${p.slug}.html`);
  const text = encodeURIComponent(p.title);
  return `<p class="share"><span class="muted">Compartir:</span>
  <a href="https://wa.me/?text=${text}%20${url}" target="_blank" rel="noopener">WhatsApp</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=${url}" target="_blank" rel="noopener">Facebook</a>
  <a href="https://twitter.com/intent/tweet?text=${text}&amp;url=${url}" target="_blank" rel="noopener">X</a>
  <a href="https://t.me/share/url?url=${url}&amp;text=${text}" target="_blank" rel="noopener">Telegram</a></p>`;
}
for (const p of posts) {
  const body = `<article class="prose">
<p class="chip chip--own">TurboPasión</p>
<h1>${esc(p.title)}</h1>
<p class="muted byline">Por <a href="acerca.html" rel="author">${esc(p.author)}</a> · ${fmtDate(p.date)}</p>
${p.image ? `<figure><img src="${esc(p.image)}" alt=""></figure>` : ''}
${ad('article')}
${p.html}
${shareLinks(p)}
${ad('bottom')}
</article>
${posts.length > 1 ? `<section><h2 class="section-title">Más de la redacción</h2><div class="grid grid--posts">${posts.filter((o) => o !== p).slice(0, 3).map(postCard).join('\n')}</div></section>` : ''}`;
  await write(`post-${p.slug}.html`, layout({
    title: p.title, description: p.description, file: `post-${p.slug}.html`, active: 'redaccion', body, ogImage: p.image, ogType: 'article', author: p.author,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Article', headline: p.title, description: p.description, inLanguage: cfg.language,
      datePublished: p.date.toISOString(), dateModified: p.date.toISOString(),
      author: p.author === cfg.siteName ? { '@type': 'Organization', name: cfg.siteName } : { '@type': 'Person', name: p.author, ...(SITE_URL ? { url: SITE_URL + '/acerca.html' } : {}) }, publisher: { '@type': 'Organization', name: cfg.siteName },
      ...(p.image ? { image: p.image } : {}),
      ...(SITE_URL ? { mainEntityOfPage: `${SITE_URL}/post-${p.slug}.html` } : {}),
    },
  }));
}

// Índice de artículos propios
await write('redaccion.html', layout({
  title: 'De la redacción: guías y artículos',
  description: `Guías, explicaciones y artículos propios de ${cfg.siteName} sobre el mundo del motor.`,
  file: 'redaccion.html', active: 'redaccion',
  body: `<h1 class="section-title">De la redacción</h1>
<p class="muted">Guías, explicaciones y artículos escritos por ${esc(cfg.siteName)}.</p>
${posts.length ? `<div class="grid grid--posts">${posts.map(postCard).join('\n')}</div>` : '<p class="muted">Pronto publicaremos aquí nuestros artículos.</p>'}
${ad('bottom')}`,
}));

// Canal RSS de los artículos propios
if (SITE_URL) {
  await writeFile(path.join(OUT, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(cfg.siteName)}</title><link>${esc(SITE_URL)}/</link><description>${esc(cfg.description)}</description><language>${esc(cfg.language)}</language>
${posts.slice(0, 30).map((p) => `<item><title>${esc(p.title)}</title><link>${esc(SITE_URL)}/post-${p.slug}.html</link><guid>${esc(SITE_URL)}/post-${p.slug}.html</guid><pubDate>${p.date.toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join('\n')}
</channel></rss>
`, 'utf8');
}

// Páginas legales (necesarias para Google AdSense)
const mail = esc(cfg.contactEmail);
const sources = cfg.feeds.map((f) => esc(f.name)).join(', ');
const pages = {
  'acerca.html': ['Acerca de ' + cfg.siteName, `
<p>${esc(cfg.siteName)} es un punto de encuentro para quienes viven el motor en México. Reunimos en una sola página los titulares más recientes sobre autos y motos en México: modelos que llegan al país, precios y financiamiento, eléctricos, SUV y pickups, e industria automotriz.</p>
<h2>Cómo funciona</h2>
<p>El sitio se actualiza automáticamente cada hora. Leemos los canales RSS públicos de medios especializados (${sources}) y mostramos el titular, un breve extracto y el enlace a la noticia original. Para leer la noticia completa siempre se visita el medio que la publicó.</p>
<p>Además publicamos artículos propios en la sección «De la redacción».</p>
${cfg.author ? `<h2>Quién escribe</h2>
<p>Los artículos propios de ${esc(cfg.siteName)} los firma <strong>${esc(cfg.author)}</strong>, editor del sitio. Se elaboran a partir de información pública de armadoras, organismos del sector y medios especializados, se redactan con palabras propias y enlazan sus fuentes al final de cada texto.</p>` : ''}
<h2>Contacto</h2>
<p>¿Sugerencias, correcciones o quieres que retiremos tu medio? Escríbenos a <a href="mailto:${mail}">${mail}</a>.</p>`],
  'contacto.html': ['Contacto', `
<p>Puedes escribirnos a <a href="mailto:${mail}">${mail}</a> para:</p>
<ul><li>Sugerencias y comentarios sobre el sitio.</li><li>Avisar de un error en un titular o enlace.</li><li>Solicitar la retirada de contenidos de tu medio.</li><li>Propuestas de publicidad y colaboración.</li></ul>
<p>Respondemos lo antes posible.</p>${SOCIAL.length ? `<h2>Redes sociales</h2><ul>${SOCIAL.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener me">${esc(r.name)}</a>: ${esc(r.handle || "")}</li>`).join("")}</ul>` : ""}`],
  'privacidad.html': ['Política de privacidad y cookies', `
<p>En ${esc(cfg.siteName)} respetamos tu privacidad. Esta página explica qué datos se tratan cuando visitas el sitio.</p>
<h2>Datos que recogemos</h2>
<p>${esc(cfg.siteName)} no tiene registro de usuarios ni formularios, y no recoge directamente datos personales. El servidor que aloja la web puede registrar datos técnicos (dirección IP, navegador, fecha y hora) con fines de seguridad.</p>
<h2>Publicidad de Google AdSense</h2>
<p>Este sitio muestra anuncios de Google AdSense. Google y sus socios, como proveedores externos, utilizan cookies para mostrar anuncios basados en tus visitas anteriores a este y a otros sitios web.</p>
<ul>
<li>Puedes desactivar la publicidad personalizada en la <a href="https://www.google.com/settings/ads" rel="noopener">Configuración de anuncios de Google</a>.</li>
<li>Puedes desactivar las cookies de otros proveedores en <a href="https://www.aboutads.info/choices/" rel="noopener">aboutads.info</a> o <a href="https://www.youronlinechoices.eu/" rel="noopener">youronlinechoices.eu</a>.</li>
<li>Más información: <a href="https://policies.google.com/technologies/partner-sites?hl=es" rel="noopener">Cómo usa Google la información de los sitios que utilizan sus servicios</a>.</li>
</ul>
<h2>Cookies</h2>
<p>${esc(cfg.siteName)} no instala cookies propias. Las cookies presentes provienen de Google (publicidad y medición). Puedes bloquearlas o eliminarlas desde la configuración de tu navegador.</p>
<h2>Enlaces a otros sitios</h2>
<p>Las noticias enlazan a medios externos, cada uno con su propia política de privacidad, sobre la que no tenemos control.</p>
<h2>Contacto</h2>
<p>Para cualquier consulta sobre privacidad: <a href="mailto:${mail}">${mail}</a>.</p>
<p class="muted">Última revisión: ${fmtDate(BUILD_DATE)}.</p>`],
  'aviso-legal.html': ['Aviso legal', `
<h2>Naturaleza del sitio</h2>
<p>${esc(cfg.siteName)} es un agregador de noticias del motor. Muestra titulares, extractos breves y enlaces obtenidos de los canales RSS que los propios medios publican para su difusión.</p>
<h2>Propiedad intelectual</h2>
<p>Los titulares, textos e imágenes de las noticias enlazadas pertenecen a sus respectivos autores y medios. ${esc(cfg.siteName)} no reproduce los artículos completos: para leerlos se remite siempre a la fuente original, que aparece indicada en cada noticia.</p>
<p>Si eres titular de algún contenido y deseas que no aparezca aquí, escríbenos a <a href="mailto:${mail}">${mail}</a> y lo retiraremos a la mayor brevedad.</p>
<h2>Responsabilidad</h2>
<p>${esc(cfg.siteName)} no se hace responsable de la exactitud de las informaciones publicadas por terceros ni del contenido de los sitios enlazados.</p>`],
};
for (const [file, [title, html]] of Object.entries(pages)) {
  await write(file, layout({ title, file, body: staticPage(title, html) }));
}

// Página de error 404 (no entra en el sitemap)
await writeFile(path.join(OUT, '404.html'), layout({ title: 'Página no encontrada', file: '404.html', body: staticPage('Página no encontrada', '<p>La página que buscas no existe o cambió de dirección.</p><p><a href="/">Volver a la portada</a> o revisa los artículos de <a href="/redaccion.html">la redacción</a>.</p>') }).replace('<link rel="stylesheet" href="style.css">', '<meta name="robots" content="noindex"><base href="/"><link rel="stylesheet" href="style.css">'), 'utf8');

// robots.txt, sitemap.xml, ads.txt
await write('robots.txt', `User-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ''}`);
if (SITE_URL) {
  await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${written.map((f) => `  <url><loc>${esc(`${SITE_URL}/${f === 'index.html' ? '' : f}`)}</loc><lastmod>${BUILD_DATE.toISOString()}</lastmod></url>`).join('\n')}
</urlset>
`);
}
if (ads.client) {
  await write('ads.txt', `google.com, ${ads.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
}
await write('.nojekyll', '');

console.log(`\nListo: ${items.length} noticias, ${posts.length} artículos propios, ${written.length} páginas en ./public`);
if (!SITE_URL) console.log('Aviso: falta "siteUrl" en config.json, por eso no se generó sitemap.xml.');
if (!ads.client) console.log('Aviso: falta el ID de AdSense en config.json (adsense.client).');
