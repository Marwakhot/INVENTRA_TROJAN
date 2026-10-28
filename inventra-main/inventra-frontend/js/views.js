/* =====================================================================
   INVENTRA FRONTEND · views: Command Center, Data Hub, Forecast, Disruptions
   ===================================================================== */

/* lazy loader: returns the cached value, or starts the request and re-renders when it lands */
const LAZY = {};
function lazy(bucket, k, fn){
  const b = LAZY[bucket] || (LAZY[bucket] = {});
  if (k in b) return b[k] === 'loading' ? null : b[k];
  b[k] = 'loading';
  fn().then(v => { b[k] = v; render(CURRENT, true); }).catch(e => { b[k] = {error: errMsg(e)}; render(CURRENT, true); });
  return null;
}
function clearLazy(){ Object.keys(LAZY).forEach(k => delete LAZY[k]); }

function actText(d){
  if (!d) return '';
  if (d.type === 'transfer') return d.legs.map(l => `${fmt(l.qty)} from ${locName(l.from)}`).join(' + ');
  if (d.type === 'reorder') return `order ${fmt(d.qty)}${d.order_day ? ' on ' + pdlab(d.order_day) : ' now'}`;
  if (d.type === 'bring_forward') return `${d.po_id} ${d.days} days earlier`;
  if (d.type === 'delay_inbound') return `${d.po_id} ${d.days} days later`;
  if (d.type === 'reduce_inbound') return `${d.po_id} to ${fmt(d.new_qty)} units`;
  if (d.type === 'flag_clearance') return 'flag for clearance review';
  return 'wait';
}

/* ================= COMMAND CENTER ================= */
let BI = 0;
function renderBrief(){
  const recs = S.plan.queue, el = $('brief'); if (!el) return;
  if (!recs.length){ el.innerHTML = `<span class="bt"><b>No recommendation needs a decision</b><span>Every location stays above its buffer, or no option passes the checks.</span></span>`; return; }
  BI = BI % recs.length; const r = recs[BI], k = key(r.sku, r.location), d = activeDecision(k);
  el.innerHTML = `<span class="bn"><b>${pad(BI+1)}</b>/${pad(recs.length)}</span>
    <span class="bt"><b>${esc(r.sku)} → ${esc(locName(r.location))} ${urgTag(r.urgency)}${d ? `<span class="pill ${d.status}">${d.status}</span>` : ''}</b><span>${esc(r.top.label)}: ${esc(actText(r.top.decision))}.${r.top.net_benefit_aed != null ? ` Net ${aed(r.top.net_benefit_aed)} vs Do nothing.` : ''}</span></span>
    <button class="rb" onclick="openLab(${jsq(k)})" title="Open in Scenario Lab" aria-label="Open in Scenario Lab">${IC.arrow}</button>
    <button class="rb w" onclick="BI=(BI+1);renderBrief()" aria-label="Next recommendation">${IC.right}</button>`;
}
function viewHome(){
  const h = new Date().getHours(), part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const recs = S.plan.queue, open = recs.filter(r => { const d = activeDecision(key(r.sku, r.location)); return !d || d.status === 'Stale' || d.status === 'Rejected'; });
  const K = S.plan.kpis, b = K.before, a = K.after;
  const kc = (label, bv, av, fmtf, hero, sub) => {
    const d = av - bv, good = d < 0;
    const mx = Math.max(Math.abs(bv), Math.abs(av)) || 1;
    return `<div class="kc ${hero ? 'hero' : ''}"><span class="lbl">${label}</span>
      <div class="ba"><span class="now">${fmtf(av)}</span>${hero ? '' : `<span class="was">${fmtf(bv)}</span>`}</div>
      <div class="dl ${hero ? '' : (Math.abs(d) < 0.5 ? '' : good ? 'up' : 'down')}">${hero ? 'vs Do nothing, 30 days' : Math.abs(d) < 0.5 ? 'no change' : (d < 0 ? '−' : '+') + fmtf(Math.abs(d)).replace('AED ', '') + ' with plan'}${sub ? ` · ${sub}` : ''}</div>
      ${hero ? '' : `<div class="bars"><i style="width:${Math.abs(bv)/mx*100}%"></i><i class="a" style="width:${Math.abs(av)/mx*100}%"></i></div>`}</div>`;
  };
  const rejected = (S.plan.rejected || []).filter(o => o.decision.type === 'transfer')
    .sort((x, y) => (x.failing_checks[0] === 'Economic' ? 0 : 1) - (y.failing_checks[0] === 'Economic' ? 0 : 1));
  const watch = S.plan.no_action;
  const top = recs[0];
  const ask = keyed()
    ? `<form class="ask" onsubmit="event.preventDefault();openPilot($('homeQ').value);$('homeQ').value=''">
        <input id="homeQ" placeholder="Ask a what-if: “What if we also reorder 50 power banks for Abu Dhabi?”" autocomplete="off"><span class="kbd">/</span>
        <button class="go" aria-label="Ask">${IC.send}</button></form>
      <div class="chips-d"><button onclick="openPilot('What if we also reorder 50 power banks for Abu Dhabi?')">Reorder 50 power banks for Abu Dhabi</button><button onclick="openPilot('Explain the top recommendation')">Explain the top recommendation</button></div>`
    : `<div class="ask keyless"><span>${IC.flask}</span><span class="sp1">Keyless mode: typed questions are off. Use the scenario builder controls in the Lab; every number is the same in both modes.</span><button class="btn sm solid" onclick="openLab()">Open the Lab</button></div>
      <div class="chips-d"><button onclick="openLab('CHG-01|Abu Dhabi')">CHG-01 → Abu Dhabi in the Lab</button><button onclick="go('data');setTimeout(()=>$('inboxCard')&&$('inboxCard').scrollIntoView({behavior:'smooth',block:'center'}),100)">Drop SIG-001 into the inbox</button><button onclick="openPilot()">Explanations</button></div>`;
  return `
  <div class="home-stage crs-home rv" id="homeStage">
    <div class="hs-head"><span class="lbl">${esc(new Date().toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'short'}))} · planning day ${dlabIso(S.planDay)}</span>
      <h1>Good ${part}, ${esc(plannerName())}.<br><em>What are we starting with today?</em></h1></div>
    <div class="crs" id="crs" tabindex="0" role="region" aria-roledescription="carousel" aria-label="Pages" onkeydown="crsKey(event)" onpointerdown="crsDown(event)" onpointermove="crsMove(event)" onpointerup="crsUp(event)" onpointerleave="crsUp(event)"><div class="crs-stage" id="crsStage"></div></div>
    <div class="crs-ctl"><button class="crs-arr" onclick="crsStep(-1);crsHold()" aria-label="Previous page">${IC.left}</button><span class="crs-dots" id="crsDots"></span><button class="crs-arr" onclick="crsStep(1);crsHold()" aria-label="Next page">${IC.right}</button></div>
    <div class="core">
      <div class="brief" id="brief"></div>
      ${ask}
    </div>
    <div class="watch"><i></i> Watcher ${S.mode.watcher ? 'on · inbox listening' : 'off'} · ${SKUS().length} SKUs × ${LOCS.length} locations · ${keyed() ? 'LLM on' : 'keyless'}</div>
  </div>

  <div class="kstrip k8 rv" style="--d:.08s">
    ${kc('Shortage units', b.shortage_units, a.shortage_units, fmt)}
    ${kc('Buffer-breach days', b.buffer_breach_days, a.buffer_breach_days, fmt)}
    ${kc('Excess units, day 30', b.excess_units, a.excess_units, fmt)}
    ${kc('Ageing units, day 30', b.ageing_units, a.ageing_units, fmt, false, aed(a.ageing_aed))}
    ${kc('Aged units, day 30', b.aged_units, a.aged_units, fmt, false, aed(a.aged_aed))}
    ${kc('Holding cost', b.holding_cost_aed, a.holding_cost_aed, aed)}
    ${kc('Transfer and expedite cost', b.transfer_cost_aed + b.expedite_cost_aed, a.transfer_cost_aed + a.expedite_cost_aed, aed)}
    ${kc('Net benefit', 0, K.net_benefit_aed, aed, true)}
  </div>

  <div class="grid">
    <div class="card span-8 rv" style="--d:.14s">
      <div class="card-h"><div><h3>Recommendation queue</h3><div class="hint">Most urgent first.</div></div><span class="tag">${recs.length} to decide</span></div>
      ${recs.map(r => queueItem(r)).join('') || '<div class="empty">No shortage needs action in the next 30 days.</div>'}
      ${watch.length ? `<details class="receipt" style="margin-top:10px"><summary><span>${watch.length} SKU-locations where no option passes the checks</span><span class="muted">watch</span></summary><div class="rbody">${watch.map(r => { const alt = (r.alternatives || []).find(o => o.rejection_reason); return `<div class="ln"><span>${esc(r.sku)} · ${esc(locName(r.location))} · ${esc(r.status)}${r.breach_date ? ', breach ' + dlabIso(r.breach_date) : ''}</span><span class="muted">${esc(alt ? alt.rejection_reason.split(' | ')[0] : 'no candidate passes')}</span></div>`; }).join('')}</div></details>` : ''}
    </div>
    <div class="stack span-4">
      <div class="card rv" style="--d:.18s">
        <div class="card-h"><div><h3>Alerts</h3></div></div>
        ${alerts().slice(0, 7).map(x => `<button class="note-i" onclick="${x.go}"><i style="background:${x.c}"></i><div><b>${esc(x.t)}</b><span>${esc(x.s)}</span></div></button>`).join('') || '<div class="empty">Nothing needs attention.</div>'}
      </div>
    </div>
  </div>
  <div class="grid">
    <div class="card span-6 rv" style="--d:.22s">
      <div class="card-h"><div><h3>Rejected options</h3><div class="hint">Tested and turned down, with the reason.</div></div></div>
      ${rejected.slice(0, 7).map(o => `<div class="rej"><div><b>${esc(o.sku)} · ${esc(o.label)}</b><div class="why">${esc(o.rejection_reason || o.failing_checks.join(', '))}</div></div><div class="r">${robTag(o.robustness)}</div></div>`).join('') || '<div class="empty">No transfer was rejected.</div>'}
    </div>
    <div class="card span-6 rv" style="--d:.26s">
      <div class="card-h"><div><h3>Activity feed</h3></div>${arrowBtn("go('data')")}</div>
      ${activityFeed(5)}
    </div>
  </div>`;
}
const plannerName = () => { const p = (S.mode && S.mode.planner) || 'planner'; return p === 'planner' ? 'Sara' : p; };
function queueItem(r){
  const k = key(r.sku, r.location), d = activeDecision(k), o = r.top, decided = d && ['Approved','Overridden','Rejected'].includes(d.status);
  const alts = r.alternatives || [];
  const q = (S.plan.questions || []).find(x => !ANSWERED[x.po_id] && x.effects.some(e => e.sku === r.sku && e.location === r.location));
  const econ = o.economics || {};
  return `<div class="q-item ${decided ? 'done' : ''}">
    <span class="n">${pad(r.rank)}</span>
    <div><div class="tt">${esc(r.sku)} → ${esc(locName(r.location))} ${urgTag(r.urgency)} ${robTag(o.robustness)} ${d ? `<span class="pill ${d.status}">${d.status}</span>` : ''} ${o.status === 'Advisory' ? '<span class="tag warn">Advisory</span>' : ''} ${q ? '<span class="tag sig">1 question</span>' : ''}</div>
      <div class="ss">${esc(r.name)} · ${esc(o.label)}: ${esc(actText(o.decision))}</div>
      <div class="ss">${o.net_benefit_aed != null ? `<b style="color:var(--ink)">${aed(o.net_benefit_aed)}</b> net · ${fmt(econ.lost_sales_avoided)} lost sales avoided · ${fmt(o.breach_days_total)} days below safety` : esc(o.note || '')}${r.breach_date ? ` · breach ${dlabIso(r.breach_date)} if nothing changes` : ''}</div>
      ${alts.length ? `<details class="alts"><summary>See alternatives (${alts.length})</summary>${alts.map(x => `<div class="alt"><span>${esc(x.label)}</span><span class="num-t">${sgn(x.net_benefit_aed)}</span>${robTag(x.robustness)}<span class="${x.status === 'Rejected' ? 'why' : 'muted'}">${x.status === 'Rejected' ? esc(x.failing_checks.join(', ')) : esc(x.status.toLowerCase())}</span></div>`).join('')}</details>` : ''}</div>
    <div class="acts">${decided ? `<button class="btn sm" onclick="openDecision('${d.decision_id}')">Receipt</button>` : `<button class="btn sm acc" onclick="approveRec(${jsq(k)})">Approve</button><button class="btn sm" onclick="rejectModal(${jsq(k)})">Reject</button>`}<button class="btn sm" onclick="openLab(${jsq(k)})">Open in Lab</button></div>
  </div>`;
}
/* ---------------- home carousel: the six pages on a slowly turning, concave cylinder ---------------- */
const CRS = {cur:0, k:[], t:null, pause:0, drag:null};
const CRS_STEP_MS = 3000, CRS_THETA = 27;   // one step every 3 s; degrees between cards
const CRS_SEEDS = [3, 11, 19, 27, 35, 43];
// Marbled swirl lines: stripes bent by fractal noise. Used faintly on the cards and the page background.
// Draw a swirl once into a plain PNG, so the browser doesn't re-run the SVG noise filter on every frame
const SWIRL_PNG = {};
function swirlPNG(...a){
  const k = a.join('|');
  return SWIRL_PNG[k] || (SWIRL_PNG[k] = new Promise(res => {
    const svg = swirlURI(...a).slice(5, -2), img = new Image(), w = a[3] || 400, h = a[4] || 520;
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res(`url("${c.toDataURL('image/png')}")`); } catch (e) { res(swirlURI(...a)); } };
    img.onerror = () => res(swirlURI(...a));
    img.src = svg;
  }));
}
function swirlURI(seed, color, opacity, w = 400, h = 520, gap = 9, scale = 140, freq = '0.006 0.009'){
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'><defs><filter id='f' x='-20%' y='-20%' width='140%' height='140%'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' seed='${seed}'/><feDisplacementMap in='SourceGraphic' scale='${scale}' xChannelSelector='R' yChannelSelector='G'/></filter><pattern id='p' width='${gap}' height='${gap}' patternUnits='userSpaceOnUse'><rect width='${gap}' height='1' fill='${color}'/></pattern></defs><rect x='-${w / 4}' y='-${h / 4}' width='${w * 1.5}' height='${h * 1.5}' fill='url(%23p)' filter='url(%23f)' opacity='${opacity}'/></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/'/g, '%27').replace(/"/g, '%22')}")`;
}
function buildCarousel(){
  const stage = $('crsStage'); if (!stage) return;
  const list = SECTIONS.map((s, i) => ({...s, no:pad(i + 2), ...secStat(s.id)}));
  if (CRS.k.length !== list.length) CRS.k = list.map((_, i) => { let k = ((i - CRS.cur) % list.length + list.length) % list.length; return k > list.length / 2 ? k - list.length : k; });
  stage.innerHTML = list.map((t, i) => `<button class="crs-c" data-i="${i}" onclick="crsClick(${i})" aria-label="${esc(t.label)}: ${esc(t.st)}">
      <span class="crs-sw"></span>
      <span class="crs-top"><span class="crs-no">${t.no}</span>${t.bd ? `<span class="crs-bd">${t.bd}</span>` : ''}</span>
      <span class="crs-ic">${IC[t.i]}</span>
      <span class="crs-txt"><span class="crs-stage-l">${esc(t.stage)}</span><b>${esc(t.label)}</b><small>${esc(t.st)}</small></span>
      <span class="crs-go">Open ${IC.arrow}</span></button>`).join('');
  [...stage.children].forEach((c, i) => swirlPNG(CRS_SEEDS[i % CRS_SEEDS.length], '#ffffff', 0.5).then(u => c.style.setProperty('--sw', u)));
  $('crsDots').innerHTML = list.map((t, i) => `<button class="${i === CRS.cur ? 'on' : ''}" onclick="crsTo(${i})" aria-label="Show ${esc(t.label)}"></button>`).join('');
  layoutCarousel(false);
  crsArm();
}
function layoutCarousel(animate = true){
  const box = $('crs'), stage = $('crsStage'); if (!box || !stage) return;
  const W = box.clientWidth, cw = Math.round(Math.max(138, Math.min(212, W * 0.19))), R = Math.round(Math.max(230, Math.min(560, W * 0.5)));
  box.style.setProperty('--cw', cw + 'px'); box.style.setProperty('--ch', Math.round(cw * 1.32) + 'px');
  [...stage.children].forEach((c, i) => {
    const k = CRS.k[i], d = Math.min(3, Math.abs(k));
    if (!animate) c.style.transition = 'none';
    c.style.transform = `translate(-50%, -50%) translateZ(${R}px) rotateY(${-k * CRS_THETA}deg) translateZ(${-R}px)`;
    c.className = `crs-c d${d}`;
    c.tabIndex = d === 0 ? 0 : -1;
    if (!animate){ c.offsetWidth; c.style.transition = ''; }
  });
  document.querySelectorAll('#crsDots button').forEach((b, i) => b.classList.toggle('on', i === CRS.cur));
}
// Move by d cards. A card leaving one edge slides out hidden, then re-enters from the other edge.
function crsStep(d){
  const n = CRS.k.length, stage = $('crsStage'); if (!n || !stage) return;
  const half = n / 2;
  [...stage.children].forEach((c, i) => {
    let k = CRS.k[i] - d;
    if (k < -half){ CRS.k[i] += n; k += n; }
    else if (k > half){ CRS.k[i] -= n; k -= n; }
    else return void (CRS.k[i] = k);
    // snap to the far side without animating, then animate in
    CRS.k[i] = k + d; layoutOne(c, i); c.offsetWidth; CRS.k[i] = k;
  });
  CRS.cur = ((CRS.cur + d) % n + n) % n;
  layoutCarousel(true);
}
function layoutOne(c, i){
  const box = $('crs'), W = box.clientWidth, R = Math.round(Math.max(230, Math.min(560, W * 0.5)));
  c.style.transition = 'none';
  c.style.transform = `translate(-50%, -50%) translateZ(${R}px) rotateY(${-CRS.k[i] * CRS_THETA}deg) translateZ(${-R}px)`;
  c.className = 'crs-c d3';
  c.offsetWidth; c.style.transition = '';
}
function crsTo(i){
  const n = CRS.k.length; let d = ((i - CRS.cur) % n + n) % n; if (d > n / 2) d -= n;
  const dir = Math.sign(d); for (let s = 0; s < Math.abs(d); s++) setTimeout(() => crsStep(dir), s * 260);
  crsHold();
}
function crsClick(i){ if (Date.now() < (CRS.dragEnd || 0)) return; const k = CRS.k[i]; if (k === 0){ go(SECTIONS[i].id); return; } crsTo(i); }
function crsHold(){ CRS.pause = Date.now() + 8000; }
function crsArm(){
  clearInterval(CRS.t);
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  CRS.t = setInterval(() => {
    const box = $('crs');
    if (CURRENT !== 'home' || !box || document.hidden || Date.now() < CRS.pause || box.matches(':hover') || box.contains(document.activeElement)) return;
    crsStep(1);
  }, CRS_STEP_MS);
}
function crsDown(e){ CRS.drag = {x:e.clientX, moved:false}; }
function crsMove(e){
  if (!CRS.drag) return;
  const dx = e.clientX - CRS.drag.x;
  if (Math.abs(dx) > 48){ crsStep(dx < 0 ? 1 : -1); CRS.drag.x = e.clientX; CRS.drag.moved = true; crsHold(); }
}
function crsUp(){ if (CRS.drag && CRS.drag.moved) CRS.dragEnd = Date.now() + 250; CRS.drag = null; }
function crsKey(e){ if (e.key === 'ArrowRight'){ crsStep(1); crsHold(); e.preventDefault(); } else if (e.key === 'ArrowLeft'){ crsStep(-1); crsHold(); e.preventDefault(); } }
RENDER.home = viewHome;
(function(){
  const set = () => { const dark = document.documentElement.dataset.sp === 'dark';
    const line = dark ? '#7F9BFF' : '#4A6EF0', args = [1600, 1000, 14, 420, '0.0016 0.0026'];
    swirlPNG(5, line, dark ? 0.08 : 0.065, ...args).then(u => document.documentElement.style.setProperty('--bg-swirl', u));
    swirlPNG(5, '#000000', 1, ...args).then(u => document.documentElement.style.setProperty('--bg-swirl-mask', u)); };
  set(); new MutationObserver(set).observe(document.documentElement, {attributes:true, attributeFilter:['data-sp']});
  // Light travelling along the swirl lines: a soft moving glow, masked to the lines themselves
  const fx = document.createElement('div'); fx.id = 'bgFx'; fx.setAttribute('aria-hidden', 'true'); // 9 small lights, each crossing the screen on its own slow path; they only show where they meet a swirl line
  const rnd = (a, b) => a + Math.random() * (b - a);
  fx.innerHTML = '<i>' + Array.from({length:9}, () => { const ltr = Math.random() < .5;
    return `<b style="--s:${rnd(5, 11).toFixed(1)}vmax;--d:${rnd(18, 34).toFixed(1)}s;--dl:-${rnd(0, 34).toFixed(1)}s;--x0:${ltr ? -10 : 110}vw;--y0:${rnd(0, 100).toFixed(0)}vh;--x1:${ltr ? 110 : -10}vw;--y1:${rnd(0, 100).toFixed(0)}vh"></b>`; }).join('') + '</i>';
  (document.body ? document.body.prepend(fx) : document.addEventListener('DOMContentLoaded', () => document.body.prepend(fx)));
})();

/* ================= DATA HUB ================= */
const PARAMS = [
  ['horizon_days','Planning horizon (the forecast covers 30 days)'], ['max_cover_days','Stock above this many days of P50 cover is Excess'],
  ['ageing_days','Batch age where the Ageing tier and ageing cost start'], ['aged_days','Batch age counted as Aged'],
  ['ageing_cost_pct_per_30_days','Ageing cost, % of unit cost per 30 days'], ['review_buffer_days','Review buffer in the order-by date'],
  ['review_period_days','Review period R in the order-up-to rule'], ['base_rate_window_days','Window for the weighted base rate'],
  ['low_confidence_band_widening','Band widening (%) when confidence is Low'], ['confidence_thresholds','Confidence badge thresholds: medium%;low%;min units'],
  ['urgency_soon_days','Slack up to this many days is Soon'], ['freshness_days','Data older than this raises the freshness banner'],
  ['baseline_reorder_days','Baseline reorder quantity in days of demand'], ['backtest_step_days','Spacing of rolling backtest origins']
];
const DH_IC = {
  box:`<svg viewBox="0 0 24 24" ${P}><path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10"/></svg>`,
  shield:`<svg viewBox="0 0 24 24" ${P}><path d="M12 3l8 3v6c0 4.5-3.4 7.6-8 9-4.6-1.4-8-4.5-8-9V6z"/></svg>`,
  bars:`<svg viewBox="0 0 24 24" ${P}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  truck:`<svg viewBox="0 0 24 24" ${P}><path d="M2 6h12v10H2zM14 10h4l3 3v3h-7M6 19a2 2 0 100-.1M17 19a2 2 0 100-.1"/></svg>`
};
// Day-based parameters drawn on the timeline; the rest show as chips underneath
const DH_RULER = [['freshness_days','stale'], ['review_period_days','review'], ['backtest_step_days','backtest'], ['base_rate_window_days','base rate'], ['horizon_days','horizon'], ['max_cover_days','max cover'], ['ageing_days','ageing'], ['aged_days','aged']];
const DH_CHIPS = [['review_buffer_days','Review buffer', v => `${v} d`], ['urgency_soon_days','Urgent if slack ≤', v => `${v} d`], ['baseline_reorder_days','Baseline reorder', v => `${v} d`],
  ['ageing_cost_pct_per_30_days','Ageing cost', v => `${v}% / 30 d`], ['low_confidence_band_widening','Low-confidence widening', v => `${v}%`],
  ['confidence_thresholds','Confidence thresholds', v => typeof v === 'object' && v ? `${v.medium_pct} · ${v.low_pct}% · ${v.min_units} u` : String(v)]];
function dhTiles(){
  const inv0 = S.stock[0] || {available:{}};
  const pos = new Map(); S.stock.forEach(r => r.incoming.forEach(p => pos.set(p.po_id, p)));
  const unconf = [...pos.values()].filter(p => p.status === 'Unconfirmed').length;
  const salesDays = sum(S.fc.map(f => f.chart.history.filter(p => p.observed !== null && p.observed !== undefined).length));
  const unver = S.signals.filter(s => s.status === 'Unverified').length;
  const last = arr => arr.length ? `last ${tlab(arr[arr.length - 1])}` : 'none yet';
  const tile = (ic, n, t, s, src) => `<div class="dh-tile ${n ? '' : 'zero'}">${ic ? `<span class="dh-ic">${ic}</span>` : ''}<span class="dh-n">${fmt(n)}</span><span class="dh-t">${t}</span><span class="dh-s">${s}</span>${src ? `<span class="dh-src">${esc(src)}</span>` : ''}</div>`;
  return `<div class="dh-stats rv" style="--d:.05s">
    <div class="dh-group"><span class="lbl">Supplied data${inv0.available.as_of ? ` · as of ${tlab(inv0.available.as_of)}` : ''}</span><div class="dh-tiles" style="--n:5">
      ${tile(DH_IC.box, S.stock.length, 'Stock records', `${SKUS().length} SKUs × ${LOCS.length} locations`, inv0.available.source_file)}
      ${tile(DH_IC.shield, S.stock.filter(r => r.safety_stock && r.safety_stock.value != null).length, 'Safety stock', 'buffer levels set', (inv0.safety_stock || {}).source_file)}
      ${tile(DH_IC.bars, salesDays, 'Sales days', '90 days of history', 'sales_daily.csv')}
      ${tile(DH_IC.truck, pos.size, 'Inbound orders', unconf ? `${pos.size - unconf} confirmed · ${unconf} unconfirmed` : 'all confirmed', 'inbound_orders.csv')}
      ${tile(IC.bolt, S.signals.length, 'Signals', unver ? `${unver} unverified` : 'all confirmed', 'signals.csv + inbox')}
    </div></div>
    <div class="dh-group"><span class="lbl">Written by you and the app</span><div class="dh-tiles" style="--n:3">
      ${tile('', S.corrections.length, 'Corrections', last(S.corrections.map(c => c.timestamp)))}
      ${tile('', S.events.events.length, 'Inbox events', S.events.events.length ? `last ${tlab(S.events.events[0].received_at)}` : 'none yet')}
      ${tile('', S.decisions.length, 'Decisions', last(S.decisions.map(d => d.timestamp)))}
    </div></div>
  </div>
`;
}
// Sales history coverage: one strip per location, one cell per history day
function dhCoverage(){
  const n = (S.fc[0] && S.fc[0].chart.history.length) || 90;
  let miss = 0, runs = 0;
  const rows = LOCS.map(l => {
    const fcs = S.fc.filter(f => f.location === l.id);
    let prev = false, cells = '';
    for (let d = 0; d < n; d++){
      const h = fcs.map(f => f.chart.history[d]).filter(Boolean);
      const m = h.filter(p => p.imputed).length, o = h.filter(p => p.out_of_stock).length;
      const date = h[0] ? h[0].date : '';
      const cls = m ? 'm' : o ? 'o' : '';
      if (m && m === h.length) miss++;
      if (o && !prev) runs++; prev = !!o;
      cells += `<i class="${cls}" title="${esc(locName(l.id))} · ${dlabIso(date)}: ${m ? `${m} SKU${m > 1 ? 's' : ''} with no sales record (filled as Estimate)` : o ? `${o} SKU${o > 1 ? 's' : ''} out of stock (demand understated, corrected)` : 'all SKUs clean'}"></i>`;
    }
    return `<span class="dh-hl">${esc(l.name)}</span><div class="dh-cells" style="--n:${n}">${cells}</div>`;
  }).join('');
  const d0 = S.fc[0] ? S.fc[0].chart.history : [];
  const at = i => d0[i] ? dlabIso(d0[i].date) : '';
  return `<div class="card rv" style="--d:.08s;margin-top:14px"><div class="card-h"><div><h3>Sales history coverage · last ${n} days</h3><div class="hint">Hover a day for details.</div></div>
      <div class="row">${miss ? `<span class="tag warn">${miss} location-days missing</span>` : ''}${runs ? `<span class="tag warn">${runs} stockout run${runs > 1 ? 's' : ''}</span>` : ''}${!miss && !runs ? '<span class="tag ok">All days clean</span>' : ''}</div></div>
    <div class="dh-hm">${rows}<span></span><div class="dh-scale"><span style="left:0;transform:none">${at(0)}</span><span style="left:33.3%">${at(Math.round(n / 3))}</span><span style="left:66.7%">${at(Math.round(2 * n / 3))}</span><span style="right:0;transform:none">${at(n - 1)}</span></div></div>
    <div class="legend" style="margin-top:10px"><span><i style="background:var(--ok);opacity:.5"></i>Clean day</span><span><i style="background:var(--warn)"></i>Stockout (demand understated, corrected)</span><span><i class="dh-mk"></i>Missing record (filled as Estimate)</span></div>
  </div>`;
}
function dhIssue(i){
  const sev = i.severity === 'error' ? 'bad' : i.severity === 'warning' ? 'warn' : '';
  let body;
  if (i.check === 'cycle_count_mismatch'){
    const diff = i.counted_units - i.recorded_available;
    const hrs = (new Date(i.count_date) - new Date(i.record_as_of)) / 36e5;
    body = `<b>${esc(i.sku)} · ${esc(locName(i.location))}</b>
      <div class="dh-cmp"><span>Record <b>${fmt(i.recorded_available)}</b></span>${IC.right}<span>Counted <b class="${diff ? 'down' : ''}">${fmt(i.counted_units)}</b></span><span class="muted">${diff > 0 ? '+' : ''}${fmt(diff)} units · counted ${tlab(i.count_date).slice(11)}, record ${tlab(i.record_as_of).slice(11)}${hrs > 0 ? ` (${r1(hrs)} h later)` : ''}</span></div>
      <span class="muted" style="font-size:12px">Held until you correct it. The plan uses the record value.</span>`;
  } else if (i.check === 'missing_days' && i.dates && i.dates.length){
    body = `<b>${esc(locName(i.location))} · ${i.dates.length} days without sales rows</b><span class="muted" style="font-size:12px">${dlabIso(i.dates[0])} to ${dlabIso(i.dates[i.dates.length - 1])}, all SKUs. Filled with the in-stock rate and labelled Estimate; shown as dashed cells in the coverage strip.</span>`;
  } else {
    body = `<b>${esc(i.check.replace(/_/g, ' '))}</b><span class="mono muted" style="font-size:10.5px">${esc(i.record_id || i.table || i.location || '')}</span><span>${esc(i.message)}</span>`;
  }
  const fix = i.suggested_correction ? `<div><button class="btn xs acc" onclick="correctModal({table:'inventory',sku:${jsq(i.sku)},loc:${jsq(i.location)},field:'available',suggest:${+i.suggested_correction.new_value},evidence:${jsq(i.evidence_record_id)},reason:'Cycle count at ${esc(String(i.count_date).slice(11,16))} found ${+i.counted_units}'})">${IC.edit} Correct citing the cycle count</button></div>` : '';
  return `<div class="dh-issue ${sev}"><i></i><div>${body}${fix}</div></div>`;
}
function dhParams(){
  const R = lazy('params', 'v', () => api('/settings/parameters'));
  const head = `<div class="card-h"><div><h3>Planning parameters</h3><div class="hint">Rules the plan follows. Click a value to change it.</div></div>${evTag('Assumption')}</div>`;
  if (!R) return `<div class="card rv" style="--d:.14s;margin-top:14px">${head}<div class="empty">Loading parameters…</div></div>`;
  if (R.error) return `<div class="card rv" style="--d:.14s;margin-top:14px">${head}<div class="warnbox">${esc(R.error)}</div></div>`;
  const val = Object.fromEntries(R.parameters.map(p => [p.name, p.value]));
  const changed = n => S.corrections.some(c => c.record_id === 'planning_parameters:' + n);
  const desc = n => (PARAMS.find(p => p[0] === n) || [])[1] || n;
  const marks = DH_RULER.filter(([n]) => typeof val[n] === 'number').map(([n, l]) => [n, l, val[n]]).sort((a, b) => a[2] - b[2]);
  const mx = Math.max(90, ...marks.map(m => m[2]));
  const X = v => +(v / mx * 100).toFixed(2);
  const color = n => n === 'horizon_days' ? 'var(--sig)' : n === 'ageing_days' ? 'var(--warn)' : n === 'aged_days' ? 'var(--bad)' : 'var(--ink2)';
  const ruler = marks.map(([n, l, v], k) => { const x = X(v), anchor = x < 6 ? 'start' : x > 94 ? 'end' : 'mid';
    return `<button class="dh-mark ${k % 2 ? 'up' : ''} ${anchor}" style="left:${x}%;--c:${color(n)}" onclick="paramModal('${n}')" title="${esc(n)}: ${esc(desc(n))} · select to change"><i></i><span><b>${fmt(v)} d${changed(n) ? '*' : ''}</b>${esc(l)}</span></button>`; }).join('');
  const zones = ['horizon_days', 'ageing_days', 'aged_days'].every(n => typeof val[n] === 'number')
    ? `<span class="dh-zone" style="left:0;width:${X(val.horizon_days)}%;background:var(--sig-soft)"></span><span class="dh-zone" style="left:${X(val.ageing_days)}%;width:${X(val.aged_days - val.ageing_days)}%;background:var(--warn-soft)"></span><span class="dh-zone" style="left:${X(val.aged_days)}%;width:${(100 - X(val.aged_days)).toFixed(2)}%;background:var(--bad-soft)"></span>` : '';
  const chips = DH_CHIPS.filter(([n]) => n in val).map(([n, l, f]) => `<button class="dh-chip" onclick="paramModal('${n}')" title="${esc(n)}: ${esc(desc(n))}">${esc(l)} <b>${esc(f(val[n]))}${changed(n) ? '*' : ''}</b></button>`).join('');
  return `<div class="card rv" style="--d:.14s;margin-top:14px">${head}
    <span class="lbl">Day-based rules on one scale</span>
    <div class="tscroll"><div class="dh-ruler" aria-label="Day thresholds from 0 to ${mx} days">${zones}<span class="dh-ax"></span>${ruler}</div></div>
    <div class="legend" style="margin:4px 0 12px"><span><i style="background:var(--sig-soft)"></i>Forecast horizon</span><span><i style="background:var(--warn-soft)"></i>Ageing tier</span><span><i style="background:var(--bad-soft)"></i>Aged</span>${S.corrections.some(c => String(c.record_id).startsWith('planning_parameters:')) ? '<span>* changed from the seed value</span>' : ''}</div>
    <span class="lbl">Other values</span><div class="row" style="margin-top:6px;gap:6px">${chips}</div></div>`;
}
function viewData(){
  const issues = S.validation.issues || [];
  const loaded = new Set(S.events.events.filter(e => e.status === 'Loaded').map(e => e.file_name));
  const nErr = issues.filter(i => i.severity === 'error').length, nWarn = issues.filter(i => i.severity === 'warning').length;
  return secHead('data') + dhTiles() + dhCoverage() + `
  <div class="grid">
    <div class="card span-7 rv" style="--d:.1s"><div class="card-h"><div><h3>Needs your attention</h3></div><div class="row">${nErr ? `<span class="tag bad">${nErr} error${nErr > 1 ? 's' : ''}</span>` : ''}${nWarn ? `<span class="tag warn">${nWarn} warning${nWarn > 1 ? 's' : ''}</span>` : ''}${!issues.length ? '<span class="tag ok">No issues</span>' : ''}</div></div>
      <div class="stack" style="gap:8px">${issues.slice().sort((a, b) => ['error', 'warning'].indexOf(a.severity) - ['error', 'warning'].indexOf(b.severity) || 0).map(dhIssue).join('') || '<div class="empty">No issues. Every table passed its checks.</div>'}</div>
    </div>
    <div class="card span-5 rv" id="inboxCard" style="--d:.12s"><div class="card-h"><div><h3>Inbox and activity</h3><div class="hint">Drop a file and the plan updates on its own.</div></div><span class="tag ${S.mode.watcher ? 'ok' : ''}"><i class="sq"></i>${S.mode.watcher ? 'Listening' : 'Folder watch off'}</span></div>
      <label class="upl" id="dropZ" style="display:block;cursor:pointer" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="event.preventDefault();this.classList.remove('drag');readInboxFile(event.dataTransfer.files[0])">${IC.inbox.replace('<svg','<svg class="i" style="margin:0 auto 6px;width:22px;height:22px"')}Drop a CSV into the inbox, or <u>choose a file</u><br><span class="note">The header (or a name like inventory_dxb.csv) tells the watcher which table it is for</span><input type="file" accept=".csv,text/csv" hidden onchange="readInboxFile(this.files[0]);this.value=''"></label>
      <div class="watch-steps" id="watchSteps"></div>
      <span class="lbl" style="display:block;margin:14px 0 4px">Activity</span>${activityFeed(6)}
      <details class="receipt" style="margin-top:12px"><summary><span>Files waiting in the inbox folder · ${INBOX_SAMPLES.length}</span>${IC.down.replace('<svg','<svg class="i"')}</summary><div class="rbody">
        ${INBOX_SAMPLES.map(sm => `<div class="rej"><div><b class="mono" style="font-size:11.5px">${esc(sm.name)}</b><div class="muted" style="font-size:12px">${esc(sm.note)} · ${sm.rows} rows → ${sm.table}</div></div><div class="r"><button class="btn xs ${loaded.has(sm.name) ? '' : 'solid'}" onclick="dropSample('${sm.id}')">${loaded.has(sm.name) ? 'Drop again' : 'Drop into inbox'}</button></div></div>`).join('')}
        </div></details>
    </div>
  </div>
  ${dhParams()}
  <div class="card rv" style="--d:.18s;margin-top:14px"><div class="card-h"><div><h3>Corrections log</h3><div class="hint">Every fix, with the original value kept.</div></div></div>
    ${S.corrections.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Time</th><th>Record</th><th>Field</th><th class="r">Old</th><th class="r">New</th><th>Evidence</th><th>User</th><th>Reason</th></tr></thead><tbody>${S.corrections.slice().reverse().map(c => `<tr><td class="mono" style="font-size:11px">${tlab(c.timestamp).slice(5)}</td><td>${esc(c.record_id)}</td><td>${esc(c.field)}</td><td class="r">${esc(c.old_value)}</td><td class="r"><b>${esc(c.new_value)}</b></td><td class="mono" style="font-size:11px">${esc(c.evidence_record_id || '—')}</td><td>${esc(c.user)}</td><td>${esc(c.reason)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">No corrections yet.${nErr ? ' Fixing the error under “Needs your attention” adds the first entry here, with the old value, new value and evidence.' : ''}</div>`}
  </div>`;
}
RENDER.data = viewData;

/* ================= DEMAND FORECAST ================= */
let FS = {sku:'CHG-01', loc:'Abu Dhabi'}, FCGRAN = 'daily';
function fcChart(f){
  const id = 'fc' + Math.random().toString(36).slice(2, 8), wk = FCGRAN === 'weekly';
  let chart = f.chart;
  if (wk){ chart = lazy('fcw', key(f.sku, f.location), () => api(`/forecast?sku=${encodeURIComponent(f.sku)}&location=${encodeURIComponent(f.location)}&granularity=weekly`).then(r => r.rows[0].chart)); if (!chart) return '<div class="empty">Loading weekly totals…</div>'; if (chart.error) return `<div class="warnbox">${esc(chart.error)}</div>`; }
  const pts = [];
  chart.history.forEach(p => pts.push(wk ? {label:dlabIso(p.week_start), obs:p.observed, cor:p.corrected, kind:p.out_of_stock_days ? 'oos' : p.imputed_days ? 'missing' : 'data'}
    : {label:dlabIso(p.date), obs:p.observed, cor:p.corrected, kind:p.out_of_stock ? 'oos' : p.imputed ? 'missing' : 'data'}));
  chart.forecast.forEach(p => pts.push({label:dlabIso(wk ? p.week_start : p.date), p10:p.p10, p50:p.p50, p90:p.p90, future:true}));
  const w = 760, h = 240, x0 = 36, x1 = w - 12, y0 = 14, y1 = h - 28, n = pts.length, dx = (x1 - x0) / (n - 1);
  const mx = niceMax(Math.max(1, ...pts.map(p => Math.max(p.obs || 0, p.cor || 0, p.p90 || 0))) * 1.06);
  const X = i => x0 + i * dx, Y = v => y1 - v / mx * (y1 - y0);
  const hist = pts.filter(p => !p.future), fut = pts.map((p, i) => ({...p, i})).filter(p => p.future), fi = fut[0].i;
  let s = yTicks(mx).map(v => `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line2)"/><text class="ax" x="${x0 - 6}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('');
  hist.forEach((p, i) => { if (p.kind === 'oos') s += `<rect x="${X(i) - dx/2}" y="${y0}" width="${dx}" height="${y1 - y0}" style="fill:var(--warn-soft)"/>`; if (p.kind === 'missing') s += `<rect x="${X(i) - dx/2}" y="${y0}" width="${dx}" height="${y1 - y0}" style="fill:var(--sig-soft)"/>`; });
  let obsPath = '', pen = false; hist.forEach((p, i) => { if (p.obs === null || p.obs === undefined){ pen = false; return; } obsPath += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.obs).toFixed(1); pen = true; });
  const corPath = hist.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.cor).toFixed(1)).join('');
  const bandUp = fut.map((p, j) => (j ? 'L' : 'M') + X(p.i).toFixed(1) + ',' + Y(p.p90).toFixed(1)).join(''), bandLo = fut.slice().reverse().map(p => 'L' + X(p.i).toFixed(1) + ',' + Y(p.p10).toFixed(1)).join('');
  const midPath = `M${X(fi - 1).toFixed(1)},${Y(hist[hist.length - 1].cor).toFixed(1)}` + fut.map(p => 'L' + X(p.i).toFixed(1) + ',' + Y(p.p50).toFixed(1)).join('');
  s += `<path d="${bandUp + bandLo}Z" style="fill:var(--sig-soft);stroke:none"/>`;
  s += `<path d="${corPath}" style="fill:none;stroke:var(--sig);stroke-width:1.4;stroke-dasharray:3 3"/>`;
  s += `<path d="${obsPath}" style="fill:none;stroke:var(--ink2);stroke-width:1.6"/>`;
  hist.forEach((p, i) => { if (p.kind === 'missing') s += `<circle cx="${X(i)}" cy="${Y(p.cor)}" r="2.6" style="fill:var(--card);stroke:var(--sig);stroke-width:1.4"/>`; });
  s += `<path d="${midPath}" style="fill:none;stroke:var(--sig);stroke-width:2.2"/>`;
  s += `<line x1="${X(fi) - dx/2}" x2="${X(fi) - dx/2}" y1="${y0}" y2="${y1}" style="stroke:var(--ink);stroke-dasharray:2 3"/><text class="ax" x="${X(fi) - dx/2 + 4}" y="${y0 + 8}">Planning day</text>`;
  const ticks = wk ? [0, 4, 8, 12, n - 1] : [0, 30, 60, 90, n - 1];
  ticks.forEach(i => { if (pts[i]) s += `<text class="ax" x="${X(i)}" y="${h - 9}" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${pts[i].label}</text>`; });
  const svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Sales history and forecast for ${esc(f.sku)} in ${esc(f.location)}">${s}<line class="cross" x1="0" x2="0" y1="${y0}" y2="${y1}" style="stroke:var(--faint);opacity:0"/><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" style="fill:transparent"/></svg>`;
  const unit = wk ? 'week' : 'day';
  CH[id] = {w, h, x0, dx, n, ty: i => Y(Math.max(pts[i].cor || 0, pts[i].obs || 0, pts[i].p90 || 0)), tip: i => { const p = pts[i]; if (!p.future) return `<b>${wk ? 'Week of ' : ''}${p.label}</b><br>${p.kind === 'data' ? `Sold ${fmt(p.obs)}` : p.kind === 'oos' ? `Out of stock · recorded ${fmt(p.obs)} · corrected ${r1(p.cor)} <span style="opacity:.7">Estimate</span>` : `Missing record · imputed ${r1(p.cor)} <span style="opacity:.7">Estimate</span>`}`; return `<b>${wk ? 'Week of ' : ''}${p.label}</b> · forecast per ${unit}<br>P50 ${r1(p.p50)} · P10 to P90 ${r1(p.p10)} to ${r1(p.p90)}`; }};
  return `<div class="chart" data-ch="${id}">${svg}<div class="tip"></div></div>
    <div class="legend" style="margin-top:6px"><span><i style="background:var(--ink2);height:2px"></i>Observed sales</span><span><i style="background:var(--sig);height:2px;opacity:.7"></i>Corrected (dashed)</span><span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>Out-of-stock days</span><span><i style="background:var(--sig-soft);border:1px solid var(--sig)"></i>Missing days, imputed</span><span><i style="background:var(--sig);height:3px"></i>P50 forecast</span><span><i style="background:var(--sig-soft)"></i>P10 to P90</span></div>`;
}
// Demand against stock on hand: one shared scale per SKU, so locations compare directly
function fcCover(cells){
  const rows = cells.map(x => {
    const g = x.fc, st = x.stock, end = isoD(S.planDay); end.setDate(end.getDate() + H);
    const inc = st.incoming.filter(p => p.counted_in_plan && isoD(p.eta_with_signals) <= end);
    const free = st.free.value, incoming = sum(inc.map(p => p.qty)), have = free + incoming;
    return {x, g, free, incoming, have, inc, gap:have - g.p50};
  });
  const mx = niceMax(Math.max(1, ...rows.map(r => Math.max(r.g.p90, r.have))) * 1.04);
  const P = v => (v / mx * 100).toFixed(2) + '%';
  const ticks = yTicks(mx);
  const row = r => {
    const g = r.g, so = g.stockout_correction, dashed = g.confidence !== 'High';
    const verdict = r.gap < 0 ? `<span class="tag bad">Short ~${fmt(-r.gap)}</span>`
      : r.have < g.p90 ? `<span class="tag warn">Covered · tight if busy</span>` : `<span class="tag ok">Covered · ${fmt(r.gap)} spare</span>`;
    const why = [`${g.confidence} confidence${g.confidence_detail.share_pct ? ` · ${r1(g.confidence_detail.share_pct)}% of the last ${g.confidence_detail.window_days} days patched` : ''}`,
      so.out_of_stock_days.length ? `<span class="warnc">stockout-corrected: observed ${fmt(so.observed_total)}, corrected ${fmt(so.corrected_total)} over 90 days</span>` : '',
      g.imputed.days.length ? `<span style="color:var(--sig)">${g.imputed.days.length} missing days imputed</span>` : '',
      g.signal_effect ? `<span class="warnc">with ${esc(g.signal_effect.signals.join(', '))}: ${fmt(g.signal_effect.with.P50)}; without: ${fmt(g.signal_effect.without.P50)}</span>` : ''].filter(Boolean).join(' · ');
    return `<button class="fcov-r ${FS.loc === r.x.loc ? 'on' : ''}" onclick="FS.loc=${jsq(r.x.loc)};render('forecast',true)" title="Show ${esc(locName(r.x.loc))} in the chart below">
      <span class="fcov-l"><b>${esc(locName(r.x.loc))}</b><small class="num-t">sells ~${fmt(g.p50)}</small></span>
      <span class="fcov-bar" role="img" aria-label="${esc(locName(r.x.loc))}: free stock ${fmt(r.free)}, incoming ${fmt(r.incoming)}, demand ${fmt(g.p10)} to ${fmt(g.p90)}, most likely ${fmt(g.p50)}">
        <i class="st" style="width:${P(r.free)}"></i>${r.incoming ? `<i class="inc" style="left:${P(r.free)};width:${P(r.incoming)}"></i>` : ''}
        <i class="need ${dashed ? 'dash' : ''}" style="left:${P(g.p10)};width:${P(g.p90 - g.p10)}"></i><i class="p50" style="left:${P(g.p50)}"></i></span>
      <span class="fcov-v">${verdict}</span>
      <span class="fcov-n">Have ${fmt(r.have)} (${fmt(r.free)} free${r.incoming ? ` + ${fmt(r.incoming)} arriving` : ''}) · likely sales ${fmt(g.p10)} to ${fmt(g.p90)} · ${why}</span></button>`;
  };
  return `<div class="fcov">${rows.map(row).join('')}
    <div class="fcov-ax"><span></span><span class="fcov-t">${ticks.map(v => `<i style="left:${P(v)}">${fmt(v)}</i>`).join('')}</span><span></span></div></div>
    <div class="legend" style="margin-top:10px"><span><i style="background:var(--ink2);opacity:.18"></i>Free stock now</span><span><i class="fcov-hatch"></i>Arriving within 30 days</span><span><i style="background:var(--sig-soft);border:1px solid var(--sig)"></i>Likely sales (P10 to P90)</span><span><i style="background:var(--sig)"></i>Most likely (P50)</span><span><i style="border:1px dashed var(--sig)"></i>Dashed = Medium or Low confidence</span></div>
    <div class="note" style="margin-top:6px">Short and spare ignore safety stock. Select a location to chart it. ${evTag('Estimate', 'forecast · pooled backtest band')}</div>`;
}
function viewForecast(){
  if (!CELL[key(FS.sku, FS.loc)]) FS = {sku:SKUS()[0], loc:'Dubai'};
  const cells = LOCS.map(l => CELL[key(FS.sku, l.id)]).filter(Boolean), c = CELL[key(FS.sku, FS.loc)], f = c.fc;
  const spark = sku => { const v = []; const ser = LOCS.map(l => (CELL[key(sku, l.id)] || {}).fc).filter(Boolean).map(x => x.chart.history); for (let d = 0; d < 90; d += 3){ let t = 0; ser.forEach(h => { for (let k = 0; k < 3 && d + k < h.length; k++) t += h[d + k].corrected; }); v.push(t); } const mx = Math.max(...v) || 1, w = 64, hh = 20; return `<svg viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}"><path d="${v.map((x, i) => (i ? 'L' : 'M') + (i * w / (v.length - 1)).toFixed(1) + ',' + (hh - 2 - x / mx * (hh - 4)).toFixed(1)).join('')}" style="fill:none;stroke:var(--ink2);stroke-width:1.3"/></svg>`; };
  const minConf = cs => cs.some(x => x.fc.confidence === 'Low') ? 'Low' : cs.some(x => x.fc.confidence === 'Medium') ? 'Medium' : 'High';
  const confTag = cf => `<span class="tag ${cf === 'High' ? 'ok' : cf === 'Medium' ? 'warn' : 'bad'}">${cf} confidence</span>`;
  return secHead('forecast') + `
  <div class="grid">
    <div class="card span-3 rv" style="--d:.05s;padding:0;overflow:hidden"><div style="padding:14px 14px 8px"><span class="lbl">${SKUS().length} SKUs · corrected history</span></div><div class="flist">
      ${SKUS().map(sku => { const cs = LOCS.map(l => CELL[key(sku, l.id)]).filter(Boolean); const corr = cs.some(y => y.fc.stockout_correction.out_of_stock_days.length); const sig = cs.some(y => y.fc.signal_effect); const pick = (cs.find(y => y.fc.stockout_correction.out_of_stock_days.length || y.fc.signal_effect) || cs.find(y => y.plan && y.plan.status === 'Short') || cs[0]).loc; return `<button class="${sku === FS.sku ? 'on' : ''}" onclick="FS.sku=${jsq(sku)};FS.loc=${jsq(pick)};render('forecast',true)"><b class="mono">${esc(sku)}</b>${spark(sku)}<small>${esc(SKU_NAME(sku))}${corr ? ' · stockout-corrected' : ''}${sig ? ' · demand signal' : ''}</small><small style="grid-column:2;text-align:right">${fmt(sum(cs.map(y => y.fc.p50)))}</small></button>`; }).join('')}
    </div></div>
    <div class="stack span-9">
      <div class="card rv" style="--d:.08s"><div class="card-h"><div><h3>${esc(SKU_NAME(FS.sku))} <span class="mono muted" style="font-size:12px">${esc(FS.sku)}</span></h3><div class="hint">${esc(catOf(FS.sku))} · next 30 days (${pdlab(1)} to ${pdlab(H)})</div></div>${confTag(minConf(cells))}</div>
        ${fcCover(cells)}
            </div>
      <div class="card rv" style="--d:.12s"><div class="card-h"><div><h3>Sales and forecast · ${esc(locName(FS.loc))}</h3><div class="hint">Past sales, corrected for gaps, then the next 30 days.</div></div><div class="row"><div class="seg">${LOCS.map(l => `<button class="${FS.loc === l.id ? 'on' : ''}" onclick="FS.loc=${jsq(l.id)};render('forecast',true)">${l.name}</button>`).join('')}</div><div class="seg">${['daily','weekly'].map(g => `<button class="${FCGRAN === g ? 'on' : ''}" onclick="FCGRAN='${g}';render('forecast',true)">${g === 'daily' ? 'Daily' : 'Weekly'}</button>`).join('')}</div></div></div>
        ${fcChart(f)}
        ${f.stockout_correction.out_of_stock_days.length ? `<div class="warnbox" style="margin-bottom:0"><b>Stockout correction.</b> Observed ${fmt(f.stockout_correction.observed_total)} over 90 days, corrected ${fmt(f.stockout_correction.corrected_total)}: out of stock on ${f.stockout_correction.out_of_stock_days.length} days (${f.stockout_correction.out_of_stock_dates.map(dlabIso).join(', ')}). Assumes demand on those days resembled in-stock days.</div>` : ''}
        ${f.imputed.days.length ? `<div class="note" style="margin-top:8px">${f.imputed.days.length} missing days (${dlabIso(f.imputed.dates[0])} to ${dlabIso(f.imputed.dates[f.imputed.dates.length - 1])}) imputed with the in-stock rate and tagged Estimate.</div>` : ''}
      </div>
    </div>
  </div>`;
}
RENDER.forecast = viewForecast;
AFTER.forecast = () => bindCharts($('v-forecast'));

/* Inventory Network lives in js/inventory.js */

/* ================= DISRUPTIONS ================= */
// Layout: compact signal rows → when each signal hits (30-day timeline) → what it changes (impact table)
let DSHOW = false;
const sigRisk = im => (im.risk_before_after || []).filter(r => Math.abs(r.without_signal.lost_sales - r.with_signal.lost_sales) > 0.5 || r.without_signal.breach_day !== r.with_signal.breach_day || r.without_signal.days_below_safety !== r.with_signal.days_below_safety);
const sigMatch = s => [(s.components || []).length ? 'component ' + s.components.join(', ') : '', (s.routes || []).length ? 'route ' + s.routes.join(', ') : '', (s.skus || []).length ? s.skus.join(', ') : '', (s.locations || []).length ? s.locations.map(locName).join(', ') : ''].filter(Boolean).join(' · ');
const sigRange = s => s.type === 'supply' ? `${s.delay_min} / <b>${s.delay_likely}</b> / ${s.delay_max} d delay` : `${pct(s.uplift_min)} / <b>${pct(s.uplift_likely)}</b> / ${pct(s.uplift_max)} · ${pdlab(s.start_day)}–${pdlab(s.end_day)}`;
function viewDisruptions(){
  const has001 = S.signals.some(s => s.signal_id === 'SIG-001');
  const IM = Object.fromEntries(S.signals.map(s => [s.signal_id, lazy('impact', s.signal_id + '#' + S.loadedAt, () => api(`/signals/${encodeURIComponent(s.signal_id)}/impact`))]));
  const unver = S.signals.filter(s => s.status === 'Unverified' && s.include !== false).length;
  const kind = s => s.type === 'supply' ? '<span class="tag sup">Supply</span>' : '<span class="tag warn">Demand</span>';
  const reach = s => { const im = IM[s.signal_id]; if (!im || im.error) return ''; const n = new Set(im.skus.filter(x => x.affected).map(x => x.sku)).size, all = new Set(im.skus.map(x => x.sku)).size; return `${n} of ${all} products${s.type === 'supply' ? ` · ${im.pos.filter(p => p.affected).length} orders` : ''}`; };
  const rows = S.signals.map(s => `<div class="ds-sig ${s.include === false ? 'off' : ''}">
      <label class="ds-sw" title="${s.include !== false ? 'Included in the plan' : 'Switched off'}"><input type="checkbox" aria-label="Include ${esc(s.signal_id)}" ${s.include !== false ? 'checked' : ''} onchange="this.checked=!this.checked;editSig(${jsq(s.signal_id)},{include:!this.checked})"><i></i></label>
      ${kind(s)}<b class="mono">${esc(s.signal_id)}</b>
      <span class="ds-what"><span>${esc(s.source)} · ${dlabIso(s.date)}</span><span class="muted">${esc(sigMatch(s))} · <span class="mono">${sigRange(s)}</span>${reach(s) ? ' · ' + reach(s) : ''}</span></span>
      <select class="sel" aria-label="Status of ${esc(s.signal_id)}" onchange="const v=this.value;this.value=${jsq(s.status)};editSig(${jsq(s.signal_id)},{status:v})">${['Unverified','Confirmed'].map(v => `<option ${s.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="btn xs" onclick="sigRangeModal(${jsq(s.signal_id)})">${IC.edit} Range</button></div>`).join('');
  return secHead('disruptions') + `
  <div class="card rv" style="--d:.05s"><div class="card-h"><div><h3>Signals</h3><div class="hint">Each change asks for a reason.</div></div>
      <div class="row">${unver ? `<span class="tag warn">${unver} unverified</span>` : ''}${has001 ? '' : `<button class="btn sm solid" onclick="dropSample('sig001')">${IC.inbox} Drop SIG-001 file into the inbox</button>`}</div></div>
    <div class="ds-sigs">${rows || '<div class="empty">No signals loaded.</div>'}</div>
    
  </div>
  ${dsTimeline(IM)}
  ${dsImpact(IM)}`;
}
// One lane per thing a signal moves: an inbound order, new-order lead time, or a demand window per product-location
function dsTimeline(IM){
  const X = d => (Math.max(0, Math.min(H, d)) / H * 100).toFixed(2) + '%';
  const dayOf = iso => Math.round((isoD(iso) - isoD(S.planDay)) / 864e5);
  const lanes = [];
  S.signals.forEach(s => {
    const im = IM[s.signal_id];
    const head = `<b>${esc(s.signal_id)}</b>`;
    if (s.include === false){ lanes.push([head, `<span class="ds-offl">Switched off: not applied</span>`]); return; }
    if (!im) { lanes.push([head, '<span class="ds-offl">Loading…</span>']); return; }
    if (im.error) { lanes.push([head, `<span class="ds-offl">${esc(im.error)}</span>`]); return; }
    if (s.type === 'supply'){
      const pos = im.pos.filter(p => p.affected);
      pos.forEach(p => { const a = dayOf(p.eta), b = dayOf(p.shifted_eta_likely);
        lanes.push([`${head}<small>${esc(p.po_id)} · ${esc(p.sku)} → ${esc(locName(p.location))}</small>`,
          `<span class="ds-shift" style="left:${X(a)};width:calc(${X(b)} - ${X(a)})"></span><span class="ds-po old" style="left:${X(a)}" title="Original arrival ${dlabIso(p.eta)}"></span><span class="ds-po" style="left:${X(b)}" title="With the delay ${dlabIso(p.shifted_eta_likely)}"></span><span class="ds-lab" style="left:${X(b)}">${dlabIso(p.eta)} → <b>${dlabIso(p.shifted_eta_likely)}</b>${b > H ? ' (after the window)' : ''}</span>`]); });
      const lead = new Set(im.skus.filter(x => x.affected && !/PO-/.test(x.reason || '')).map(x => x.sku));
      if (lead.size) lanes.push([`${head}<small>new orders · ${lead.size} products</small>`, `<span class="ds-lead"><b>+${s.delay_likely} d</b> lead time on new orders for ${esc([...lead].join(', '))}</span>`]);
      if (!pos.length && !lead.size) lanes.push([head, '<span class="ds-offl">No open order or product matches</span>']);
    } else {
      const risk = sigRisk(im);
      im.skus.filter(x => x.affected).forEach(x => {
        const r = risk.find(y => y.sku === x.sku && y.location === x.location);
        const a = r && r.without_signal.breach_day, b = r && r.with_signal.breach_day;
        lanes.push([`${head}<small>${esc(x.sku)} · ${esc(locName(x.location))}</small>`,
          `<span class="ds-band" style="left:${X(s.start_day - 1)};width:calc(${X(s.end_day)} - ${X(s.start_day - 1)})"><b>${pct(s.uplift_likely)}</b></span>${a != null && a !== b ? `<span class="ds-brk old" style="left:${X(a)}" title="Below safety stock without the signal: ${pdlab(a)}"></span>` : ''}${b != null ? `<span class="ds-brk" style="left:${X(b)}" title="Below safety stock with the signal: ${pdlab(b)}"></span><span class="ds-lab bad" style="left:${X(b)}">below safety ${pdlab(b)}${a != null && a !== b ? ` (was ${pdlab(a)})` : ''}</span>` : ''}`]); });
    }
  });
  const ticks = [0, 5, 10, 15, 20, 25, H];
  return `<div class="card rv" style="--d:.1s;margin-top:14px"><div class="card-h"><div><h3>When they hit · next ${H} days</h3></div></div>
    <div class="ds-tl">
      <span></span><div class="ds-ax">${ticks.map(t => `<span style="left:${X(t)}" class="${t === 0 ? 'first' : t === H ? 'last' : ''}">${t === 0 ? 'Today' : pdlab(t)}</span>`).join('')}</div>
      ${lanes.map(([l, c]) => `<span class="ds-ll">${l}</span><div class="ds-lane">${c}</div>`).join('') || '<span></span><div class="empty">No signals.</div>'}
    </div>
    <div class="legend" style="margin-top:10px"><span><i style="background:var(--card);border:2px solid var(--faint);border-radius:50%"></i>Original arrival</span><span><i style="background:var(--sup);border-radius:50%"></i>Arrival with the likely delay</span><span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>Extra-demand window</span><span><i style="background:var(--bad);width:3px"></i>Falls below safety stock (grey = without the signal)</span></div>
  </div>`;
}
// With vs without each signal, Do nothing at P50, sorted by the extra lost sales
function dsImpact(IM){
  const rows = [], quiet = [], unaffected = [];
  S.signals.forEach(s => {
    const im = IM[s.signal_id]; if (!im || im.error || s.include === false) return;
    const risk = sigRisk(im);
    risk.forEach(r => rows.push({s, r, d: r.with_signal.lost_sales - r.without_signal.lost_sales}));
    if (s.type === 'supply'){ const pos = im.pos.filter(p => p.affected); if (pos.length && !risk.length) quiet.push({s, pos}); }
    const hit = new Set(im.skus.filter(x => x.affected).map(x => x.sku));
    const why = {}; im.skus.filter(x => !x.affected && !hit.has(x.sku)).forEach(x => { why[x.sku] = why[x.sku] || x.reason; });
    unaffected.push({s, why});
  });
  rows.sort((a, b) => b.d - a.d);
  const dlt = (a, b, unit, earlier) => { const d = b - a; if (Math.abs(d) < 0.5) return '<span class="muted">no change</span>'; return `<span class="ds-d ${(earlier ? d < 0 : d > 0) ? 'bad' : 'ok'}">${earlier ? `${Math.abs(d)} d ${d < 0 ? 'earlier' : 'later'}` : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}${unit}`}</span>`; };
  const mx = Math.max(1, ...rows.map(x => x.r.with_signal.lost_sales), ...rows.map(x => x.r.without_signal.lost_sales));
  const fcLine = (s, r) => { const c = CELL[key(r.sku, r.location)], e = c && c.fc.signal_effect; return s.type === 'demand' && e ? `<div class="muted" style="font-size:11.5px">Forecast P50 ${fmt(e.without.P50)} → <b style="color:var(--ink)">${fmt(e.with.P50)}</b></div>` : ''; };
  const body = rows.map(({s, r}) => { const a = r.without_signal, b = r.with_signal; return `<tr>
      <td><b>${esc(r.sku)}</b> · ${esc(locName(r.location))}<div class="row" style="gap:6px;margin-top:3px"><span class="tag ${s.type === 'supply' ? 'sup' : 'warn'}">${esc(s.signal_id)}</span>${s.status === 'Unverified' ? evTag('Assumption') : ''}</div>${fcLine(s, r)}</td>
      <td><div class="ds-ba"><s>${fmt(a.lost_sales)}</s>→<b class="${b.lost_sales > a.lost_sales + 0.5 ? 'down' : ''}">${fmt(b.lost_sales)}</b>${dlt(a.lost_sales, b.lost_sales, '')}</div><div class="ds-mini"><i style="width:${b.lost_sales / mx * 100}%;background:var(--bad-soft)"></i><i style="width:${a.lost_sales / mx * 100}%;background:var(--faint)"></i></div></td>
      <td><div class="ds-ba"><s>${a.days_below_safety}</s>→<b>${b.days_below_safety}</b>${dlt(a.days_below_safety, b.days_below_safety, '')}</div></td>
      <td><div class="ds-ba"><s>${a.breach_day != null ? pdlab(a.breach_day) : 'none'}</s>→<b>${b.breach_day != null ? pdlab(b.breach_day) : 'none'}</b>${a.breach_day != null && b.breach_day != null ? dlt(a.breach_day, b.breach_day, '', true) : ''}</div></td></tr>`; }).join('')
    + quiet.map(({s, pos}) => `<tr><td>${pos.map(p => `<b>${esc(p.sku)}</b> · ${esc(locName(p.location))}`).join('<br>')}<div style="margin-top:3px"><span class="tag sup">${esc(s.signal_id)}</span></div></td><td colspan="3" class="muted">${pos.map(p => `${esc(p.po_id)} arrives ${dlabIso(p.shifted_eta_likely)} instead of ${dlabIso(p.eta)}`).join(' · ')}. No change to lost sales or safety-stock breaches within ${H} days.</td></tr>`).join('');
  return `<div class="card rv" style="--d:.14s;margin-top:14px"><div class="card-h"><div><h3>What each signal changes</h3><div class="hint">Worst first.</div></div></div>
    ${body ? `<div class="tscroll"><table class="t ds-t"><thead><tr><th>Product · location</th><th>Lost sales, units</th><th>Days below safety</th><th>Falls below safety</th></tr></thead><tbody>${body}</tbody></table></div>` : '<div class="empty">No included signal changes risk within 30 days.</div>'}
    ${unaffected.length ? `<details class="receipt" style="margin-top:12px" ${DSHOW ? 'open' : ''} ontoggle="DSHOW=this.open"><summary><span>Products a signal does not touch, and why</span>${IC.down.replace('<svg', '<svg class="i"')}</summary><div class="rbody">${unaffected.map(({s, why}) => `<div class="ln" style="display:block"><b>${esc(s.signal_id)}</b> · ${Object.keys(why).length} products untouched${Object.entries(Object.entries(why).reduce((g, [k, w]) => { const r = String(w).replace(/^[A-Z]{3}-\d+ is /, ''); (g[r] = g[r] || []).push(k); return g; }, {})).map(([r, ks]) => `<div class="muted" style="font-size:11.5px;margin-top:2px">${esc(r.charAt(0).toUpperCase() + r.slice(1))}: ${esc(ks.join(', '))}</div>`).join('')}</div>`).join('')}</div></details>` : ''}
  </div>`;
}
RENDER.disruptions = viewDisruptions;
function editSig(id, patch){
  const desc = Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(', ');
  reasonModal(`Change ${esc(id)}`, `${esc(desc)}. A signal edit is a global change: it re-runs the plan and can turn approved decisions Stale.`, why =>
    mutate(`Applying ${id} change and re-planning…`, () => api(`/signals/${encodeURIComponent(id)}`, {method:'PATCH', body:{...patch, reason:why}})), 'Save and re-plan');
}
function sigRangeModal(id){
  const s = S.signals.find(x => x.signal_id === id), sup = s.type === 'supply';
  const f = (k, label, v) => `<div class="field"><label for="sr-${k}">${label}</label><input id="sr-${k}" type="number" step="any" value="${v ?? ''}"></div>`;
  openModal(`<h3>Edit ${esc(id)} range</h3><div class="hint">${esc(s.source)} · ${esc(s.status)}. A range change is a global change and re-runs the plan.</div>
    <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:14px">${sup ? f('delay_min','Delay min (days)', s.delay_min) + f('delay_likely','Likely', s.delay_likely) + f('delay_max','Max', s.delay_max) : f('uplift_min','Uplift min (%)', s.uplift_min * 100) + f('uplift_likely','Likely (%)', s.uplift_likely * 100) + f('uplift_max','Max (%)', s.uplift_max * 100)}</div>
    <div class="field"><label for="sr-reason">Reason</label><input id="sr-reason" placeholder="e.g. Forwarder updated the delay estimate"></div>
    <div class="row"><button class="btn sm acc" onclick="saveSigRange(${jsq(id)})">Save and re-plan</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
}
function saveSigRange(id){
  const sup = S.signals.find(x => x.signal_id === id).type === 'supply';
  const ks = sup ? ['delay_min','delay_likely','delay_max'] : ['uplift_min','uplift_likely','uplift_max'];
  const patch = {}; ks.forEach(k => { const v = $('sr-' + k).value; if (v !== '') patch[k] = sup ? +v : +v / 100; });
  const why = $('sr-reason').value.trim();
  if (!why){ $('sr-reason').style.borderColor = 'var(--bad)'; return; }
  if (!(patch[ks[0]] <= patch[ks[1]] && patch[ks[1]] <= patch[ks[2]])){ toast('Min must be ≤ likely ≤ max'); return; }
  closeModal();
  mutate(`Applying ${id} range and re-planning…`, () => api(`/signals/${encodeURIComponent(id)}`, {method:'PATCH', body:{...patch, reason:why}}));
}
