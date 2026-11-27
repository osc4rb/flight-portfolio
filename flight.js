/* flight.js — "Fly in": a small flight sim that is also the portfolio.
   Door (plain, instant) -> the porthole in the Fly button opens into the 3D world (Three.js r170, pinned CDN,
   loaded only on demand) -> title card -> free flight over an island. Four landmarks open the four sections of
   site.js as aviation paperwork; radio beacons carry single projects. Models, landmarks and the HUD live in
   planes.js, landmarks.js and hud.js (window.FlightParts). All words come from window.FLIGHT_SITE (site.js).
   ?plain=1 renders the same paperwork as one readable page, with no 3D at all. */
(function () {
  'use strict';
  const S = window.FLIGHT_SITE || {}, FL = S, FP = window.FlightParts || {};
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
  const RAPIER_URL = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js';   // physics, WASM inlined
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const COARSE = matchMedia('(pointer: coarse)').matches;
  if (COARSE) document.documentElement.classList.add('coarse');
  const RM_OS = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const H = S.pilot || {}, A = S.about || {}, FG = S.flagships || {}, M = S.matrix || {}, C = S.contact || {};
  const AVATAR = S.avatar || 'assets/portrait.svg';   // owner rule: GitHub avatar only
  const DOOR = S.door || {}, CALL = S.callsign || '', NAME = S.name || '';
  const PLACES = (FL.places && FL.places.length ? FL.places : ['about', 'flagships', 'matrix', 'contact'].map(s => ({ section: s, name: s, line: '' })))
    .map((p, i) => Object.assign({ i, color: ['#f2c94c', '#5fb3cf', '#9fe0b7', '#d9533f'][i % 4] }, p));
  const PLANES = FP.planes || {};

  const SET = Object.assign({ time: 'auto', quality: 'auto', sound: false, invert: false, motion: RM_OS ? 'reduced' : 'full', hud: true,
    plane: PLANES[FL.aircraft] ? FL.aircraft : 'f35', cam: 'chase', assist: true }, store.get('flight-settings', {}));
  const saveSet = () => store.set('flight-settings', SET);
  const patches = store.get('flight-patches', {});
  const RM = () => SET.motion === 'reduced';

  const st = { mode: 'door', keys: {}, stick: { x: 0, y: 0, id: null, ox: 0, oy: 0 }, thrTouch: null, abTouch: false, pad: {}, visited: new Set(), heard: new Set(),
    opened: new Set(), prompt: null, ap: null, shake: 0, rollAcc: 0, nightT: 0, diveT: 0, crashes: 0, bubbleT: 0, warnT: 0 };
  const P = { v: 210, thr: 0.7, ab: false, pi: 0, ri: 0, yi: 0, g: 1, bank: 0, pitch: 0, hdg: 0, agl: 999 };

  const door = $('#door'), world = $('#world'), ui = $('#ui'), sheet = $('#sheet'), sbody = $('#sheet-body'), sfoot = $('#sheet-foot'), menu = $('#menu'), mapEl = $('#map');
  let T = null, RAP = null, W = null, toastT = 0, lastFocus = null, sheetClose = null;

  function toast(msg, gold) {
    const el = $('#toast'); el.textContent = msg; el.classList.toggle('gold', !!gold); el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600);
  }
  function copy(text) {
    const done = () => toast('Copied ' + text);
    const legacy = () => { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { toast(text); } t.remove(); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, legacy); else legacy();
  }
  function award(id) {
    if (patches[id]) return; const p = (FL.patches || []).find(x => x.id === id); if (!p) return;
    patches[id] = Date.now(); store.set('flight-patches', patches); toast('Patch earned · ' + p.name, true); Snd.chime();
  }

  // =================================================================== front door
  const JET = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 6.5 7.4 5.5v1.8l-7.2-2.6-.5 5 2.4 2v1.4L12 20.6l-3.7 1v-1.4l2.4-2-.5-5L3 15.8V14l7.4-5.5z"/></svg>';
  // the home page (2026-11-25): tabs, cards and hovers after silvjurado.com, kept black. Fly in is the front page and
  // the biggest thing on it; CV is the résumé (one column after husam.world/facts, henrp-style dates); Projects and
  // Contact come from site.js → home. The tabs are hash routes, so links like index.html#research open the CV there.
  // ?plain=1 (the desk's screen in the world) shows the CV alone.
  const TABS = ['fly', 'cv', 'projects', 'contact'];
  function renderDoor(plain) {
    const V = S.home || {}, secs = V.sections || [], TB = V.tabs || {}, HR = V.hero || {}, HC = HR.cards || {};
    const links = (C.links || []).filter(l => l.href && !/^mailto:/.test(l.href)), ext = h => /^https?:/.test(h) ? ' target="_blank" rel="noopener"' : '';
    const item = it => it.sub ? `<li class="sub"><h3>${esc(it.sub)}</h3></li>`
      : `<li><span class="when">${esc(it.when || '')}</span><p>${it.href ? `<a href="${esc(it.href)}"${ext(it.href)}><b>${esc(it.lead || '')}</b></a>` : `<b>${esc(it.lead || '')}</b>`}${it.text ? ' ' + md(it.text) : ''}</p></li>`;
    const arrow = '<span class="arw" aria-hidden="true">→</span>';
    const cv = `<div class="rs" id="rs">
      <header class="rs-head">
        <div class="rs-top"><h1>${esc(NAME)}</h1></div>
        ${V.lede ? `<p class="lede">${md(V.lede)}</p>` : ''}
        <p class="contact">${C.email ? `<a href="mailto:${esc(C.email)}">${esc(C.email)}</a> <button type="button" class="link" data-copy>Copy</button>` : ''}
          ${links.map(l => `<a href="${esc(l.href)}"${ext(l.href)}>${esc(l.label)}</a>`).join('')}<button type="button" class="link" data-pdf>${esc(V.pdf || 'Save as PDF')}</button></p>
      </header>
      <nav class="rs-index" aria-label="Sections"><span class="idx">${secs.map(s => `<a href="#${esc(s.id)}">${esc(s.title)}</a>`).join('<i aria-hidden="true">·</i>')}</span>
        <label class="flt"><span class="vh">${esc(V.filter || 'Filter')}</span><input id="rs-filter" type="search" placeholder="${esc(V.filter || 'Filter')}" autocomplete="off" spellcheck="false"></label></nav>
      <p class="rs-none" id="rs-none" hidden>${esc(V.empty || 'Nothing matches.')} <button type="button" class="link" id="rs-clear">Clear the filter</button></p>
      ${secs.map(s => `<section id="${esc(s.id)}" aria-labelledby="h-${esc(s.id)}"><h2 id="h-${esc(s.id)}">${esc(s.title)}</h2><ul class="items">${(s.items || []).map(item).join('')}</ul></section>`).join('')}
    </div>`;
    const foot = (C.footer || []).length ? `<footer class="rs-foot">${C.footer.map(esc).join(' ')}</footer>` : '';
    if (plain) { door.innerHTML = `<main id="content" class="pane pane-cv">${cv}${foot}</main>`; wireCv(); return; }

    // the front page: the name, the lede, and four small panes; Fly in is the first and the highlighted one
    const panes = TABS.filter(t => t !== 'fly').map((t, i) => `<a class="pn fu" href="#${t}" data-tilt>
        <span class="pn-top"><span class="pn-n">${String(i + 1).padStart(2, '0')}</span><span class="arw" aria-hidden="true">→</span></span><b>${esc(TB[t] || t)}</b></a>`).join('');
    const proj = (V.projects || []).map(p => { const tag = p.href ? 'a' : 'article', at = p.href ? ` href="${esc(p.href)}"${ext(p.href)}` : '';
      return `<${tag} class="pc fu"${at} data-tilt><span class="pn-top"><span class="pn-n">${esc(p.tag || '')}</span>${p.href ? `<span class="arw" aria-hidden="true">${/^https?:/.test(p.href) ? '↗' : '→'}</span>` : ''}</span><b>${esc(p.title)}</b><p>${md(p.text || '')}</p></${tag}>`; }).join('');
    const contact = `<h2 class="pg-h fu">${esc(TB.contact || 'Contact')}</h2>
      <div class="ct">${C.email ? `<div class="ct-row fu"><a href="mailto:${esc(C.email)}">${esc(C.email)}</a><button type="button" class="pill" data-copy>${esc(C.copyLabel || 'Copy')}</button></div>` : ''}
        ${links.map(l => `<a class="ct-row fu" href="${esc(l.href)}"${ext(l.href)} data-tilt><b>${esc(l.label)}</b><span class="arw" aria-hidden="true">↗</span></a>`).join('')}</div>`;

    door.innerHTML = `<header class="hd is-top"><div class="hd-in"><a class="hd-name" href="#fly">${esc(NAME)}</a>
        <nav class="hd-tabs" aria-label="Pages"><span class="tab-pill" aria-hidden="true"></span>${TABS.map(t => `<a href="#${t}" data-tab="${t}">${esc(TB[t] || t)}</a>`).join('')}</nav></div></header>
      <main id="content">
        <section class="pane pane-fly" data-pane="fly" aria-label="${esc(TB.fly || 'Fly in')}">
          <div class="hx"><a class="hx-img" href="world/index.html" tabindex="-1" aria-hidden="true"><img src="assets/world-hero.webp" alt="" width="2200" height="1100" fetchpriority="high" decoding="async"></a>
            <div class="hx-text"><h1 class="hero-h fu">${esc(NAME)}</h1>${V.lede ? `<p class="hero-l fu">${md(V.lede)}</p>` : ''}<a class="hx-fly fu" href="world/index.html">${esc(TB.fly || 'Fly in')}<span class="arw" aria-hidden="true">→</span></a></div></div>
          <div class="pane-in"><div class="pns">${panes}</div></div></section>
        <section class="pane pane-cv" data-pane="cv" aria-label="${esc(TB.cv || 'CV')}" hidden>${cv}</section>
        <section class="pane" data-pane="projects" aria-label="${esc(TB.projects || 'Projects')}" hidden><h2 class="pg-h fu">${esc(TB.projects || 'Projects')}</h2><div class="pcs">${proj}</div></section>
        <section class="pane" data-pane="contact" aria-label="${esc(TB.contact || 'Contact')}" hidden>${contact}</section>
        ${foot}
      </main>`;
    wireCv();
    const hd = door.querySelector('.hd'), pill = door.querySelector('.tab-pill');
    // fade up as things come into view; the header stays clear at the top and tints once you scroll (Jurado's)
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
    const reveal = () => door.querySelectorAll('.pane:not([hidden]) .fu:not(.in)').forEach((el, i) => { el.style.transitionDelay = Math.min(i, 6) * 45 + 'ms'; io ? io.observe(el) : el.classList.add('in'); });
    const hxImg = door.querySelector('.hx-img img'); let hxRaf = 0;
    const top = () => { hd.classList.toggle('is-top', scrollY <= 8);
      if (hxImg && !RM_OS && !hxRaf) hxRaf = requestAnimationFrame(() => { hxRaf = 0; const y = Math.min(scrollY, 800); hxImg.style.transform = `translateY(${(y * 0.18).toFixed(1)}px) scale(${(1 + y * 0.00025).toFixed(4)})`; }); };
    addEventListener('scroll', top, { passive: true });
    // the pill behind the current tab slides to the new one
    const place = (a, still) => { if (!a) return; if (still) pill.style.transition = 'none'; pill.style.width = a.offsetWidth + 'px'; pill.style.transform = `translateX(${a.offsetLeft}px)`; if (still) { void pill.offsetWidth; pill.style.transition = ''; } };
    // cards lean toward the pointer, lift and catch a soft glare (Jurado's: 4.5° at the edges)
    if (matchMedia('(hover: hover) and (pointer: fine)').matches && !RM_OS && !RM()) door.querySelectorAll('[data-tilt]').forEach(el => {
      let raf = 0;
      el.addEventListener('pointermove', e => { raf = raf || requestAnimationFrame(() => { raf = 0; const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.classList.add('tilting'); el.style.setProperty('--rx', ((0.5 - y) * 9).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((x - 0.5) * 9).toFixed(2) + 'deg');
        el.style.setProperty('--gxp', (x * r.width).toFixed(1) + 'px'); el.style.setProperty('--gyp', (y * r.height).toFixed(1) + 'px'); el.style.setProperty('--glare', 1); }); });
      el.addEventListener('pointerleave', () => { cancelAnimationFrame(raf); raf = 0; el.classList.remove('tilting'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); el.style.setProperty('--glare', 0); });
    });
    // tabs: #fly #cv #projects #contact, or any id inside the CV (a section) → the CV tab, scrolled there
    let cur = null;
    const route = () => {
      const h = decodeURIComponent(location.hash.slice(1)), inCv = h && door.querySelector(`.pane-cv [id="${h.replace(/"/g, '')}"]`);
      const tab = TABS.includes(h) ? h : inCv ? 'cv' : (cur || 'fly');
      door.querySelectorAll('.pane[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab; });
      door.querySelectorAll('.hd-tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
      place(door.querySelector(`.hd-tabs a[data-tab="${tab}"]`), cur === null);
      if (tab !== cur || TABS.includes(h)) scrollTo(0, 0);
      if (inCv) inCv.scrollIntoView();
      cur = tab; reveal(); top();
    };
    addEventListener('hashchange', route);
    addEventListener('resize', () => place(door.querySelector('.hd-tabs a[aria-current=page]'), true));
    route();
    if (document.fonts) document.fonts.ready.then(() => place(door.querySelector('.hd-tabs a[aria-current=page]'), true));
  }
  function wireCv() {
    door.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copy(C.email)));
    door.querySelectorAll('[data-pdf]').forEach(b => b.addEventListener('click', () => print()));
    // filter: hide items that don't match, then empty sections; sub-headings follow their items
    const inp = $('#rs-filter'), none = $('#rs-none');
    const run = () => { const q = inp.value.trim().toLowerCase(); let any = false;
      door.querySelectorAll('.rs section').forEach(sec => { let shown = 0, lastSub = null, subShown = 0;
        const fin = () => { if (lastSub) lastSub.hidden = !!q && !subShown; };
        sec.querySelectorAll('.items > li').forEach(li => {
          if (li.classList.contains('sub')) { fin(); lastSub = li; subShown = 0; return; }
          const hit = !q || li.textContent.toLowerCase().includes(q) || sec.querySelector('h2').textContent.toLowerCase().includes(q);
          li.hidden = !hit; if (hit) { shown++; subShown++; } });
        fin(); sec.hidden = !shown; if (shown) any = true; });
      none.hidden = any; };
    inp.addEventListener('input', run);
    $('#rs-clear').addEventListener('click', () => { inp.value = ''; run(); inp.focus(); });
  }
  let busy = false;
  async function flyIn() {
    if (busy) return; busy = true;
    door.classList.add('loading'); const lab = $('#fly-l'); if (lab) lab.textContent = 'Spooling up…';
    const ok = await ensureWorld();
    door.classList.remove('loading'); if (lab) lab.textContent = (S.home || {}).play || DOOR.fly || 'Fly in'; busy = false;
    if (ok) dive();
  }
  function dive() {
    if (!/[?&]fly=1/.test(location.search)) history.pushState({ fly: 1 }, '', '?fly=1' + (/[?&]debug=1/.test(location.search) ? '&debug=1' : ''));
    const r = ($('#port') || door).getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const far = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 20;
    world.style.setProperty('--x', cx + 'px'); world.style.setProperty('--y', cy + 'px'); world.style.setProperty('--r', '19px');
    world.classList.add('diving'); world.hidden = false; resize(); spawn(); st.mode = 'dive'; st.diveT = 0; ui.innerHTML = '';
    Snd.set(SET.sound); Snd.whoosh();
    const t0 = performance.now(), dur = RM() ? 10 : 1100;
    (function grow() {                                   // setTimeout, not rAF: finishes even in a background tab
      const k = clamp((performance.now() - t0) / dur, 0, 1);
      world.style.setProperty('--r', (19 + (far - 19) * ease(k)) + 'px');
      if (k < 1) setTimeout(grow, 16); else { world.classList.remove('diving'); door.hidden = true; }
    })();
  }
  function showDoor() {
    closeAll(); st.mode = 'door'; world.hidden = true; world.classList.remove('flying', 'photo'); door.hidden = false; Snd.engine(0, 0, false);
    const f = $('#fly'); if (f) f.focus({ preventScroll: true });
  }
  function toDoor() { if (/[?&]fly=1/.test(location.search)) history.pushState(null, '', location.pathname); showDoor(); }
  addEventListener('popstate', () => { if (st.mode === 'plain') return; if (/[?&]fly=1/.test(location.search)) { if (W) dive(); else flyIn(); } else showDoor(); });

  // =================================================================== section paperwork
  const chips = a => (a && a.length) ? `<ul class="chips">${a.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '';
  function ticket(it) {
    const l = it.num || it.id || '', r = it.tag || it.category || '';
    return `<article class="ticket">${l || r ? `<div class="t-top"><span>${esc(l)}</span><span>${esc(r)}</span></div>` : ''}<h3>${esc(it.title)}</h3>
      ${it.text ? `<p>${md(it.text)}</p>` : ''}${it.bullets ? `<ul>${it.bullets.map(b => `<li>${md(b)}</li>`).join('')}</ul>` : ''}${chips(it.chips)}
      ${it.status ? `<p class="small" style="margin:8px 0 0">Status: <b>${esc(it.status)}</b></p>` : ''}
      ${it.href ? `<a class="btn ink sm" href="${esc(it.href)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</article>`;
  }
  const CAT_COL = ['#f2c94c', '#5fb3cf', '#9fe0b7', '#d9533f', '#b9a6ff'];
  const layerHTML = l => l ? `<div class="code">${esc(l.code)}</div><h3>${esc(l.title)}</h3><p>${md(l.text)}</p>${chips(l.chips)}` : '';
  function sectionHTML(id) {
    if (id === 'about') return `<div class="pif"><div class="pif-top"><img class="pif-pic" src="${esc(AVATAR)}" alt="${esc(S.avatarAlt || '')}" referrerpolicy="no-referrer">
        <div style="flex:1;min-width:0"><p class="eyebrow">${esc(A.eyebrow)} · pilot information file</p><h2 class="disp" id="sheet-title">${esc(NAME)}</h2><p class="small" style="margin:0">${esc(H.role)}</p>
        <dl class="fields"><div><dt>Callsign</dt><dd>${esc(CALL)}</dd></div>${(H.stats || []).map(s => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join('')}</dl></div></div>
      <p class="lead">${md(H.lead)}</p><span class="bar">${esc(A.title)}</span>${(A.paragraphs || []).map(p => `<p>${md(p)}</p>`).join('')}
      ${A.quote ? `<blockquote class="sticky">${esc(A.quote)}</blockquote>` : ''}
      <span class="bar">Checklist · principles</span><ol class="ck">${(A.principles || []).map(p => `<li><div class="row"><span class="num">${esc(p.num)}</span><span class="name">${esc(p.title)}</span><span class="dots"></span><span class="val">CHECK</span></div><p>${md(p.text)}</p></li>`).join('')}</ol>
      <span class="bar">Highlights</span><div class="tickets">${(H.highlights || []).map(ticket).join('')}</div>
      <span class="bar">Toolkit</span>${chips(H.skills)}</div>`;
    if (id === 'flagships') {
      const ft = FG.feature || {}, L = ft.layers || [];
      return `<div class="knee"><div class="clip"></div><p class="eyebrow">${esc(FG.eyebrow)} · kneeboard</p><h2 class="disp" id="sheet-title">${esc(FG.title)}</h2><p>${md(FG.intro)}</p>
        <section class="brief"><span class="tag-ink">${esc(ft.tag)}</span><h3>${esc(ft.title)}</h3><p>${md(ft.text)}</p>
          <div class="bignums">${(ft.stats || []).map(s => `<div><b>${esc(s.value)}</b><small>${esc(s.label)}</small></div>`).join('')}</div>
          ${L.length ? `<span class="bar" style="margin-top:6px">${esc(ft.layersTitle || '')}</span><div class="stages" role="tablist">${L.map((l, i) => `<button type="button" class="tab" role="tab" data-layer="${i}" aria-selected="${i === 0}">${esc(l.tab)}</button>`).join('')}</div>
          <div class="layer" id="layer">${layerHTML(L[0])}</div>` : ''}</section>
        <span class="bar">Deployments</span><div class="tickets">${(FG.cards || []).map(ticket).join('')}</div></div>`;
    }
    if (id === 'matrix') {
      const items = M.items || [], cats = Array.from(new Set(items.map(i => i.category).filter(Boolean)));
      return `<p class="eyebrow">${esc(M.eyebrow)} · flight progress strips</p><h2 class="disp" id="sheet-title">${esc(M.title)}</h2><p>${md(M.intro)}</p>
        <div class="stages">${[M.allLabel || 'All'].concat(cats).map((c, i) => `<button type="button" class="tab" data-cat="${i ? esc(c) : ''}" aria-pressed="${i === 0}">${esc(c)}</button>`).join('')}</div>
        <div class="strips" id="mx">${items.map(it => `<article class="strip" data-c="${esc(it.category)}" style="--band:${CAT_COL[Math.max(0, cats.indexOf(it.category)) % CAT_COL.length]}">
          <div class="band"></div><div class="s-id">${esc(it.id)}<small>${esc(it.category)}</small></div><div class="s-main"><h3>${esc(it.title)}</h3><p>${md(it.text)}</p>${chips(it.chips)}</div>
          <div class="s-stat">${esc(it.status || '')}</div></article>`).join('')}</div>`;
    }
    if (id === 'contact') {
      const links = (C.links || []).filter(l => l.href);
      return `<div class="comm"><div class="comm-head"><span>Comm card</span><span>${esc(CALL)}</span></div><p class="eyebrow">${esc(C.eyebrow)}</p>
        <h2 class="disp" id="sheet-title">${esc(C.title)}</h2><p class="lead">${md(C.text)}</p>
        <table class="freq">${C.email ? `<tr><th>Primary</th><td>${esc(C.email)}</td><td style="width:1%"><button type="button" class="btn y sm" data-copy="${esc(C.email)}">${esc(C.copyLabel || 'Copy')}</button></td></tr>` : ''}
          ${links.map((l, i) => `<tr><th>Alt ${i + 1}</th><td colspan="2"><a href="${esc(l.href)}"${/^mailto:/.test(l.href) ? '' : ' target="_blank" rel="noopener"'}>${esc(l.label)}</a></td></tr>`).join('')}</table>
        ${(C.footer || []).map(p => `<p class="small">${esc(p)}</p>`).join('')}</div>`;
    }
    return '';
  }

  // =================================================================== dialogs: sheet, menu, map (all pause the sim)
  function hold() { if (st.mode === 'fly') st.mode = 'held'; }
  function release() { if (st.mode === 'held' && sheet.hidden && menu.hidden && mapEl.hidden) { st.mode = 'fly'; st.keys = {}; } }
  function openSheet(kicker, body, foot, onClose) {
    const wasOpen = !sheet.hidden, prev = wasOpen ? sheetClose : null;
    if (!wasOpen) lastFocus = document.activeElement;
    hold();
    sheetClose = (onClose || prev) ? () => { if (onClose) onClose(); if (prev) prev(); } : null;
    $('#sheet-kicker').textContent = kicker || ''; sbody.innerHTML = body; sfoot.innerHTML = '';
    (foot || [{ label: 'Back to the sky', y: true, action: closeSheet }]).forEach(b => {
      if (!b) return; const el = document.createElement(b.href ? 'a' : 'button');
      if (b.href) el.href = b.href; else el.type = 'button';
      el.className = 'btn' + (b.y ? ' y' : ''); el.textContent = b.label; if (b.action) el.addEventListener('click', b.action); sfoot.appendChild(el);
    });
    sbody.querySelectorAll('img').forEach(i => i.addEventListener('error', () => { i.src = 'assets/portrait.svg'; }, { once: true }));
    sheet.hidden = false; sbody.scrollTop = 0; Snd.tick();
    const f = sfoot.querySelector('.y') || $('#sheet-x'); f.focus({ preventScroll: true });
  }
  function closeSheet() {
    if (sheet.hidden) return; sheet.hidden = true; const f = sheetClose; sheetClose = null; release(); if (f) f();
    if (lastFocus && document.contains(lastFocus) && lastFocus.offsetParent) lastFocus.focus({ preventScroll: true });
  }
  $('#sheet-x').addEventListener('click', closeSheet);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  function openSection(id) {
    st.opened.add(id); if (PLACES.every(p => st.opened.has(p.section))) award('reader');
    const p = PLACES.find(x => x.section === id);
    openSheet(p ? `${p.name} · ${p.line || ''}` : id, sectionHTML(id));
  }
  function closeAll() { if (!sheet.hidden) { sheetClose = null; closeSheet(); } menu.hidden = true; mapEl.hidden = true; release(); }

  // shared clicks inside dialogs
  function dialogClick(e) {
    const t = e.target.closest('[data-layer],[data-cat],[data-copy],[data-sec],[data-k],[data-tab],[data-go]'); if (!t) return;
    const root = t.closest('.sheet-body,.menu,.map') || document;
    if (t.dataset.layer != null) {
      root.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-selected', b === t));
      $('#layer', root).innerHTML = layerHTML(((FG.feature || {}).layers || [])[+t.dataset.layer]);
    } else if (t.dataset.cat != null) {
      root.querySelectorAll('[data-cat]').forEach(b => b.setAttribute('aria-pressed', b === t));
      root.querySelectorAll('#mx [data-c]').forEach(d => { d.hidden = !!t.dataset.cat && d.dataset.c !== t.dataset.cat; });
    } else if (t.dataset.copy != null) copy(t.dataset.copy);
    else if (t.dataset.sec) { mapEl.hidden = true; menu.hidden = true; openSection(t.dataset.sec); }
    else if (t.dataset.go) { flyTo(+t.dataset.go); }
    else if (t.dataset.tab) renderMenu(t.dataset.tab);
    else if (t.dataset.k) {
      SET[t.dataset.k] = JSON.parse(t.dataset.v); saveSet();
      root.querySelectorAll(`[data-k="${t.dataset.k}"]`).forEach(b => b.setAttribute('aria-pressed', b === t));
      applySettings(); if (t.dataset.k === 'plane' && W) setPlane(SET.plane);
    }
  }
  [sbody, menu, mapEl].forEach(el => el.addEventListener('click', dialogClick));

  const OPTS = {
    flying: [['Aircraft', 'plane', Object.keys(PLANES).map(k => [k, PLANES[k].name || k])], ['Camera', 'cam', [['chase', 'Chase'], ['cockpit', 'Cockpit']]],
      ['Assist', 'assist', [[true, 'On (levels itself)'], [false, 'Off']]], ['Pitch', 'invert', [[false, 'W = nose up'], [true, 'Pilot: S = nose up']]]],
    world: [['Time of day', 'time', [['auto', 'Your clock'], ['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']]],
      ['Graphics', 'quality', [['auto', 'Auto'], ['low', 'Low'], ['high', 'High']]], ['Sound', 'sound', [[false, 'Off'], [true, 'On']]],
      ['Motion', 'motion', [['full', 'Full'], ['reduced', 'Reduced']]], ['HUD', 'hud', [[true, 'On'], [false, 'Off']]]],
  };
  const optsHTML = list => `<div class="opts">${list.map(([lab, k, o]) => `<div class="opt"><span>${esc(lab)}</span><div class="seg">${o.map(([v, t]) =>
    `<button type="button" class="tab" data-k="${k}" data-v='${JSON.stringify(v)}' aria-pressed="${SET[k] === v}">${esc(t)}</button>`).join('')}</div></div>`).join('')}</div>`;
  const GLYPH = { land: '⊥', havoc: '✱', first: '✈', tour: '◎', radio: '≋', mach: '»', low: '▁', roll: '↻', night: '☾', recon: '▣', reader: '☰' };
  function renderMenu(tab) {
    tab = tab || 'home';
    const kb = (k, d) => `<span>${k.map(x => `<kbd>${x}</kbd>`).join('')}</span><span>${d}</span>`;
    const links = (C.links || []).filter(l => l.href && !/^mailto:/.test(l.href));
    const body = {
      home: `<div class="hello"><img src="${esc(AVATAR)}" alt="" referrerpolicy="no-referrer"><div><h3>${esc(FL.hello || NAME)}</h3><h4>${esc(FL.tagline || '')}</h4></div></div>
        <p>${esc(FL.intro || '')}</p><div class="seg">${links.map(l => `<a class="btn ink sm" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>
        ${C.email ? `<div class="copyrow"><code>${esc(C.email)}</code><button type="button" data-copy="${esc(C.email)}">Copy</button></div>` : ''}
        <p class="small">Short on time? <a href="?plain=1">${esc(DOOR.read || 'Read it plain')}</a> or <button type="button" data-act="map">open the map</button>.</p>
        <p class="small">Settings and patches stay in this browser.</p>`,
      flying: optsHTML(OPTS.flying),
      world: optsHTML(OPTS.world),
      controls: `<h4>Keyboard</h4><div class="keys">${kb(['W', 'S'], 'Pitch (or ↑ ↓)')}${kb(['S'], 'Brakes, on the ground')}${kb(['W'], 'Lift off past 125 kt')}${kb(['A', 'D'], 'Roll (or ← →)')}${kb(['Q', 'E'], 'Rudder')}${kb(['Shift', 'R'], 'Throttle up')}${kb(['F'], 'Throttle down')}
          ${kb(['Space'], 'Afterburner (hold)')}${kb(['C'], 'Chase / cockpit')}${kb(['Enter'], 'Go in at a landmark')}${kb(['M'], 'Map')}${kb(['O', 'Esc'], 'Menu, pauses')}${kb(['V'], 'Photo mode')}</div>
        <h4 style="margin-top:16px">Mouse &amp; touch</h4><div class="keys">${kb(['Drag'], 'A stick appears under your finger or cursor')}${kb(['Wheel'], 'Throttle')}${kb(['Right edge'], 'Throttle slider and AB button on phones')}</div>
        <h4 style="margin-top:16px">Gamepad</h4><div class="keys">${kb(['L stick'], 'Pitch and roll')}${kb(['R stick'], 'Rudder')}${kb(['RT', 'LT'], 'Throttle')}${kb(['A'], 'Afterburner')}${kb(['Y'], 'Camera')}${kb(['Start'], 'Menu')}</div>`,
      patches: `<div class="patches">${(FL.patches || []).map(p => `<div class="patch${patches[p.id] ? ' got' : ''}"><div class="ico">${GLYPH[p.id] || '★'}</div><b>${esc(p.name)}</b><small>${esc(p.text)}</small></div>`).join('')}</div>`,
    }[tab];
    menu.innerHTML = `<div class="menu-head"><h2>Menu</h2><button type="button" class="x" data-act="menu-x" aria-label="Close menu">×</button></div>
      <div class="tabs" role="tablist">${['home', 'flying', 'world', 'controls', 'patches'].map(k => `<button type="button" class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${k}</button>`).join('')}</div>
      <div class="menu-body">${body}</div>`;
    menu.querySelectorAll('img').forEach(i => i.addEventListener('error', () => { i.src = 'assets/portrait.svg'; }, { once: true }));
  }
  function openMenu(tab) { mapEl.hidden = true; if (!sheet.hidden) closeSheet(); lastFocus = document.activeElement; hold(); renderMenu(tab); menu.hidden = false; Snd.tick(); const x = $('.x', menu); if (x) x.focus({ preventScroll: true }); }
  function closeMenu() { if (menu.hidden) return; menu.hidden = true; release(); }

  // map: island drawn once from the same height function the 3D terrain uses
  const EXT = 6000;
  let mapCanvas = null;
  function drawMap() {
    if (mapCanvas) return mapCanvas;
    const N = 320, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
    const ramp = h => h < -60 ? [44, 93, 138] : h < 0 ? [79, 143, 184] : h < 14 ? [227, 207, 154] : h < 260 ? [127, 174, 90] : h < 520 ? [79, 138, 74] : h < 820 ? [154, 143, 128] : [243, 241, 234];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N * 2 - 1) * EXT, z = (j / N * 2 - 1) * EXT, h = height(x, z), hs = h - height(x - 40, z - 40);
      const col = ramp(h), k = h > 0 ? clamp(1 + hs * 0.012, 0.75, 1.2) : 1, o = (j * N + i) * 4;
      img.data[o] = col[0] * k; img.data[o + 1] = col[1] * k; img.data[o + 2] = col[2] * k; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0); mapCanvas = c; return c;
  }
  const mapXY = (x, z) => [((x / EXT + 1) / 2 * 100).toFixed(2) + '%', ((z / EXT + 1) / 2 * 100).toFixed(2) + '%'];
  function openMap() {
    menu.hidden = true; if (!sheet.hidden) closeSheet(); lastFocus = document.activeElement; hold();
    const pos = W ? W.plane.group.position : null;
    mapEl.innerHTML = `<div class="map-side"><div class="map-card"><div class="hello"><img src="${esc(AVATAR)}" alt="" referrerpolicy="no-referrer"><h2>${esc(NAME)}</h2></div>
        <p class="small" style="margin:0 0 10px">${esc(FL.tagline || '')}</p>${C.email ? `<div class="copyrow"><code>${esc(C.email)}</code><button type="button" data-copy="${esc(C.email)}">Copy</button></div>` : ''}
        <p class="small" style="margin:0">Short on time? <a href="?plain=1">${esc(DOOR.read || 'Read it plain')}</a> instead.</p></div>
      <ul class="places">${PLACES.map(p => `<li><span class="n">${p.i + 1}</span><div><b>${esc(p.name)}</b><span>${esc(p.line || '')}</span>${st.visited.has(p.i) ? ' <span class="ok">✓ visited</span>' : ''}</div>
        <div class="acts"><button type="button" class="btn y sm" data-sec="${esc(p.section)}">Open</button>${W && W.places ? `<button type="button" class="btn sm" data-go="${p.i}">Fly there</button>` : ''}</div></li>`).join('')}</ul>
      ${W ? `<p class="small" style="color:#e6e4d9!important">Radio beacons heard: ${st.heard.size}/${W.beacons.length}</p>` : ''}</div>
      <div class="map-main"><button type="button" class="btn y map-close" data-act="map-x">× <span class="lbl">Back to the sky</span> <kbd>Esc</kbd></button>
        <div class="map-frame"><div class="map-sq" id="map-sq">
          ${W && W.places ? W.places.map(p => { const [l, t] = mapXY(p.pos.x, p.pos.z); return `<button type="button" class="pin${st.visited.has(p.i) ? ' done' : ''}" style="left:${l};top:${t};--c:${p.color}" data-sec="${esc(p.section)}">${esc(p.name)}</button>`; }).join('') : ''}
          ${W ? W.beacons.map(b => { const [l, t] = mapXY(b.pos.x, b.pos.z); return `<span class="beacon-dot${b.heard ? ' heard' : ''}" style="left:${l};top:${t}" title="${esc(b.item.title)}"></span>`; }).join('') : ''}
          ${pos ? (() => { const [l, t] = mapXY(pos.x, pos.z); return `<span class="me" style="left:${l};top:${t}"><i style="transform:rotate(${(P.hdg * 180 / Math.PI).toFixed(0)}deg)"></i></span>`; })() : ''}
        </div></div></div>`;
    $('#map-sq').prepend(drawMap()); mapEl.hidden = false; Snd.tick();
    const b = $('.map-close', mapEl); if (b) b.focus({ preventScroll: true });
  }
  function closeMap() { if (mapEl.hidden) return; mapEl.hidden = true; release(); }

  // =================================================================== sound (synthesised, no files)
  const Snd = {
    ctx: null,
    init() {
      if (this.ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC(); this.master = c.createGain(); this.master.gain.value = 0; this.master.connect(c.destination);
      const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0); let l = 0;
      for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } this.buf = buf;
      const mk = (type, f) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const g = c.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(this.master); s.start(); return { fl, g }; };
      this.eng = mk('lowpass', 300); this.wind = mk('bandpass', 900); this.wind.fl.Q.value = 0.6;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110; this.whine = c.createGain(); this.whine.gain.value = 0; const lf = c.createBiquadFilter(); lf.frequency.value = 900;
      o.connect(lf).connect(this.whine).connect(this.master); o.start(); this.osc = o;
    },
    set(on) { if (on) { this.init(); if (!this.ctx) return; this.ctx.resume(); } if (this.master) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.1); },
    engine(thr, v, ab) {
      if (!this.ctx || !SET.sound) return; const t = this.ctx.currentTime;
      this.eng.g.gain.setTargetAtTime(thr ? 0.25 + thr * 0.35 + (ab ? 0.35 : 0) : 0, t, 0.3); this.eng.fl.frequency.setTargetAtTime(220 + thr * 380 + (ab ? 700 : 0), t, 0.3);
      this.wind.g.gain.setTargetAtTime(thr ? clamp(v / 400, 0, 1) * 0.35 : 0, t, 0.3); this.wind.fl.frequency.setTargetAtTime(500 + v * 3, t, 0.3);
      this.whine.gain.setTargetAtTime(thr ? 0.012 + thr * 0.02 : 0, t, 0.3); this.osc.frequency.setTargetAtTime(90 + thr * 140, t, 0.4);
    },
    blip(freqs, dur, vol, type) {
      if (!this.ctx || !SET.sound) return; const c = this.ctx, t = c.currentTime;
      freqs.forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = type || 'sine'; o.frequency.value = f; const s = t + i * dur * 0.6;
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(vol, s + 0.015); g.gain.exponentialRampToValueAtTime(0.001, s + dur); o.connect(g).connect(this.master); o.start(s); o.stop(s + dur + 0.05); });
    },
    noise(dur, f, vol) {
      if (!this.ctx || !SET.sound) return; const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.buf;
      const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(fl).connect(g).connect(this.master); s.start(t); s.stop(t + dur + 0.05);
    },
    tick() { this.blip([1400], 0.05, 0.05, 'square'); },
    chime() { this.blip([784, 1047, 1319], 0.35, 0.14); },
    radio() { this.noise(0.25, 2200, 0.5); setTimeout(() => this.blip([1200, 900], 0.12, 0.08, 'square'), 200); },
    warn() { this.blip([1000], 0.12, 0.09, 'square'); },
    boom() { this.noise(1.6, 160, 2.2); },
    whoosh() { this.noise(1.1, 700, 0.6); },
  };

  // =================================================================== the island (height field shared by 3D, map and physics)
  function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
  function fbm(x, y) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
  const R_ISL = 4200;
  function hNat(x, z) {
    const d = Math.hypot(x, z) / R_ISL + (fbm(x * 0.0007 + 11, z * 0.0007 - 7) - 0.47) * 0.45, land = 1 - smooth(0.62, 1.02, d);
    const m = Math.pow(clamp(fbm(x * 0.00042 + 3.1, z * 0.00042 + 1.7) * 1.3 - 0.2, 0, 1), 1.7);
    return -150 + land * (165 + m * 1150) + (fbm(x * 0.0035, z * 0.0035) - 0.45) * 50 * land;
  }
  const SPOTS = { about: [220, 1250], flagships: [-1700, -1100], matrix: [2100, -1500], contact: [-3700, 1700] };
  const FLAT = [
    { x: 0, z: 1500, rx: 300, rz: 1550, h: 30 },
    { x: -1700, z: -1100, rx: 150, rz: 150, h: Math.max(hNat(-1700, -1100), 380) },
    { x: 2100, z: -1500, rx: 300, rz: 300, h: Math.max(hNat(2100, -1500), 90) },
    { x: -3700, z: 1700, rx: 110, rz: 110, h: 24 },
  ];
  function height(x, z) {
    let h = hNat(x, z);
    for (const f of FLAT) { const dx = (x - f.x) / f.rx, dz = (z - f.z) / f.rz, d = Math.sqrt(dx * dx + dz * dz); if (d < 1.8) h += (f.h - h) * (1 - smooth(1, 1.8, d)); }
    return h;
  }
  const ground = (x, z) => Math.max(height(x, z), 0);
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  const TIMES = {
    dawn:  { top: '#2a4483', mid: '#f3a374', bot: '#f0c49a', fog: '#e8b291', near: 2500, far: 15000, hs: '#c7d4ff', hg: '#6b5040', hi: 1.15, sun: '#ffc69a', si: 2.1, dir: [-0.5, 0.12, -1], stars: 0.15, cloud: '#ffe1cf', water: '#5878a8', size: 3200 },
    day:   { top: '#2f73d6', mid: '#a9e0ee', bot: '#cdeefa', fog: '#bfe3f2', near: 3000, far: 19000, hs: '#e6f2ff', hg: '#6a6448', hi: 1.3, sun: '#fff6e8', si: 2.5, dir: [-0.35, 0.6, -1], stars: 0, cloud: '#ffffff', water: '#3f86b8', size: 2400 },
    dusk:  { top: '#17205a', mid: '#ff8a50', bot: '#f2a07a', fog: '#d77e62', near: 2500, far: 15000, hs: '#ffb48a', hg: '#3e2b33', hi: 1.0, sun: '#ff9b55', si: 2.3, dir: [0.4, 0.08, -1], stars: 0.45, cloud: '#ffc8ae', water: '#5d5a86', size: 3600 },
    night: { top: '#02040d', mid: '#10244a', bot: '#0a1430', fog: '#0c1b36', near: 1500, far: 12000, hs: '#6f86c4', hg: '#1a1e2c', hi: 0.85, sun: '#cfdcff', si: 0.6, dir: [-0.2, 0.35, -1], stars: 1, cloud: '#46527a', water: '#0f2445', size: 1100 },
  };
  const timeNow = () => { if (SET.time !== 'auto') return SET.time; const h = new Date().getHours(); return h < 6 || h >= 20 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : 'dusk'; };
  const qualityHigh = () => SET.quality === 'high' || (SET.quality === 'auto' && !COARSE && innerWidth > 900);

  // =================================================================== world build
  const webgl2 = () => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function noFly(msg) {
    door.hidden = true; world.hidden = false; world.classList.remove('diving'); st.mode = 'fallback';
    ui.innerHTML = `<div class="nofly"><div class="map-card"><p class="eyebrow">No-fly day</p><h2>Can't take off here</h2><p class="small" style="margin:8px 0 12px">${esc(msg)} Everything is still one tap away.</p>
      <div class="seg"><button type="button" class="btn y sm" data-act="map">Open the map</button><a class="btn sm" href="?plain=1">${esc(DOOR.read || 'Read it plain')}</a><button type="button" class="btn sm" data-act="door">Front door</button></div></div></div>`;
  }
  async function ensureWorld() {
    if (W) return true;
    if (!webgl2()) { noFly('This browser has no WebGL 2, so the 3D cannot start.'); return false; }
    const rp = import(RAPIER_URL).then(async m => { const r = m.default || m; await r.init(); return r; }).catch(e => { console.warn('Physics engine unavailable, flying without it', e); return null; });
    try { T = await import(THREE_URL); } catch (e) { noFly('The 3D engine could not load (offline, or the network blocks the CDN).'); return false; }
    RAP = await rp;
    await wait(20);
    try { buildWorld(); } catch (e) { console.error(e); W = null; noFly('The 3D world failed to start on this device.'); return false; }
    requestAnimationFrame(loop);
    return true;
  }

  function chipTexture(text, color) {
    const c = document.createElement('canvas'), g = c.getContext('2d'); g.font = '40px Bungee, "Arial Black", sans-serif';
    const w = Math.ceil(g.measureText(text).width) + 96; c.width = w; c.height = 76;
    g.fillStyle = '#23262e'; g.fillRect(0, 0, w, 76); g.fillStyle = color; g.save(); g.translate(36, 38); g.rotate(Math.PI / 4); g.fillRect(-11, -11, 22, 22); g.restore();
    g.font = '40px Bungee, "Arial Black", sans-serif'; g.fillStyle = '#f5f0e1'; g.textBaseline = 'middle'; g.fillText(text, 64, 41);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return { tex: t, aspect: w / 76 };
  }

  function buildWorld() {
    const hi = qualityHigh(), canvas = $('#gl');
    const renderer = new T.WebGLRenderer({ canvas, antialias: hi, powerPreference: 'high-performance' });
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(60, 1, 0.3, 45000);
    scene.fog = new T.Fog(0xffffff, 3000, 19000);
    const hemi = new T.HemisphereLight(0xffffff, 0x444444, 1.2), sun = new T.DirectionalLight(0xffffff, 2); scene.add(hemi, sun);

    const skyU = { top: { value: new T.Color() }, mid: { value: new T.Color() }, bot: { value: new T.Color() } };
    const sky = new T.Mesh(new T.SphereGeometry(30000, 32, 16), new T.ShaderMaterial({ uniforms: skyU, side: T.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP;\nvoid main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;\nvoid main(){\n float h = vP.y;\n vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.55)) : mix(mid, bot, clamp(-h * 6.0, 0.0, 1.0));\n gl_FragColor = vec4(c, 1.0);\n #include <colorspace_fragment>\n}' }));
    sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);
    const sc = document.createElement('canvas'); sc.width = sc.height = 128; const sg2 = sc.getContext('2d'), gr = sg2.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.2, 'rgba(255,255,255,.95)'); gr.addColorStop(0.34, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); sg2.fillStyle = gr; sg2.fillRect(0, 0, 128, 128);
    const sunTex = new T.CanvasTexture(sc); sunTex.colorSpace = T.SRGBColorSpace;
    const sunSpr = new T.Sprite(new T.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending })); scene.add(sunSpr);
    const sp = new Float32Array(900 * 3), R0 = rng(7);
    for (let i = 0; i < 900; i++) { const a = R0() * Math.PI * 2, e = Math.asin(0.04 + R0() * 0.96), r = 28000; sp.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
    const sgeo = new T.BufferGeometry(); sgeo.setAttribute('position', new T.BufferAttribute(sp, 3));
    const stars = new T.Points(sgeo, new T.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false })); stars.frustumCulled = false; scene.add(stars);

    // terrain: one flat-shaded mesh, colour baked per vertex (sand, grass, forest, rock, snow)
    const SEG = hi ? 220 : 150, TE = 7000, geo = new T.PlaneGeometry(TE * 2, TE * 2, SEG, SEG); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), cc = new T.Color();
    const PAL = { deep: new T.Color('#b8a77a'), sand: new T.Color('#e3cf9a'), grass: new T.Color('#86b35c'), forest: new T.Color('#4f8a4a'), rock: new T.Color('#9a8f80'), snow: new T.Color('#f3f1ea') };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = height(x, z), sl = Math.abs(h - height(x + 45, z)) + Math.abs(h - height(x, z + 45));
      if (h < 0) cc.copy(PAL.deep); else if (h < 12) cc.copy(PAL.sand); else if (h > 780) cc.copy(PAL.snow); else if (sl > 34) cc.copy(PAL.rock);
      else cc.copy(PAL.grass).lerp(PAL.forest, clamp((fbm(x * 0.002, z * 0.002) - 0.4) * 4, 0, 1));
      cc.multiplyScalar(0.92 + hash2(Math.round(x), Math.round(z)) * 0.16); pos.setY(i, h); col.set([cc.r, cc.g, cc.b], i * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.computeBoundingSphere();
    scene.add(new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    const water = new T.Mesh(new T.PlaneGeometry(90000, 90000), new T.MeshLambertMaterial({ color: 0x3f86b8 })); water.rotation.x = -Math.PI / 2; scene.add(water);

    // trees + clouds (instanced)
    const NT = 2600, trees = new T.InstancedMesh(new T.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new T.MeshLambertMaterial({ color: '#3f7a45', flatShading: true }), NT);
    const dummy = new T.Object3D(), RT = rng(3); let n = 0;
    for (let tries = 0; tries < 40000 && n < NT; tries++) {
      const x = (RT() * 2 - 1) * R_ISL, z = (RT() * 2 - 1) * R_ISL, h = height(x, z);
      if (h < 14 || h > 520 || fbm(x * 0.002, z * 0.002) < 0.45) continue;
      if (Math.abs(h - height(x + 45, z)) + Math.abs(h - height(x, z + 45)) > 30) continue;
      if (FLAT.some(f => Math.hypot((x - f.x) / f.rx, (z - f.z) / f.rz) < 2.2)) continue;
      const s = 4 + RT() * 4; dummy.position.set(x, h - 1, z); dummy.scale.set(s, s * (2.4 + RT()), s); dummy.rotation.y = RT() * 3; dummy.updateMatrix(); trees.setMatrixAt(n++, dummy.matrix);
    }
    trees.userData.max = n; trees.count = n; scene.add(trees);
    const NC = 80, PUFF = 7, clouds = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.94 }), NC * PUFF);
    const RC = rng(11);
    for (let i = 0; i < NC; i++) { const cx = (RC() * 2 - 1) * 10000, cz = (RC() * 2 - 1) * 10000, cy = 1300 + RC() * 900;
      for (let j = 0; j < PUFF; j++) { const s = 90 + RC() * 130; dummy.position.set(cx + (RC() - 0.5) * 520, cy + (RC() - 0.5) * 90, cz + (RC() - 0.5) * 300); dummy.scale.set(s, s * 0.55, s); dummy.rotation.set(0, RC() * 3, 0); dummy.updateMatrix(); clouds.setMatrixAt(i * PUFF + j, dummy.matrix); } }
    clouds.userData.max = NC * PUFF; clouds.frustumCulled = false; scene.add(clouds);

    // landmarks
    const LM = FP.landmarks || {}, animated = [], places = [];
    const put = (obj, x, z, rotY) => { if (!obj) return null; obj.group.position.set(x, ground(x, z), z); if (rotY) obj.group.rotation.y = rotY; scene.add(obj.group); if (obj.update) animated.push(obj); return obj; };
    if (LM.airbase) put(LM.airbase(T, { length: 2600, width: 45 }), 0, 1500);
    const BUILD = { about: LM.tower, flagships: LM.radar, matrix: LM.antennas, contact: LM.lighthouse };
    PLACES.forEach(p => {
      const [x, z] = SPOTS[p.section] || [0, 0], gy = ground(x, z);
      const obj = BUILD[p.section] ? put(BUILD[p.section](T), x, z) : null;
      const beam = LM.beacon ? put(LM.beacon(T, p.color), x, z) : null;
      const ch = chipTexture(p.name.toUpperCase(), p.color), spr = new T.Sprite(new T.SpriteMaterial({ map: ch.tex, depthWrite: false, depthTest: false, fog: false, sizeAttenuation: false }));
      spr.scale.set(0.034 * ch.aspect, 0.034, 1); spr.position.set(x, gy + 260, z); spr.renderOrder = 5; scene.add(spr);
      places.push(Object.assign({}, p, { pos: new T.Vector3(x, gy, z), obj, beam, label: spr }));
    });

    // radio beacons: one per project item, circling the landmark it belongs to
    const pools = {
      about: (H.highlights || []).concat(A.principles || []), flagships: FG.cards || [], matrix: M.items || [],
      contact: (C.links || []).filter(l => l.href).map(l => ({ title: l.label, text: l.href.replace(/^mailto:/, ''), href: l.href })),
    };
    const RB = rng(5), bGeo = new T.OctahedronGeometry(16, 0), beacons = [];
    places.forEach(p => (pools[p.section] || []).forEach((item, k, arr) => {
      const a = (k / arr.length) * Math.PI * 2 + RB() * 0.5, r = 700 + RB() * 650, x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r, y = ground(x, z) + 230 + RB() * 260;
      const m = new T.Mesh(bGeo, new T.MeshLambertMaterial({ color: '#f2c94c', emissive: '#f2c94c', emissiveIntensity: 0.35, flatShading: true }));
      m.position.set(x, y, z); scene.add(m);
      beacons.push({ item, place: p, pos: m.position, mesh: m, heard: false, n: beacons.length + 1 });
    }));

    // contrail ribbons + crash flash
    const trailMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide });
    const trails = [makeTrail(trailMat), makeTrail(trailMat)]; trails.forEach(t => scene.add(t.mesh));
    const boom = new T.Mesh(new T.SphereGeometry(1, 16, 12), new T.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })); scene.add(boom);

    // physics (Rapier: terrain, props, wreck, particles) + nature (grass, wind, birds, water)
    const base = { x: 0, y: ground(0, 1500), z: 1500 };
    let ph = null, nat = null;
    try { if (RAP && FP.physics) ph = FP.physics(T, RAP, { scene, height, seg: SEG, ext: TE, base, hi, onHit: propHit }); } catch (e) { console.warn('Physics off', e); }
    try { if (FP.nature) nat = FP.nature(T, { scene, height, spots: Object.values(SPOTS), flat: FLAT, rIsl: R_ISL, hi, trees, water, fx: ph && ph.fx, rng }); } catch (e) { console.warn('Nature off', e); }

    W = { ph, nat, base, vel: new T.Vector3(), renderer, scene, camera, hemi, sun, sky, skyU, sunSpr, stars, water, trees, clouds, places, beacons, animated, trails, boom,
      q: new T.Quaternion(), qa: new T.Quaternion(), pos: new T.Vector3(), fwd: new T.Vector3(), up: new T.Vector3(), right: new T.Vector3(), v3: new T.Vector3(), v4: new T.Vector3(),
      camOff: new T.Vector3(0, 8, 30), look: new T.Vector3(), X: new T.Vector3(1, 0, 0), Y: new T.Vector3(0, 1, 0), Z: new T.Vector3(0, 0, 1), orbit: { a: 0.6, p: 0.2, r: 30 }, baseFov: 60, ang: 0 };
    setPlane(SET.plane);
    applySettings();
    addEventListener('resize', resize); resize();
  }

  function setPlane(id) {
    const def = PLANES[id] || PLANES[Object.keys(PLANES)[0]];
    if (W.plane) { W.scene.remove(W.plane.group); if (W.plane.dispose) W.plane.dispose(); }
    let pl;
    if (def) pl = def.build(T);
    else {                                        // planes.js missing: simple stand-in so the sim still runs
      const g = new T.Group(), m = new T.MeshLambertMaterial({ color: '#7f868e', flatShading: true });
      g.add(new T.Mesh(new T.ConeGeometry(1, 15, 6).rotateX(-Math.PI / 2), m)); g.add(new T.Mesh(new T.BoxGeometry(10, 0.3, 4), m));
      pl = { group: g, tips: [new T.Vector3(-5, 0, 1), new T.Vector3(5, 0, 1)], eye: new T.Vector3(0, 1, -4) };
    }
    pl.burners = pl.burners || (pl.burner ? [pl.burner] : []);
    pl.group.rotation.order = 'YXZ';
    const box = new T.Box3().setFromObject(pl.group), size = box.getSize(new T.Vector3()); pl.len = Math.max(size.z, 8);
    pl.span = Math.max(size.x, 6); pl.bottom = box.min.y; addGear(pl);
    if (W.plane) pl.group.position.copy(W.plane.group.position), pl.group.quaternion.copy(W.plane.group.quaternion);
    W.plane = pl; W.scene.add(pl.group); if (W.ph) W.ph.setJet(pl.len, pl.span, pl.gearH);
    if (P.ground) pl.group.position.y = W.base.y + 0.16 + pl.gearH; else pl.gearK = 0;
    W.camOff.set(0, pl.len * 0.4 + 2, pl.len * 1.7 + 8);
  }
  // landing gear, built for any jet from its bounding box; gear.scale.y folds it into the fuselage
  function addGear(pl) {
    const g = new T.Group(), m = new T.MeshLambertMaterial({ color: '#c9ccd0', flatShading: true }), tyre = new T.MeshLambertMaterial({ color: '#1d1f23', flatShading: true });
    const bot = pl.bottom - 1.25, wr = 0.42;
    const leg = (x, z, s) => { const top = pl.bottom + 0.4, len = top - (bot + wr);
      const strut = new T.Mesh(new T.CylinderGeometry(0.09 * s, 0.09 * s, len, 6), m); strut.position.set(x, bot + wr + len / 2, z); g.add(strut);
      const w = new T.Mesh(new T.CylinderGeometry(wr * s, wr * s, 0.3 * s, 12).rotateZ(Math.PI / 2), tyre); w.position.set(x, bot + wr * s, z); g.add(w); };
    leg(0, -pl.len * 0.33, 0.8); leg(-pl.span * 0.13, pl.len * 0.08, 1); leg(pl.span * 0.13, pl.len * 0.08, 1);
    pl.group.add(g); pl.gear = g; pl.gearH = -bot; pl.gearK = 1;
  }
  function makeTrail(mat) {
    const N = 60, pos = new Float32Array(N * 6), col = new Float32Array(N * 8), idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 4)); g.setIndex(idx);
    const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false;
    return { mesh, pos, col, N, pts: Array.from({ length: N }, () => new T.Vector3()), str: 0 };
  }
  function stepTrail(tr, p, strength) {
    const v = tr.pts.pop(); v.copy(p); tr.pts.unshift(v); tr.str += (strength - tr.str) * 0.1;
    for (let i = 0; i < tr.N; i++) { const q = tr.pts[i], age = i / (tr.N - 1), w = 0.25 + age * 2.2, a = (1 - age) * 0.55 * tr.str;
      tr.pos.set([q.x - w, q.y, q.z, q.x + w, q.y, q.z], i * 6); tr.col.set([1, 1, 1, a, 1, 1, 1, a], i * 8); }
    tr.mesh.geometry.attributes.position.needsUpdate = true; tr.mesh.geometry.attributes.color.needsUpdate = true;
  }
  function resetTrails() { if (!W) return; W.plane.group.updateMatrixWorld(); W.trails.forEach((tr, i) => { const p = W.plane.group.localToWorld(W.v3.copy(W.plane.tips[i])); tr.pts.forEach(v => v.copy(p)); tr.str = 0; stepTrail(tr, p, 0); }); }

  function setHeading(group, hdg, y) { group.quaternion.setFromAxisAngle(W.Y, -hdg); if (y != null) group.position.y = y; }
  // start parked on the runway threshold (south end), nose north, engines idle
  function spawn() {
    const g = W.plane.group; g.position.set(0, W.base.y + 0.16 + W.plane.gearH, 2745); setHeading(g, 0);
    Object.assign(P, { v: 0, thr: 0, ab: false, pi: 0, ri: 0, yi: 0, ground: true, rot: 0, hdgG: 0 }); W.plane.gearK = 1;
    st.ap = null; st.rotHint = false; st.teleport = true; resetTrails(); W.ang = 0;
  }

  function applySettings() {
    if (!W) return;
    const hi = qualityHigh();
    W.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, hi ? 2 : 1.25));
    W.trees.count = Math.floor(W.trees.userData.max * (hi ? 1 : 0.45)); W.clouds.count = Math.floor(W.clouds.userData.max / 7 * (hi ? 1 : 0.6)) * 7;
    const Pt = TIMES[timeNow()]; W.timeName = timeNow();
    W.skyU.top.value.set(Pt.top); W.skyU.mid.value.set(Pt.mid); W.skyU.bot.value.set(Pt.bot);
    W.scene.fog.color.set(Pt.fog); W.scene.fog.near = Pt.near; W.scene.fog.far = Pt.far;
    W.hemi.color.set(Pt.hs); W.hemi.groundColor.set(Pt.hg); W.hemi.intensity = Pt.hi; W.sun.color.set(Pt.sun); W.sun.intensity = Pt.si;
    W.sunDir = new T.Vector3(Pt.dir[0], Pt.dir[1], Pt.dir[2]).normalize(); W.sun.position.copy(W.sunDir).multiplyScalar(1000);
    W.sunSpr.material.color.set(Pt.sun); W.sunSpr.scale.setScalar(Pt.size); W.stars.material.opacity = Pt.stars; W.stars.visible = Pt.stars > 0;
    W.clouds.material.color.set(Pt.cloud); W.water.material.color.set(Pt.water);
    const sb = $('#u-snd'); if (sb) sb.textContent = SET.sound ? '♪ On' : '♪ Off';
    Snd.set(SET.sound && st.mode !== 'door');
    resize();
  }
  function resize() {
    if (!W) return; const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2), hc = $('#hudc');
    W.renderer.setSize(w, h, false); W.camera.aspect = w / h; W.baseFov = w < h ? 72 : 60; W.camera.fov = W.baseFov; W.camera.updateProjectionMatrix();
    if (W.ph) W.ph.fx.setScale(W.renderer.getPixelRatio() * h / (2 * Math.tan(W.baseFov * Math.PI / 360)));
    hc.width = Math.round(w * dpr); hc.height = Math.round(h * dpr); W.hud = hc.getContext('2d'); W.hudScale = dpr;
  }

  // =================================================================== world UI
  function renderBar() {
    return `<div class="bar-top"><div style="justify-content:flex-start"><button type="button" class="btn sq" data-act="door" aria-label="Back to the page">◂</button><span class="chip"><span class="d"></span>${esc(CALL)}</span></div>
      <div><button type="button" class="btn" data-act="map" aria-label="Map (M)">◎ <span class="lbl">Map</span> <kbd>M</kbd></button><button type="button" class="btn" data-act="menu" aria-label="Menu (O)">☰ <span class="lbl">Menu</span> <kbd>O</kbd></button>
      <button type="button" class="btn" data-act="cam" aria-label="Camera (C)">◐ <span class="lbl">View</span> <kbd>C</kbd></button><button type="button" class="btn" id="u-snd" data-act="sound" aria-label="Sound">${SET.sound ? '♪ On' : '♪ Off'}</button>
      <button type="button" class="btn sq" data-act="photo" aria-label="Photo mode (V)">▣</button></div></div>`;
  }
  function showTitle() {
    st.mode = 'title'; world.classList.remove('flying');
    const hint = COARSE ? 'Push the throttle up on the right, drag up to lift off' : 'Shift throttle · A/D steer · W lifts off · S brakes · C cockpit';
    ui.innerHTML = renderBar() + `<div class="title"><h1>${esc(NAME)}</h1><br><p>${esc(FL.tagline || '')}</p><br>
      <button type="button" class="btn y big" data-act="take">${esc(FL.takeControls || 'Take the controls')}</button>
      <small>${hint}<br>or <button type="button" data-act="map">read the map</button> or <button type="button" data-act="door">go back to the page</button></small></div>
      <div class="idcard"><img src="${esc(AVATAR)}" alt="" referrerpolicy="no-referrer" onerror="this.src='assets/portrait.svg'"><div><b>${esc(NAME)}</b><span>${esc(FL.tagline || '')}</span></div></div>`;
    const b = $('[data-act="take"]', ui); if (b) b.focus({ preventScroll: true });
  }
  function takeControls() {
    if (st.mode !== 'title') return;
    st.mode = 'fly'; st.ap = null; world.classList.add('flying'); award('first'); Snd.set(SET.sound);
    ui.innerHTML = renderBar() + `<div class="stick" id="stick"><i></i></div><div class="thr" id="thr"><span>THR</span><i id="thr-i"></i></div>
      <button type="button" class="btn ab" id="ab" aria-label="Afterburner">AB</button><div id="slot-prompt"></div><div id="slot-bubble"></div>`;
    wireTouch(); if (document.activeElement) document.activeElement.blur();
    toast(P.ground ? (COARSE ? 'Throttle up on the right edge, then drag up past 125 kt' : 'Hold Shift to throttle up · A/D steer · W lifts off past 125 kt') : (COARSE ? 'Drag on the left to fly' : 'W/S pitch · A/D roll · Shift throttle'));
  }
  function flyTo(i) {
    const p = W && W.places[i]; if (!p) return; closeAll();
    if (st.mode === 'title') takeControls();
    st.ap = { i, name: p.name }; toast('Autopilot → ' + p.name + ' · any input takes over');
  }
  function photo(on) {
    if (on) { if (!W || !['fly', 'title'].includes(st.mode)) return; st.photoPrev = st.mode; st.mode = 'photo'; world.classList.add('photo'); W.orbit = { a: 0.6, p: 0.2, r: W.plane.len * 2.2 };
      const pb = document.createElement('div'); pb.className = 'photo-bar'; pb.id = 'photobar';
      pb.innerHTML = `<span>Drag to orbit · wheel to zoom</span><button type="button" class="btn y" data-act="snap">Save picture</button><button type="button" class="btn" data-act="photo-off">Done</button>`; ui.appendChild(pb);
    } else if (st.mode === 'photo') { st.mode = st.photoPrev; world.classList.remove('photo'); const pb = $('#photobar'); if (pb) pb.remove(); }
  }
  function snap() { W.renderer.render(W.scene, W.camera); const a = document.createElement('a'); a.href = $('#gl').toDataURL('image/png'); a.download = 'falcon-29.png'; a.click(); award('recon'); }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
    if (a === 'map') openMap(); else if (a === 'map-x') closeMap(); else if (a === 'menu') openMenu(); else if (a === 'menu-x') closeMenu();
    else if (a === 'take') takeControls(); else if (a === 'door') toDoor(); else if (a === 'cam') toggleCam();
    else if (a === 'sound') { SET.sound = !SET.sound; saveSet(); applySettings(); }
    else if (a === 'photo') photo(true); else if (a === 'photo-off') photo(false); else if (a === 'snap') snap();
    else if (a === 'enter' && st.prompt) openSection(st.prompt.section);
    else if (a === 'read') { const bc = W && W.beacons[+b.dataset.i]; if (bc) openSheet(`${bc.place.name} · beacon ${bc.n}`, `<div class="tickets">${ticket(bc.item)}</div>`); }
  });
  function toggleCam() { SET.cam = SET.cam === 'chase' ? 'cockpit' : 'chase'; saveSet(); toast(SET.cam === 'cockpit' ? 'Cockpit view' : 'Chase view'); }

  // =================================================================== input
  const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'yawL', KeyE: 'yawR',
    ShiftLeft: 'thrUp', ShiftRight: 'thrUp', KeyR: 'thrUp', KeyF: 'thrDn', Space: 'ab' };
  addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!sheet.hidden) { e.preventDefault(); return closeSheet(); }
      if (!menu.hidden) return closeMenu(); if (!mapEl.hidden) return closeMap();
      if (st.mode === 'photo') return photo(false); if (st.mode === 'fly') return openMenu();
    }
    if (!sheet.hidden || !menu.hidden || !mapEl.hidden) {
      if (e.key === 'Tab') { const box = !sheet.hidden ? sheet : !menu.hidden ? menu : mapEl, f = box.querySelectorAll('button,a[href]'); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } }
      if (e.code === 'KeyM' && !mapEl.hidden) closeMap();
      return;
    }
    if (world.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = KEYMAP[e.code]; if (k) { st.keys[k] = true; if (st.mode === 'fly') e.preventDefault(); }
    if (e.repeat) return;
    if (e.code === 'Enter') { if (st.mode === 'title') { e.preventDefault(); takeControls(); } else if (st.mode === 'fly' && st.prompt) { e.preventDefault(); openSection(st.prompt.section); } }
    else if (e.code === 'KeyM' && W) openMap(); else if (e.code === 'KeyO') openMenu(); else if (e.code === 'KeyC') toggleCam(); else if (e.code === 'KeyV') photo(st.mode !== 'photo');
  });
  addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) st.keys[k] = false; });
  addEventListener('blur', () => { st.keys = {}; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && st.mode === 'fly') openMenu(); });

  const canvas = $('#gl');
  canvas.addEventListener('pointerdown', e => {
    if (st.mode !== 'fly' && st.mode !== 'photo') return;
    canvas.setPointerCapture(e.pointerId); Object.assign(st.stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
    const s = $('#stick'); if (st.mode === 'fly' && s) { s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; s.firstElementChild.style.transform = ''; s.classList.add('on'); }
  });
  canvas.addEventListener('pointermove', e => {
    if (st.stick.id !== e.pointerId) return;
    if (st.mode === 'photo') { const o = W.orbit; o.a -= (e.clientX - st.stick.ox) * 0.008; o.p = clamp(o.p + (e.clientY - st.stick.oy) * 0.006, -0.3, 1.4); st.stick.ox = e.clientX; st.stick.oy = e.clientY; return; }
    const dx = clamp((e.clientX - st.stick.ox) / 60, -1, 1), dy = clamp((e.clientY - st.stick.oy) / 60, -1, 1); st.stick.x = dx; st.stick.y = dy;
    const s = $('#stick'); if (s) s.firstElementChild.style.transform = `translate(${dx * 35}px,${dy * 35}px)`;
  });
  const stickEnd = e => { if (st.stick.id !== e.pointerId) return; Object.assign(st.stick, { id: null, x: 0, y: 0 }); const s = $('#stick'); if (s) s.classList.remove('on'); };
  canvas.addEventListener('pointerup', stickEnd); canvas.addEventListener('pointercancel', stickEnd);
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (st.mode === 'photo') W.orbit.r = clamp(W.orbit.r + e.deltaY * 0.03, 8, 160); else if (st.mode === 'fly') P.thr = clamp(P.thr - e.deltaY * 0.0008, 0, 1); }, { passive: false });
  function wireTouch() {
    const thr = $('#thr'), ab = $('#ab'); if (!thr) return;
    const setT = e => { const r = thr.getBoundingClientRect(); P.thr = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); };
    thr.addEventListener('pointerdown', e => { thr.setPointerCapture(e.pointerId); st.thrTouch = e.pointerId; setT(e); });
    thr.addEventListener('pointermove', e => { if (st.thrTouch === e.pointerId) setT(e); });
    ['pointerup', 'pointercancel'].forEach(ev => thr.addEventListener(ev, () => { st.thrTouch = null; }));
    const abSet = on => e => { e.preventDefault(); st.abTouch = on; ab.classList.toggle('on', on); };
    ab.addEventListener('pointerdown', abSet(true)); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => ab.addEventListener(ev, abSet(false)));
  }
  function readPad() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [], gp = Array.prototype.find.call(gps || [], Boolean); if (!gp) return null;
    const dz = v => Math.abs(v) < 0.12 ? 0 : v, btn = i => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.3), edge = i => { const b = btn(i), was = st.pad[i]; st.pad[i] = b; return b && !was; };
    if (edge(9)) { if (st.mode === 'title') takeControls(); else if (!menu.hidden) closeMenu(); else if (st.mode === 'fly') openMenu(); }
    if (edge(3)) toggleCam();
    return { x: dz(gp.axes[0] || 0), y: dz(gp.axes[1] || 0), yaw: dz(gp.axes[2] || 0), up: (gp.buttons[7] || {}).value || 0, dn: (gp.buttons[6] || {}).value || 0, ab: btn(0) };
  }

  // =================================================================== flight model + world update
  function crash() {
    if (st.mode === 'crashed') return;
    const g = W.plane.group, sea = height(g.position.x, g.position.z) < 0.5;
    st.mode = 'crashed'; st.crashes++; Snd.boom(); if (!RM()) st.shake = 2.2;
    const fl = $('#flash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 80);
    st.crashDir = W.v3.set(W.fwd.x, 0, W.fwd.z).normalize().clone();
    if (W.ph) W.ph.crash(g, W.vel.copy(W.fwd).multiplyScalar(P.v), sea);
    W.boom.position.copy(g.position); W.boom.material.opacity = sea ? 0 : 1; W.boom.scale.setScalar(5); g.visible = false; st.boomT = 0;
    toast(sea ? 'Splashdown. Respawning…' : 'Bent the jet. Respawning…');
    setTimeout(respawn, W.ph ? 3400 : 1300);
  }
  function respawn() {
    if (st.mode !== 'crashed') return;
    const g = W.plane.group;
    if (Math.hypot(g.position.x - W.base.x, g.position.z - W.base.z) < 2200) { spawn(); toast('Back on the runway · throttle up'); }
    else { g.position.y = Math.max(ground(g.position.x, g.position.z) + 650, 700); setHeading(g, P.hdg); W.plane.gearK = 0; st.teleport = true;
      Object.assign(P, { v: 210, thr: 0.7, pi: 0, ri: 0, yi: 0, ground: false, rot: 0 }); }
    st.mode = 'fly'; g.visible = SET.cam !== 'cockpit'; resetTrails();
  }
  // a prop got hit by the jet: thump, a little shake, and the patch
  function propHit(n, speed) {
    Snd.noise(0.2, 240, Math.min(1.2, 0.35 + speed / 35)); if (!RM()) st.shake = Math.max(st.shake, Math.min(0.9, speed / 50));
    if (W && W.ph && W.ph.moved() >= 15) award('havoc');
  }
  // on the runway (or any flat ground): throttle, brakes, nose-wheel steering, rotation and lift-off
  function groundRoll(dt) {
    const g = W.plane.group, pos = g.position, fly = st.mode === 'fly';
    if (st.ap) P.thr = Math.max(P.thr, 0.9);
    const steer = st.ap ? 0 : clamp(inp.roll + inp.yaw, -1, 1), brake = fly && inp.pitch < -0.3 ? 1 : 0;
    const thrust = (6 + P.thr * 34 + (P.ab ? 38 : 0)) * 0.36 - (P.thr < 0.05 ? 2.2 : 0), roll = 0.3 + brake * 9;
    P.v = Math.max(0, P.v + (thrust - 0.0006 * P.v * P.v - (P.v > 0.05 ? roll : 0)) * dt); if (P.v < 0.3 && thrust < roll) P.v = 0;
    const auth = Math.min(1, P.v / 3), rate = 0.75 * clamp(1 - (P.v - 45) / 60, 0.2, 1);
    P.hdgG += steer * rate * auth * dt;
    if (P.v > 64 && inp.pitch > 0.15) P.rot = Math.min(0.22, P.rot + inp.pitch * 0.32 * dt); else P.rot = Math.max(0, P.rot - 0.25 * dt);
    if (fly && P.v > 58 && !st.rotHint) { st.rotHint = true; toast(COARSE ? 'Rotate · drag up' : 'Rotate · pull back with W'); }
    g.rotation.set(P.rot, -P.hdgG, 0);
    pos.x += Math.sin(P.hdgG) * P.v * dt; pos.z -= Math.cos(P.hdgG) * P.v * dt;
    const gy = ground(pos.x, pos.z); pos.y = gy + 0.16 + W.plane.gearH; P.g = 1;
    if (!fly) return;
    if (height(pos.x, pos.z) < 0.5) return crash();
    const sl = Math.abs(height(pos.x + 6, pos.z) - height(pos.x - 6, pos.z)) + Math.abs(height(pos.x, pos.z + 6) - height(pos.x, pos.z - 6));
    if (sl > 3.5 && P.v > 25) return crash();
    if (P.v > 66 && P.rot > 0.07) { P.ground = false; pos.y += 0.25; toast('Wheels up · ' + (COARSE ? 'the map opens everything' : 'M opens the map')); }
  }
  function touchdown() {
    const g = W.plane.group, pos = g.position, h = height(pos.x, pos.z), sink = -W.fwd.y * P.v;
    const sl = Math.abs(height(pos.x + 6, pos.z) - height(pos.x - 6, pos.z)) + Math.abs(height(pos.x, pos.z + 6) - height(pos.x, pos.z - 6));
    const ok = h > 0.5 && W.plane.gearK > 0.9 && sink < 9 && Math.abs(P.bank) < 0.35 && P.pitch > -0.12 && P.pitch < 0.4 && sl < 3.5;
    if (!ok) return crash();
    P.ground = true; P.hdgG = P.hdg; P.rot = clamp(P.pitch, 0, 0.22); pos.y = ground(pos.x, pos.z) + 0.16 + W.plane.gearH; st.rotHint = true;
    const onRwy = Math.abs(pos.x - W.base.x) < 24 && Math.abs(pos.z - W.base.z) < 1300;
    if (W.ph) W.ph.fx.tyre(pos.x, ground(pos.x, pos.z), pos.z, 22);
    Snd.noise(0.3, 320, 0.7); if (!RM()) st.shake = Math.min(1, sink / 6);
    toast(onRwy ? (sink < 3 ? 'Greaser! Smooth landing' : 'Touchdown · S brakes') : 'Off-field landing', onRwy && sink < 3); if (onRwy) award('land');
  }
  function apInputs(target, out) {
    const pos = W.plane.group.position, dx = target.x - pos.x, dz = target.z - pos.z, err = wrap(Math.atan2(dx, -dz) - P.hdg);
    const wantBank = clamp(err * 1.5, -0.9, 0.9); out.roll = clamp((wantBank - P.bank) * 2.4, -1, 1);
    const wantFpa = clamp((target.alt - pos.y) / 1400, -0.2, 0.2); out.pitch = clamp((wantFpa - P.pitch) * 4 + Math.abs(P.bank) * 0.45, -1, 1);
    P.thr += (0.72 - P.thr) * 0.02; return Math.hypot(dx, dz);
  }
  let hudTick = 0, sndTick = 0;
  const inp = { pitch: 0, roll: 0, yaw: 0 };
  function update(dt, time) {
    const g = W.plane.group, pos = g.position, q = g.quaternion, cam = W.camera, pad = readPad();
    const fwd = W.fwd.set(0, 0, -1).applyQuaternion(q), up = W.up.set(0, 1, 0).applyQuaternion(q), right = W.right.set(1, 0, 0).applyQuaternion(q);
    P.bank = Math.atan2(-right.y, up.y); P.pitch = Math.asin(clamp(fwd.y, -1, 1)); P.hdg = Math.atan2(fwd.x, -fwd.z);
    const gy = ground(pos.x, pos.z); P.agl = pos.y - gy;
    const sim = st.mode === 'fly' || st.mode === 'title' || st.mode === 'dive';
    const warnings = [];
    if (sim) {
      const k = st.keys; inp.pitch = 0; inp.roll = 0; inp.yaw = 0;
      if (st.mode === 'fly') {
        inp.pitch = (k.up ? 1 : 0) - (k.down ? 1 : 0) - st.stick.y - (pad ? pad.y : 0); inp.roll = (k.right ? 1 : 0) - (k.left ? 1 : 0) + st.stick.x + (pad ? pad.x : 0);
        inp.yaw = (k.yawR ? 1 : 0) - (k.yawL ? 1 : 0) + (pad ? pad.yaw : 0); if (SET.invert) inp.pitch = -inp.pitch;
        if (st.ap && !st.ap.demo && Math.abs(inp.pitch) + Math.abs(inp.roll) + Math.abs(inp.yaw) > 0.1) { st.ap = null; toast('Autopilot off'); }
        if (k.thrUp) P.thr += 0.5 * dt; if (k.thrDn) P.thr -= 0.5 * dt; if (pad) P.thr += (pad.up - pad.dn) * 0.6 * dt; P.thr = clamp(P.thr, 0, 1);
        P.ab = !!(k.ab || st.abTouch || (pad && pad.ab));
      } else P.ab = false;
      const R = Math.hypot(pos.x, pos.z);
      if (R > 9500 && (!st.ap || st.ap.i !== -1)) { st.ap = { i: -1, name: 'the island' }; toast('Leaving the area · turning back'); }
      if (st.ap) {
        const tgt = st.ap.i === -1 ? { x: 0, z: 0, alt: 700 } : (() => { const p = W.places[st.ap.i]; return { x: p.pos.x, z: p.pos.z, alt: p.pos.y + 420 }; })();
        const d = apInputs(tgt, inp);
        if (st.ap.i === -1 && R < 7000) st.ap = null;
        else if (st.ap.i >= 0 && d < 650 && !st.ap.demo) { toast('Arrived · ' + st.ap.name); st.ap = null; }
      } else if (SET.assist && !P.ground) {
        if (Math.abs(inp.roll) < 0.05 && Math.abs(P.bank) < 1.3) inp.roll = clamp(-P.bank * 1.6, -0.6, 0.6);
        if (Math.abs(inp.pitch) < 0.05 && Math.abs(P.bank) < 0.6) inp.pitch = clamp(((W.plane.gearK > 0.9 && P.agl < 25 && P.v < 110 ? -0.025 : 0) - P.pitch) * 2.5, -0.4, 0.4);   // hands off near the ground with gear down = gentle settle
      }
      const sm = Math.min(1, dt * 6); P.pi += (clamp(inp.pitch, -1, 1) - P.pi) * sm; P.ri += (clamp(inp.roll, -1, 1) - P.ri) * sm; P.yi += (clamp(inp.yaw, -1, 1) - P.yi) * sm;
      const a = clamp((P.v - 55) / 120, 0.2, 1), dB = P.bank;
      if (P.ground) groundRoll(dt); else {
      q.multiply(W.qa.setFromAxisAngle(W.X, P.pi * 1.2 * a * dt)).multiply(W.qa.setFromAxisAngle(W.Z, -P.ri * 2.6 * a * dt)).multiply(W.qa.setFromAxisAngle(W.Y, -P.yi * 0.45 * a * dt));
      const turn = 9.81 * Math.tan(clamp(P.bank, -1.35, 1.35)) / Math.max(P.v, 60) * 1.8 * Math.max(0.2, Math.cos(P.pitch));
      q.premultiply(W.qa.setFromAxisAngle(W.Y, -turn * dt));
      if (P.v < 58) { q.premultiply(W.qa.setFromAxisAngle(right, -(58 - P.v) / 58 * 0.9 * dt)); warnings.push('STALL'); }
      if (pos.y > 9000) q.premultiply(W.qa.setFromAxisAngle(right, -0.4 * dt));
      q.normalize();
      const thrust = (6 + P.thr * 34 + (P.ab ? 38 : 0)) * clamp((P.v - 40) / 120, 0.36, 1);   // gentle just after lift-off, full above ~310 kt
      P.v = clamp(P.v + (thrust - (0.0006 + 0.001 * W.plane.gearK) * P.v * P.v - 9.81 * fwd.y) * dt, 40, 560);   // gear down = extra drag, so you can slow for landing
      P.g = clamp(1 + P.pi * 1.2 * a * P.v / 9.81 * 0.55, -3, 9.5);
      pos.addScaledVector(fwd, P.v * dt);
      }
      // roll counter for the patch
      const db = wrap(P.bank - dB); if (Math.abs(P.ri) > 0.6) { st.rollAcc += db; if (Math.abs(st.rollAcc) > Math.PI * 2) { award('roll'); st.rollAcc = 0; } } else st.rollAcc = 0;
      if (st.mode === 'fly') {
        const pl0 = W.plane, contact = Math.max(-pl0.bottom, pl0.gearH * pl0.gearK);
        if (P.ground) { if (st.mode === 'fly') proximity(); }
        else if (P.agl - 0.16 < contact + 0.05 && (fwd.y <= 0.02 || P.agl - 0.16 < contact - 0.6)) touchdown();   // climbing away after lift-off is not a landing
        else {
          const sink = -fwd.y * P.v, appr = pl0.gearK > 0.9 && sink < 9 && Math.abs(P.bank) < 0.35;
          if (!appr && ((sink > 0 && P.agl / sink < 4) || (P.agl < 40 && sink > 5))) warnings.push('PULL UP');
          if (P.v / 343 >= 1) award('mach'); if (P.agl < 30.5 && P.v * 1.944 > 300) award('low');
          if (W.timeName === 'night') { st.nightT += dt; if (st.nightT > 20) award('night'); }
          proximity();
        }
      }
    }
    if (warnings.length && st.mode === 'fly' && (st.warnT -= dt) < 0) { Snd.warn(); st.warnT = 0.45; }

    // aircraft dressing
    const pl = W.plane, thrK = P.thr * 0.6 + (P.ab ? 0.6 : 0);
    pl.burners.forEach(b => { b.scale.z = 0.25 + thrK * (0.9 + Math.random() * 0.15); if (b.material) b.material.opacity = 0.35 + thrK * 0.5; });
    if (pl.strobe) pl.strobe.visible = (time % 1.3) < 0.08;
    if (pl.gear) { const want = P.ground || (P.agl < 160 && P.v < 140 && !(fwd.y > 0.03 && P.agl > 12)) ? 1 : 0; pl.gearK += clamp(want - pl.gearK, -dt / 1.6, dt / 1.6); pl.gear.scale.y = Math.max(0.02, pl.gearK); pl.gear.visible = pl.gearK > 0.03; }
    if (pl.parts) { const pp = pl.parts, set = (o, ax, v) => { if (o) o.rotation[ax] = v; };
      // planes.js convention: rotation.x > 0 = trailing edge down; rudder rotation.y > 0 = nose right
      set(pp.elevL, 'x', -P.pi * 0.35 + P.ri * 0.2); set(pp.elevR, 'x', -P.pi * 0.35 - P.ri * 0.2); set(pp.ailL, 'x', P.ri * 0.35); set(pp.ailR, 'x', -P.ri * 0.35);
      set(pp.rudL, 'y', P.yi * 0.4); set(pp.rudR, 'y', P.yi * 0.4); set(pp.canardL, 'x', P.pi * 0.3); set(pp.canardR, 'x', P.pi * 0.3); }
    g.visible = st.mode !== 'crashed' && !(SET.cam === 'cockpit' && (st.mode === 'fly' || st.mode === 'held'));
    g.updateMatrixWorld();
    if (st.mode === 'fly' || st.mode === 'title') { const vap = clamp((P.g - 3) / 3, 0, 1) * 0.9 + (P.v > 320 ? 0.25 : 0); W.trails.forEach((tr, i) => stepTrail(tr, pl.group.localToWorld(W.v3.copy(pl.tips[i])), vap)); }
    const live = sim || st.mode === 'crashed';
    W.vel.copy(fwd).multiplyScalar(st.mode === 'crashed' ? 0 : P.v);
    if (W.ph && live) { W.ph.step(dt, { pos, quat: q, gear: pl.gearK > 0.5, teleport: st.teleport }); st.teleport = false; }
    if (W.nat && live) W.nat.update(dt, time, { pos, vel: W.vel, v: st.mode === 'crashed' ? 0 : P.v, agl: P.agl, onGround: !!P.ground, thr: P.thr, ab: P.ab, fwd, len: pl.len, water: height(pos.x, pos.z) < 0 }, cam.position);
    if (st.mode === 'crashed') { st.boomT += dt; W.boom.scale.setScalar(5 + st.boomT * 90); W.boom.material.opacity = Math.max(0, 1 - st.boomT * 1.2); }

    // camera
    const k8 = 1 - Math.exp(-dt * 8);
    if (st.mode === 'photo') { const o = W.orbit; cam.up.set(0, 1, 0); cam.position.set(pos.x + Math.sin(o.a) * Math.cos(o.p) * o.r, pos.y + Math.sin(o.p) * o.r, pos.z + Math.cos(o.a) * Math.cos(o.p) * o.r); cam.lookAt(pos); }
    else if (SET.cam === 'cockpit' && (st.mode === 'fly' || st.mode === 'held')) { cam.position.copy(pl.group.localToWorld(W.v3.copy(pl.eye || W.v4.set(0, 1, -4)))); cam.quaternion.copy(q); }
    else if (st.mode === 'dive' || st.mode === 'title') {
      if (st.mode === 'dive') { st.diveT += dt / (RM() ? 0.05 : 2.4); if (st.diveT >= 1) { st.diveT = 1; showTitle(); } }
      const e = ease(Math.min(st.diveT, 1)); W.ang += dt * (RM() ? 0.03 : 0.12);
      const L = pl.len, start = W.v4.set(L * 0.55, L * 0.12, -L * 1.1), orbit = W.v3.set(Math.sin(W.ang) * L * 2.3, L * 0.5, Math.cos(W.ang) * L * 2.3);
      const off = st.mode === 'dive' ? start.applyQuaternion(q).lerp(orbit, e) : orbit;
      cam.position.copy(pos).add(off); cam.up.set(0, 1, 0); cam.lookAt(pos);
    } else if (st.mode === 'crashed') {
      const wp = W.ph && W.ph.wreckPos();
      if (wp && st.crashDir) { const want = W.v3.copy(st.crashDir).multiplyScalar(-48).add(wp); want.y = Math.max(wp.y + 16, ground(want.x, want.z) + 12);
        cam.position.lerp(want, 1 - Math.exp(-dt * 3.5)); cam.up.set(0, 1, 0); cam.lookAt(wp); }
    } else {
      const L = pl.len, want = W.v3.copy(fwd).multiplyScalar(-(L * 1.7 + 8)).addScaledVector(up, L * 0.25 + 1).addScaledVector(W.Y, L * 0.15 + 1.5);
      W.camOff.lerp(want, k8); cam.position.copy(pos).add(W.camOff);
      cam.up.copy(W.Y).lerp(up, 0.45).normalize(); cam.lookAt(W.look.copy(pos).addScaledVector(fwd, 60));
    }
    if (st.shake > 0) { cam.position.x += (Math.random() - 0.5) * st.shake; cam.position.y += (Math.random() - 0.5) * st.shake; st.shake = Math.max(0, st.shake - dt * 2); }
    const cgy = ground(cam.position.x, cam.position.z) + 1.2; if (cam.position.y < cgy) cam.position.y = cgy;
    const fov = W.baseFov + (RM() ? 0 : (P.ab ? 7 : 0) + clamp((P.v - 200) / 40, 0, 5));
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }

    // sky follows camera; landmarks animate
    W.sky.position.copy(cam.position); W.stars.position.copy(cam.position); W.water.position.set(cam.position.x, 0, cam.position.z);
    W.sunSpr.position.copy(cam.position).addScaledVector(W.sunDir, 25000);
    const night = W.timeName === 'night'; W.animated.forEach(o => o.update(dt, time, night));
    W.beacons.forEach(b => { b.mesh.rotation.y += dt * 1.2; b.mesh.position.y += Math.sin(time * 1.5 + b.n) * 0.08; });

    // sound + HUD
    if (++sndTick % 6 === 0) Snd.engine(st.mode === 'door' ? 0 : st.mode === 'held' ? P.thr * 0.4 : P.thr, P.v, P.ab);
    drawHUD(warnings, time);
  }

  function proximity() {
    const pos = W.plane.group.position;
    let near = null;
    W.places.forEach(p => { const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z); if (d < 800 && pos.y - p.pos.y < 2600) { near = p; if (!st.visited.has(p.i)) { st.visited.add(p.i); if (st.visited.size >= W.places.length) award('tour'); } } });
    if (near !== st.prompt) {
      st.prompt = near; const slot = $('#slot-prompt');
      if (slot) slot.innerHTML = near ? `<div class="prompt"><span class="n">0${near.i + 1}</span><div><b>${esc(near.name)}</b><span>${esc(near.line || '')}</span></div>
        <button type="button" class="btn y" data-act="enter">Go in <kbd>⏎</kbd></button></div>` : '';
    }
    W.beacons.forEach((b, i) => {
      if (b.heard || pos.distanceTo(b.pos) > 300) return;
      b.heard = true; st.heard.add(i); b.mesh.material.color.set('#9fe0b7'); b.mesh.material.emissive.set('#0f6b45'); b.mesh.scale.setScalar(0.6);
      Snd.radio(); if (st.heard.size >= W.beacons.length) award('radio');
      const slot = $('#slot-bubble'); if (!slot) return;
      const line = String(b.item.text || '').replace(/\*\*/g, '').split(/(?<=\.)\s/)[0].slice(0, 120);
      slot.innerHTML = `<div class="bubble"><div class="who"><i></i>${esc(b.place.name)} · beacon ${b.n}</div><p>“${esc(CALL)}, ${esc(b.item.title)}.” ${esc(line)}</p>
        <button type="button" class="btn sm" data-act="read" data-i="${i}">Read it</button></div>`;
      clearTimeout(st.bubbleT); st.bubbleT = setTimeout(() => { if (slot) slot.innerHTML = ''; }, 9000);
    });
  }

  function drawHUD(warnings, time) {
    const ctx = W.hud, s = W.hudScale, w = innerWidth, h = innerHeight; if (!ctx) return;
    ctx.setTransform(s, 0, 0, s, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!SET.hud || !FP.hud || !(st.mode === 'fly' || st.mode === 'held')) return;
    const pos = W.plane.group.position, cam = W.camera;
    let tgt = null, tp = st.ap && st.ap.i >= 0 ? W.places[st.ap.i] : null;
    if (!tp) { let best = 1e9; W.places.forEach(p => { if (st.visited.has(p.i)) return; const d = pos.distanceTo(p.pos); if (d < best) { best = d; tp = p; } }); }
    if (tp) {
      const v = W.v3.set(tp.pos.x, tp.pos.y + 150, tp.pos.z).project(cam); let x = v.x, y = v.y; const behind = v.z > 1; if (behind) { x = -x; y = -y; }
      const on = !behind && Math.abs(x) < 0.94 && Math.abs(y) < 0.9;
      tgt = { name: tp.name.toUpperCase(), distNm: Math.hypot(pos.x - tp.pos.x, pos.z - tp.pos.z) / 1852, sx: (x + 1) / 2 * w, sy: (1 - y) / 2 * h, onScreen: on, edgeAngle: Math.atan2(-y, x) };
    }
    const fpa = P.pitch - clamp(P.pi * 0.06 + (P.v < 120 ? (120 - P.v) / 400 : 0.02), -0.05, 0.25);
    FP.hud.draw(ctx, w, h, { view: SET.cam === 'cockpit' ? 'cockpit' : 'chase', pitch: P.pitch, bank: P.bank, heading: (P.hdg + Math.PI * 2) % (Math.PI * 2), fpa,
      pxPerRad: h / (cam.fov * Math.PI / 180), speedKt: P.v * 1.944, mach: P.v / 343, altFt: pos.y * 3.281, aglFt: P.agl * 3.281,
      vsFpm: Math.sin(P.pitch) * P.v * 196.85, throttle: P.thr, afterburner: P.ab, g: P.g, aoaDeg: (P.pitch - fpa) * 57.3, target: tgt, warnings,
      autopilot: st.ap && !st.ap.demo ? st.ap.name : null, time, color: '#8dffb0', small: w < 600 });
  }

  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (world.hidden || !W || st.mode === 'door') return;
    update(dt, now / 1000); W.renderer.render(W.scene, W.camera);
  }

  // =================================================================== ?plain=1: the same home page, nothing 3D on it at all
  function renderPlain() {
    st.mode = 'plain'; document.documentElement.classList.add('plain-mode'); document.title = NAME;
    renderDoor(true);
  }

  // =================================================================== go
  if (/[?&]debug=1/.test(location.search)) window.__flight = { st, P, world: () => W, step(n, dt) { for (let i = 0; i < n; i++) update(dt || 1 / 60, performance.now() / 1000); W.renderer.render(W.scene, W.camera); } };
  if (/[?&]plain=1/.test(location.search)) renderPlain();
  else { document.title = NAME; renderDoor(); if (/[?&]fly=1/.test(location.search)) flyIn(); }
})();
