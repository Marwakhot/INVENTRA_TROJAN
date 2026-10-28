/* =====================================================================
   INVENTRA FRONTEND · Inventory (planner view): ranked list, product tabs,
   draft PO with the quantity guardrail, Ageing tab.
   Every number comes from /network/* and /drafts/po. The browser only lays it out.
   ===================================================================== */

let INV = {active:'inventory', loc:'All', status:'All', q:'', open:[], prod:{}, po:{}, ageLoc:'All', ageSort:'oldest'};
let AGE_TAGS = [];
try { AGE_TAGS = JSON.parse(localStorage.getItem('inventra-seasonal') || '[]'); } catch (e) {}

const fullD = s => s ? `${dlabIso(s)} ${String(s).slice(0, 4)}` : '—';
const invPill = (t, cls) => `<span class="dl-pill ${cls || ''}">${esc(t)}</span>`;
const lbl3 = t => evTag(t === 'Calculated' ? 'Estimate' : t).replace('>Estimate<', '>Calculated<');   // Data / Calculated / Assumption
const ST_PILL = {Critical:'bad', Watch:'warn', Healthy:'ok'};
const invRefresh = () => render('network', true);

/* ---------------- tabs ---------------- */
function invGo(id){ INV.active = id; invRefresh(); window.scrollTo({top:0}); }
function openProduct(sku, loc){
  const id = 'p:' + sku;
  if (!INV.open.find(t => t.id === id)) INV.open.push({id, kind:'product', sku});
  if (!INV.prod[sku]) INV.prod[sku] = {loc: loc || 'All', days:30};
  else if (loc) INV.prod[sku].loc = loc;
  INV.active = id; go('network');
}
function openPO(sku, loc){
  const id = 'po:' + sku + '|' + loc;
  if (!INV.open.find(t => t.id === id)) INV.open.push({id, kind:'po', sku, loc});
  if (INV.po[id] && INV.po[id].done) delete INV.po[id];
  INV.active = id; go('network');
  if (!INV.po[id]) poLoad(id, null);
}
function invClose(id, ev){
  if (ev) ev.stopPropagation();
  INV.open = INV.open.filter(t => t.id !== id); delete INV.po[id];
  if (INV.active === id) INV.active = 'inventory';
  invRefresh();
}

function viewNetwork(){
  const L = lazy('inv', 'list', () => api('/network/inventory'));
  const A = lazy('agel', AGE_TAGS.join(','), () => api('/network/ageing-list?seasonal=' + encodeURIComponent(AGE_TAGS.join(','))));
  if (!INV.open.find(t => t.id === INV.active) && !['inventory', 'ageing', 'pos'].includes(INV.active)) INV.active = 'inventory';
  const reorders = S.decisions.filter(d => d.chosen && d.chosen.type === 'reorder');
  const top = (id, label, sub, fn) => `<button class="dl-sub ${INV.active === id ? 'on' : ''}" onclick="${fn || `invGo('${id}')`}"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
  const opened = INV.open.map(t => {
    const name = t.kind === 'product' ? SKU_NAME(t.sku) : `Draft PO · ${t.sku}`;
    const sub = t.kind === 'product' ? t.sku : (INV.po[t.id] && INV.po[t.id].done ? `logged ${INV.po[t.id].done}` : `${locName(t.loc)} · not sent`);
    return `<button class="dl-sub inv-otab ${INV.active === t.id ? 'on' : ''}" style="--tc:${t.kind === 'po' ? 'var(--lab-b)' : 'var(--sig)'}" onclick="invGo(${jsq(t.id)})"><b>${esc(name)} <span class="inv-x" role="button" aria-label="Close ${esc(name)}" onclick="invClose(${jsq(t.id)},event)">×</span></b><small>${esc(sub)}</small></button>`;
  }).join('');
  let body;
  const t = INV.open.find(x => x.id === INV.active);
  if (INV.active === 'ageing') body = A ? (A.error ? `<div class="warnbox" style="margin:16px 18px">${esc(A.error)}</div>` : ageingHTML(A, L)) : '<div class="empty" style="padding:24px">Loading the ageing list…</div>';
  else if (INV.active === 'pos') body = posHTML(reorders);
  else if (t && t.kind === 'product') body = productHTML(t.sku, L, A);
  else if (t && t.kind === 'po') body = poHTML(t, L, A);
  else body = L ? (L.error ? `<div class="warnbox" style="margin:16px 18px">${esc(L.error)}</div>` : listHTML(L, A)) : '<div class="empty" style="padding:24px">Loading inventory…</div>';
  const title = t ? (t.kind === 'product' ? esc(SKU_NAME(t.sku)) : `Draft purchase order · ${esc(SKU_NAME(t.sku))}`) : INV.active === 'ageing' ? 'Ageing' : INV.active === 'pos' ? 'Purchase orders' : 'Inventory';
  return secHead('network') + `
  <div class="lab-frame rv" style="--d:.05s"><div class="lab-frame-h"><div><span class="lbl">GulfTrade Supplies · Planner view · ${esc(plannerName())}</span><h2 class="lab-title" style="margin-top:4px">${title}</h2></div><span class="note">Synthetic demo data · data as of ${fullD(S.planDay)}</span></div>
    <div class="dl-subs">${top('inventory', 'Inventory', L && !L.error ? `${L.rows.length} products` : '')}${top('ageing', 'Ageing', A && !A.error ? `${A.rows.length} to review` : '')}${top('pos', 'Purchase orders', `${reorders.length} logged`)}${top('dlog', 'Decision Log', 'opens Decisions', "DLV.view='log';go('decisions')")}${top('track', 'Track record', 'opens Decisions', "DLV.view='track';go('decisions')")}${opened ? '<span class="inv-sep"></span>' + opened : ''}</div>
    ${body}</div>`;
}
RENDER.network = viewNetwork;
AFTER.network = () => bindCharts($('v-network'));

/* ---------------- Screen 1: Inventory list ---------------- */
const rowView = (r, loc) => loc === 'All' ? r.all : r.locations[loc];
const ageingFlag = v => v.aged_units > 0 || v.ageing_units > 0;
function listHTML(L, A){
  const locs = ['All', ...L.locations];
  const stocked = loc => loc === 'All' ? L.rows : L.rows.filter(r => r.locations[loc]);
  const base = stocked(INV.loc);
  const v = r => rowView(r, INV.loc);
  const match = r => {
    const x = v(r), s = INV.status;
    if (s === 'Excess or ageing' && !(x.excess || ageingFlag(x))) return false;
    if (s === 'Data issue' && !x.data_issue) return false;
    if (['Critical', 'Watch', 'Healthy'].includes(s) && x.status !== s) return false;
    return !INV.q || (r.sku + ' ' + r.name + ' ' + r.category).toLowerCase().includes(INV.q.toLowerCase());
  };
  const rows = base.filter(match).sort((a, b) => v(b).lost_sales_aed_30d - v(a).lost_sales_aed_30d
    || (v(a).order_by_day ?? 999) - (v(b).order_by_day ?? 999));
  const n = f => base.filter(r => f(v(r))).length;
  const blocked = blockedCells(A);
  const card = (k, val, color, tag, sub) => `<div class="lab-card"><span class="lbl">${k}</span><div class="lab-big" style="${color ? 'color:' + color : ''}">${fmt(val)}</div><div class="note" style="font-size:11.5px">${sub}</div><span class="lab-tag ${tag === 'Data quality' ? 'warn' : ''}">${tag}</span></div>`;
  const watchPassed = base.filter(r => v(r).status === 'Watch' && v(r).order_by_day != null && v(r).order_by_day <= 0).length;
  return `
  <div class="lab-cards" style="padding:16px 18px 0">
    ${card('Critical', n(x => x.status === 'Critical'), 'var(--bad)', 'Calculated', 'Below safety stock before any fix can land')}
    ${card('Watch', n(x => x.status === 'Watch'), 'var(--warn)', 'Calculated', `Dips below safety stock within 30 days; a fix can still land in time${watchPassed ? ` · ${watchPassed} past the order-by date, so only a transfer is in time` : ''}`)}
    ${card('Excess or ageing', n(x => x.excess || ageingFlag(x)), '', 'Data', 'Above max cover, or batches past the ageing age')}
    ${card('Data issues', n(x => x.data_issue), '', 'Data quality', 'Stockout days, or gaps that drop forecast confidence to Low')}
  </div>
  <div style="padding:12px 18px 18px">
    <div class="lab-panel" style="margin:0">
      <div class="row" style="justify-content:space-between;gap:8px;margin-bottom:8px">
        <div class="row" style="gap:6px">${locs.map(l => `<button class="dl-chip ${INV.loc === l ? 'on' : ''}" onclick="INV.loc=${jsq(l)};invRefresh()">${l === 'All' ? 'All products' : esc(locName(l)) + ' only'} · ${stocked(l).length}</button>`).join('')}</div>
        <div class="row" style="gap:6px"><select class="sel" aria-label="Status filter" onchange="INV.status=this.value;invRefresh()">${['All', 'Critical', 'Watch', 'Healthy', 'Excess or ageing', 'Data issue'].map(s => `<option ${INV.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><span class="dl-pill">Sort: lost sales ▾</span>
          <input class="dl-search" id="invQ" placeholder="Search product or SKU…" value="${esc(INV.q)}" oninput="INV.q=this.value;clearTimeout(window._invq);window._invq=setTimeout(()=>{invRefresh();const e=$('invQ');if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length)}},250)"></div>
      </div>
      <div class="tscroll"><table class="t inv-t"><thead><tr><th>Product</th><th>Status</th><th class="r">Available</th><th class="r">Reserved</th><th class="r">Incoming</th><th>Order by</th><th>Stock to add</th><th class="r">Lost sales, 30d</th><th>Action</th></tr></thead><tbody>
      ${rows.map(r => listRow(r, v(r), blocked)).join('') || '<tr><td colspan="9"><div class="empty">No product matches.</div></td></tr>'}
      </tbody></table></div>
      <div class="note" style="margin-top:8px">${INV.loc === 'All' ? 'All products: stock is totalled across the three locations and status shows the worst location.' : `${esc(locName(INV.loc))} figures only.`} Click a product to open it.</div>
      <details class="receipt" style="margin-top:10px"><summary><span>How status is decided</span>${IC.down.replace('<svg', '<svg class="i"')}</summary><div class="rbody">${Object.entries(L.rules).map(([k, x]) => `<div class="ln"><span><b>${esc(k)}</b></span><span class="muted" style="text-align:right">${esc(x)}</span></div>`).join('')}</div></details>
    </div>
  </div>`;
}
function orderByCell(x){
  if (x.order_by_day == null) return '<span class="muted">none</span>';
  if (x.order_by_day < 0) return `<b class="down">Passed</b><div class="muted" style="font-size:11px">${dlabIso(x.order_by_date)} · order now</div>`;
  if (x.order_by_day === 0) return '<b class="down">Today</b>';
  return `<b>${dlabIso(x.order_by_date)}</b>`;
}
// How much stock each location needs. In All products, every location that dips below safety is listed, not just the worst.
function unitsLine(x, where){
  const u = x.units_to_order, place = where ? ` <span class="muted">${esc(locName(where))}</span>` : '';
  if (u && u.qty) return `<div class="inv-need"><b>${fmt(u.qty)}</b>${place} <span class="muted">(${fmt(u.low)}–${fmt(u.high)})</span></div>`;
  const tr = x.transfer && x.transfer.qty > 0 ? ` · move ${fmt(x.transfer.qty)} from ${esc(locName(x.transfer.from))} to bridge it` : '';
  return `<div class="inv-need" title="Incoming stock covers the quantity, but it lands after stock dips below safety"><b class="muted">0</b>${place} <span class="muted">· incoming covers it, but lands late${tr}</span></div>`;
}
function unitsCell(x, loc, r){
  const rows = !loc && r ? Object.values(r.locations).filter(y => y.status !== 'Healthy') : (x.status !== 'Healthy' ? [x] : []);
  if (!rows.length || !rows.some(y => y.units_to_order)) return '<span class="muted">-</span>';
  rows.sort((a, b) => ((b.units_to_order || {}).qty || 0) - ((a.units_to_order || {}).qty || 0));
  const total = sum(rows.map(y => (y.units_to_order || {}).qty || 0)), short = sum(rows.map(y => y.lost_units_30d || 0));
  const lines = rows.map(y => unitsLine(y, !loc || rows.length > 1 ? y.location : (loc || y.location))).join('');
  const one = rows.length === 1 ? rows[0] : null;
  const tr = one && one.units_to_order && one.units_to_order.qty && one.transfer && one.transfer.qty > 0 ? `<div class="muted" style="font-size:11px">or move ${fmt(one.transfer.qty)} from ${esc(locName(one.transfer.from))}</div>` : '';
  const aged = (x.aged_elsewhere || []).length ? `<span class="dl-pill warn xs" title="${esc(x.aged_elsewhere.map(locName).join(', '))} holds aged units of this product">Aged stock elsewhere</span>` : '';
  return `${lines}${rows.length > 1 && total ? `<div class="inv-tot">Total <b>${fmt(total)}</b> units</div>` : ''}${tr}
    ${short >= 0.5 ? `<div class="inv-short">Short ~${fmt(short)} units in 30 days if nothing is done</div>` : ''}${aged}`;
}
function listRow(r, x, blocked){
  const loc = INV.loc === 'All' ? x.location : INV.loc;
  const flags = [x.excess ? invPill('Excess') : '', ageingFlag(x) ? invPill('Ageing', 'warn') : '', x.data_issue ? invPill('Data issue', 'demo') : ''].join(' ');
  const isBlocked = loc && blocked[key(r.sku, loc)];
  const act = x.status === 'Critical'
    ? `<button class="btn xs acc" ${isBlocked ? `disabled title="${esc(isBlocked)}"` : ''} onclick="event.stopPropagation();openPO(${jsq(r.sku)},${jsq(loc)})">Order now</button>`
    : x.status === 'Watch' ? `<button class="btn xs" onclick="event.stopPropagation();openProduct(${jsq(r.sku)},${jsq(loc)})">View</button>`
    : (x.excess || ageingFlag(x)) ? `<button class="btn xs" onclick="event.stopPropagation();openProduct(${jsq(r.sku)})">Review</button>` : '<span class="muted">none</span>';
  return `<tr class="click" onclick="openProduct(${jsq(r.sku)},${loc ? jsq(loc) : 'null'})">
    <td><b>${esc(r.name)}</b><div class="muted" style="font-size:11px">${esc(r.category)} · <span class="mono">${esc(r.sku)}</span> ${r.signals.map(s => `<span class="tag warn" style="padding:1px 5px">Event ${esc(s)}</span>`).join(' ')}</div></td>
    <td>${invPill(x.status, ST_PILL[x.status])}${INV.loc === 'All' && x.location ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(locName(x.location))}</div>` : ''}${flags.trim() ? `<div style="margin-top:3px">${flags}</div>` : ''}</td>
    <td class="r">${fmt(x.available)}</td><td class="r">${fmt(x.reserved)}</td><td class="r">${fmt(x.incoming)}</td>
    <td>${orderByCell(x)}</td><td>${unitsCell(x, INV.loc === 'All' ? null : INV.loc, r)}</td>
    <td class="r"><b title="Lost units at P50 under Do nothing (${fmt(x.lost_units_30d)}) × unit price">${aed(x.lost_sales_aed_30d)}</b></td>
    <td>${act}</td></tr>`;
}
// "Stop reordering" applies to the product-location that holds the aged stock
function blockedCells(A){
  const out = {};
  if (!A || A.error) return out;
  A.rows.forEach(r => { const s = r.suggested; if (s && s.step === 'Stop reordering' && !r.decision_id) out[key(r.sku, r.location)] = `Stop reordering: ${r.aged_units + r.ageing_units_30d} units here are aged or ageing (see the Ageing tab)`; });
  return out;
}

/* ---------------- Screen 2: Product tab ---------------- */
function productHTML(sku, L, A){
  const ps = INV.prod[sku] || (INV.prod[sku] = {loc:'All', days:30});
  const P = lazy('prod', `${sku}|${ps.loc}|${ps.days}`, () => api(`/network/product?sku=${encodeURIComponent(sku)}&location=${encodeURIComponent(ps.loc)}&days=${ps.days}`));
  if (!P) return '<div class="empty" style="padding:24px">Loading the product…</div>';
  if (P.error) return `<div class="warnbox" style="margin:16px 18px">${esc(P.error)}</div>`;
  const one = ps.loc !== 'All', cell = one ? P.cells[ps.loc] : null;
  const worst = Object.values(P.cells).sort((a, b) => ({Critical:0, Watch:1, Healthy:2})[a.status] - ({Critical:0, Watch:1, Healthy:2})[b.status])[0];
  const orderLoc = one ? ps.loc : (worst.status !== 'Healthy' ? worst.location : null);
  const blocked = orderLoc && blockedCells(A)[key(sku, orderLoc)];
  const c = P.cards;
  const card = (k, o, sub, src) => `<div class="lab-card"><span class="lbl">${k}</span><div class="lab-big">${fmt(o.value)}</div>${sub ? `<div class="note" style="font-size:11.5px">${sub}</div>` : ''}<span title="${esc(src || o.formula || '')}">${lbl3(o.tag)}</span></div>`;
  const low = P.data_quality.confidence === 'Low';
  return `<div style="padding:12px 18px 18px">
    <div class="crumb note" style="font-size:11.5px"><button class="linkb" onclick="invGo('inventory')">Inventory</button> › ${esc(P.category)} › <span class="mono">${esc(sku)}</span></div>
    <div class="row inv-bar">
      <b style="font-size:15px">${esc(P.name)}</b>${invPill(one ? cell.status : P.status, ST_PILL[one ? cell.status : P.status])}${P.signals.map(s => `<span class="tag warn">Event ${esc(s.signal_id)}</span>`).join('')}${low ? '<span class="lab-conf Low">Confidence: Low</span>' : ''}
      <span class="sp1"></span>
      <div class="seg">${['All', ...P.locations].map(l => `<button class="${ps.loc === l ? 'on' : ''}" onclick="INV.prod[${jsq(sku)}].loc=${jsq(l)};invRefresh()">${l === 'All' ? 'All' : esc(locName(l))}</button>`).join('')}</div>
      ${one ? `<button class="btn sm" onclick="correctModal({table:'inventory',sku:${jsq(sku)},loc:${jsq(ps.loc)},field:'available'})">${IC.edit} Correct stock</button>` : ''}
      ${orderLoc ? `<button class="btn sm acc" ${blocked ? `disabled title="${esc(blocked)}"` : ''} onclick="openPO(${jsq(sku)},${jsq(orderLoc)})">Order now${one ? '' : ' · ' + esc(locName(orderLoc))}</button>` : ''}
    </div>
    ${blocked ? `<div class="lab-banner">${esc(blocked)}. Order now is blocked for this location.</div>` : ''}
    <div class="lab-cards">
      ${card('Available', c.available, c.cover_days.value != null ? `Cover ${r1(c.cover_days.value)} days of P50 demand` : (one ? '' : 'Totalled across locations'), (c.available.source || []).map(s => srcOf(s)).join('; '))}
      ${card('Reserved', c.reserved, 'Committed to existing orders')}
      ${card('Incoming', c.incoming, c.incoming.orders.map(o => `${fmt(o.qty)} · ${o.po_id} · ${dlabIso(o.eta_with_signals)}${o.signal_delay_days ? ` (+${o.signal_delay_days}d)` : ''}${o.counted_in_plan ? '' : ' · unconfirmed, not counted'}`).join('<br>') || 'No open orders')}
      ${card('Safety stock', c.safety_stock, 'The buffer line on the graph')}
    </div>
    ${movementHTML(P, ps)}
    ${orderByBanner(P, one)}
    ${one ? receiptHTML(P) : perLocationHTML(P)}
    ${notesHTML(P, one)}
  </div>`;
}
function movementHTML(P, ps){
  const where = ps.loc === 'All' ? 'All locations' : locName(ps.loc);
  return `<div class="lab-panel"><div class="row" style="justify-content:space-between;margin-bottom:4px"><div class="lab-ph" style="margin:0"><b>Inventory movement · ${esc(where)} · units over time</b></div>
      <div class="row" style="gap:6px"><span class="lbl">Forecast</span><div class="seg">${[30, 60, 90].map(d => `<button class="${ps.days === d ? 'on' : ''}" onclick="INV.prod[${jsq(P.sku)}].days=${d};invRefresh()">${d} days</button>`).join('')}</div></div></div>
    ${invChart(P)}
    ${P.chart.confidence_note ? `<div class="lab-banner" style="margin:8px 0 0">${esc(P.chart.confidence_note)}.</div>` : ''}
   </div>`;
}
function invChart(P){
  const ch = P.chart, n = ch.days, hist = ch.history, nh = hist.length - 1;   // history = plan days -29..0
  const free0 = P.cards.free.value, ss = ch.safety_stock;
  const p50 = [free0, ...ch.p50], lo = [free0, ...ch.band_low], hi = [free0, ...ch.band_high], wo = ch.with_order ? [free0, ...ch.with_order] : null;
  const ob = P.order_by;
  const w = 1120, h = 380, x0 = 48, x1 = w - 112, y0 = 18, y1 = h - 86, s0 = h - 68, s1 = h - 30;
  const minV = Math.min(0, ...lo, ...(wo || [])), maxV = niceMax(Math.max(...hi, ss, ...(wo || [])) * 1.08);
  const N = nh + n, dx = (x1 - x0) / N;
  const X = t => x0 + (t + nh) * dx, Y = v => y1 - (v - minV) / (maxV - minV) * (y1 - y0);
  const path = arr => arr.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
  let g = yTicks(maxV).map(v => `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line2)"/><text class="ax" x="${x0 - 8}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('');
  if (minV < 0){
    const step = yTicks(maxV)[1] || maxV;
    for (let v = -step; v >= minV - 1e-6; v -= step) g += `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line2)"/><text class="ax" x="${x0 - 8}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text>`;
    g += `<line x1="${x0}" x2="${x1}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink2)"/><text class="ax" x="${x1 - 4}" y="${Y(0) - 4}" text-anchor="end">0 = stockout; below is unmet demand</text>`;
  }
  const ticks = [-nh, -15, 0, 15, 30, 60, 90].filter(t => t <= n);
  ticks.forEach(t => g += `<text class="ax" x="${X(t)}" y="${h - 10}" text-anchor="middle">${t === 0 ? 'Today' : pdlab(t)}</text>`);
  if (ch.extrapolated_from_day) g += `<rect x="${X(ch.extrapolated_from_day - 1)}" y="${y0}" width="${X(n) - X(ch.extrapolated_from_day - 1)}" height="${y1 - y0}" style="fill:var(--hover)"/><text class="ax" x="${X(ch.extrapolated_from_day - 1) + 4}" y="${y1 - 6}" style="fill:var(--warn)">Low confidence</text>`;
  const bandPath = path(hi) + ' ' + lo.map((v, i) => ({v, i})).reverse().map(o => 'L' + X(o.i).toFixed(1) + ',' + Y(o.v).toFixed(1)).join('') + 'Z';
  // sales strip
  const smax = Math.max(1, ...hist.map(d => d.units || 0));
  const bw = Math.max(1, dx - 1.5);
  const strip = hist.map(d => {
    const x = X(d.plan_day) - bw / 2;
    if (d.missing) return `<rect x="${x}" y="${s0}" width="${bw}" height="${s1 - s0}" style="fill:var(--line)"><title>${dlabIso(d.date)}: missing record</title></rect>`;
    const hh = (d.units / smax) * (s1 - s0);
    return `<rect x="${x}" y="${s1 - hh}" width="${bw}" height="${hh}" style="fill:${d.out_of_stock ? 'var(--bad)' : 'var(--ink2)'};opacity:.75"><title>${dlabIso(d.date)}: ${fmt(d.units)} sold${d.out_of_stock ? ' · stockout day (demand understated)' : ''}</title></rect>`;
  }).join('');
  let marks = `<line x1="${X(0)}" x2="${X(0)}" y1="${y0}" y2="${s1}" style="stroke:var(--muted);stroke-dasharray:2 3"/><text class="ax" x="${X(0) - 4}" y="${y0 + 8}" text-anchor="end">Today ${dlabIso(S.planDay)}</text>`;
  if (ob){
    const o = Math.max(-nh, ob.order_by_day);
    marks += `<line x1="${X(o)}" x2="${X(o)}" y1="${y0}" y2="${y1}" style="stroke:var(--sig);stroke-width:1.5"/><text class="ax" x="${X(o) + (o < 0 ? -4 : 4)}" y="${y0 + 20}" text-anchor="${o < 0 ? 'end' : 'start'}" style="fill:var(--sig);font-weight:600">Order by ${dlabIso(ob.order_by_date)}${ob.passed ? ' (passed)' : ''}</text>`;
    if (ob.arrival_day <= n) marks += `<line x1="${X(ob.arrival_day)}" x2="${X(ob.arrival_day)}" y1="${y0 + 26}" y2="${y1}" style="stroke:var(--ok);stroke-dasharray:3 3"/><text class="ax" x="${X(ob.arrival_day) + 4}" y="${y0 + 34}" style="fill:var(--ok)">Arrives ${dlabIso(ob.arrival_date)}</text>`;
    if (ob.breach_day != null && ob.breach_day <= n) marks += `<line x1="${X(ob.breach_day)}" x2="${X(ob.breach_day)}" y1="${y0 + 40}" y2="${y1}" style="stroke:var(--bad);stroke-dasharray:2 3"/><text class="ax" x="${X(ob.breach_day) + 4}" y="${y0 + 48}" style="fill:var(--bad)">Below safety ${dlabIso(ob.breach_date)}</text>`;
  }
  ch.inbound.forEach(a => { marks += `<path d="M${X(a.plan_day)},${y1} l-4,7 h8z" style="fill:var(--sig)"/><text class="ax" x="${X(a.plan_day)}" y="${y1 - 4}" text-anchor="middle" style="fill:var(--sig)">+${fmt(a.qty)}</text>`; });
  const labs = [[ss, `Safety ${fmt(ss)}`, 'var(--lab-b)'], [p50[n], 'P50', 'var(--sig)']];
  if (wo) labs.push([wo[n], 'With order', 'var(--ok)']);
  labs.sort((a, b) => b[0] - a[0]);
  const ly = labs.map(l => Y(l[0]) + 3); for (let i = 1; i < ly.length; i++) if (ly[i] - ly[i - 1] < 12) ly[i] = ly[i - 1] + 12;
  const id = 'ic' + Math.random().toString(36).slice(2, 8);
  const svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(P.name)}: stock today, forecast stock with P10 to P90 band, safety stock and order-by date">${g}
    <path d="${bandPath}" style="fill:var(--sig-soft);stroke:none"/>
    <line x1="${x0}" x2="${x1}" y1="${Y(ss)}" y2="${Y(ss)}" style="stroke:var(--lab-b);stroke-width:1.5;stroke-dasharray:6 4"/>
    <line x1="${X(-nh)}" x2="${X(0)}" y1="${Y(free0)}" y2="${Y(free0)}" style="stroke:var(--sig);stroke-width:1;opacity:.25"/>
    <path d="${path(p50)}" style="fill:none;stroke:var(--sig);stroke-width:2;stroke-dasharray:6 4"/>
    ${wo ? `<path d="${path(wo)}" style="fill:none;stroke:var(--ok);stroke-width:2"/>` : ''}
    <circle cx="${X(0)}" cy="${Y(free0)}" r="4.5" style="fill:var(--sig);stroke:var(--card);stroke-width:2"/>
    ${marks}
    <text class="ax" x="${x0}" y="${s0 - 4}">Daily sales, last 30 days</text>${strip}
    ${labs.map((l, i) => `<text class="ax" x="${x1 + 6}" y="${ly[i]}" style="fill:${l[2]}">${esc(l[1])}</text>`).join('')}
    <line class="cross" x1="0" x2="0" y1="${y0}" y2="${s1}" style="stroke:var(--faint);opacity:0"/>
    <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${s1 - y0}" style="fill:transparent"/></svg>`;
  CH[id] = {w, h, x0, dx, n:N + 1, ty: i => { const t = i - nh; return t <= 0 ? s0 : Y(hi[t]); }, tip: i => {
    const t = i - nh;
    if (t < 0){ const d = hist[i]; return `<b>${dlabIso(d.date)}</b><br>${d.missing ? 'Missing record' : `Sold ${fmt(d.units)}${d.out_of_stock ? ' · stockout day' : ''}`}`; }
    return `<b>${t === 0 ? 'Today' : pdlab(t)}</b><br>${t === 0 ? `Actual free stock <b>${fmt(free0)}</b>` : `Forecast P50 <b>${fmt(p50[t])}</b><br>P10 to P90 band: ${fmt(lo[t])} to ${fmt(hi[t])}`}${wo && t > 0 ? `<br>With order <b>${fmt(wo[t])}</b>` : ''}<br>Safety stock ${fmt(ss)}`;
  }};
  return `<div class="chart" data-ch="${id}">${svg}<div class="tip"></div></div>
    <div class="legend" style="margin-top:4px"><span><i style="background:var(--sig);border-radius:50%"></i>Actual stock today</span><span><i style="background:repeating-linear-gradient(90deg,var(--sig) 0 5px,transparent 5px 8px);height:2px"></i>Forecast stock (P50)</span><span><i style="background:var(--sig-soft)"></i>P10 to P90</span><span><i style="background:repeating-linear-gradient(90deg,var(--lab-b) 0 5px,transparent 5px 8px);height:2px"></i>Safety stock</span>${wo ? `<span><i style="background:var(--ok);height:2px"></i>Stock if ordered by the order-by date</span>` : ''}<span><i style="background:var(--bad)"></i>Stockout day</span><span><i style="background:var(--line)"></i>Missing record</span></div>`;
}
function orderByBanner(P, one){
  if (!one){
    const rows = Object.values(P.cells).filter(x => x.order_by_day != null);
    return rows.length ? `<div class="lab-banner"><b>Order-by dates differ by location.</b> ${rows.map(x => `${esc(locName(x.location))}: ${x.order_by_day < 0 ? 'passed ' + dlabIso(x.order_by_date) : x.order_by_day === 0 ? 'today' : dlabIso(x.order_by_date)}`).join(' · ')}. Pick a location for its graph markers and decision receipt.</div>`
      : '<div class="lab-chg">No location falls below safety stock within 30 days. No order is needed.</div>';
  }
  const o = P.order_by, L = P.receipt.lead_time;
  if (!o) return '<div class="lab-chg"><b>No order needed.</b> Projected stock stays above safety stock for 30 days at P50 demand.</div>';
  const tr = P.transfer && P.transfer.spare > 0 ? ` ${esc(locName(P.transfer.from))} holds ${fmt(P.transfer.spare)} units above its safety stock, and a transfer would arrive in ${P.transfer.lead_days} day${P.transfer.lead_days === 1 ? '' : 's'}.` : '';
  if (o.order_by_day <= 0) return `<div class="lab-alert"><b style="font-size:13.5px">${o.passed ? `The order-by date passed on ${fullD(o.order_by_date)}.` : `Order by today, ${fullD(o.order_by_date)}, for a ${o.lead_days}-day planning lead time.`}</b><br>
    An order placed today arrives ${fullD(o.arrival_date)}${o.gap_days ? `, ${o.gap_days} day${o.gap_days === 1 ? '' : 's'} after stock falls below safety stock on ${dlabIso(o.breach_date)}. Ordering alone cannot close that gap${o.lost_before_arrival ? `: about ${fmt(o.lost_before_arrival)} units are lost before it lands at P50 demand` : ''}.` : ', before stock falls below safety stock.'}${tr}</div>`;
  return `<div class="lab-banner"><b style="font-size:13.5px">Order by ${fullD(o.order_by_date)} for a ${o.lead_days}-day planning lead time.</b><br>
    An order placed by then arrives on ${fullD(o.arrival_date)}, ${o.review_buffer_days} days (the review buffer) before projected stock falls below safety stock on ${dlabIso(o.breach_date)}. Ordering later means a gap.${tr}</div>`;
}
const rline = (k, v, tag, title) => `<tr><td>${k}</td><td class="r"${title ? ` title="${esc(title)}"` : ''}>${v}</td><td>${tag ? lbl3(tag) : ''}</td></tr>`;
function receiptHTML(P){
  const L = P.receipt.lead_time, Q = P.receipt.quantity, d = n => `${r1(n)} days`;
  const lead = `<table class="t"><thead><tr><th>Lead time</th><th class="r">Value</th><th>Label</th></tr></thead><tbody>
    ${rline('Supplier stated lead time', '<span class="muted">not in data</span>', 'Assumption', 'The supplied data has no stated lead time per supplier')}
    ${L.verified ? rline(`Past deliveries, median (${L.deliveries} orders)`, d(L.median_days), 'Calculated', `supplier_lead_history.csv · ${L.supplier}`)
      + rline('Past deliveries, mean', d(L.mean_days), 'Calculated', 'Mean of received date - order date')
      + rline('Past deliveries, slowest 20%', d(L.slowest_20pct_days), 'Calculated', '80th percentile, shown for comparison')
      : rline('Past deliveries', '<span class="muted">none</span>', 'Assumption', L.note) + rline('Default lead time used', d(L.mean_days), 'Assumption', L.note)}
    ${rline(L.signals.length ? `Supply event on this SKU (${esc(L.signals.join(', '))})` : 'Supply event on this SKU', L.signal_delay_days ? `+${L.signal_delay_days} days` : '<span class="muted">none</span>', L.signals.length ? 'Data' : '', 'Only supplied signals that name this SKU\'s components')}
    <tr><td><b>Planning lead time</b></td><td class="r"><b>${L.lead_days} days</b></td><td>${lbl3('Calculated')}</td></tr></tbody></table>`;
  const qty = Q ? `<table class="t"><thead><tr><th>Order quantity</th><th class="r">Value</th><th>Label</th></tr></thead><tbody>
    ${rline(`Forecast demand, ${Q.cover_days} days (P50)`, `${fmt(Q.demand_p50)} units`, 'Calculated', `${r2(Q.d50_daily)} a day × (lead time ${L.lead_days} + review period ${L.review_period_days} days)`)}
    ${rline('+ Safety stock', `${fmt(Q.safety_stock)} units`, 'Data', 'safety_stock.csv')}
    ${rline('− Free now (available − reserved)', `${fmt(Q.free)} units`, 'Data', 'inventory.csv')}
    ${rline('− Incoming', `${fmt(Q.incoming)} units`, 'Data', 'inbound_orders.csv, confirmed orders only')}
    ${rline(`Rounded to MOQ ${fmt(Q.moq)}, pack ${fmt(Q.pack_size)}`, `${fmt(Q.raw_qty)} → ${fmt(Q.qty)}`, 'Data', 'sku_master.csv')}
    <tr><td><b>Recommended quantity</b></td><td class="r"><b>${fmt(Q.qty)} units</b> <span class="muted">range ${fmt(Q.low)} to ${fmt(Q.high)}</span></td><td>${lbl3('Calculated')}</td></tr></tbody></table>
    ${Q.capped ? `<div class="note" style="margin-top:6px">Capped at max cover on arrival (${fmt(Q.max_cover_cap)} units).</div>` : ''}${Q.moq_forced_excess ? '<div class="note down" style="margin-top:6px">The MOQ forces cover above the max-cover cap.</div>' : ''}`
    : '<div class="note">No order quantity: projected stock stays above the reorder need for this location.</div>';
  return `<details class="receipt" open style="margin-bottom:12px"><summary><span>Decision receipt <span class="muted" style="font-weight:400">· how the lead time and the quantity were reached</span></span>${IC.down.replace('<svg', '<svg class="i"')}</summary><div class="rbody">
    <div class="lab-2">${lead}<div>${qty}</div></div>
    <div class="note" style="margin-top:8px">${esc(L.rule)}. Order by = date stock falls below safety stock − lead time − ${L.review_buffer_days}-day review buffer. Quantity = P50 demand over lead time and review period + safety stock − free − incoming; the range uses P10 and P90 demand. Hover a number for its formula and source.</div>
    ${L.verified ? '' : `<div class="lab-banner" style="margin:8px 0 0">${esc(L.note)}.</div>`}
  </div></details>`;
}
function perLocationHTML(P){
  return `<div class="lab-panel"><div class="lab-ph"><b>By location</b><span class="note">Pick a location for its receipt.</span></div><div class="tscroll"><table class="t"><thead><tr><th>Location</th><th>Status</th><th class="r">Available</th><th class="r">Free</th><th class="r">Safety</th><th class="r">Cover</th><th>Order by</th><th>Units to order</th></tr></thead><tbody>
    ${Object.values(P.cells).map(x => `<tr class="click" onclick="INV.prod[${jsq(P.sku)}].loc=${jsq(x.location)};invRefresh()"><td><b>${esc(locName(x.location))}</b></td><td>${invPill(x.status, ST_PILL[x.status])}</td><td class="r">${fmt(x.available)}</td><td class="r">${fmt(x.free)}</td><td class="r">${fmt(x.safety_stock)}</td><td class="r">${x.cover_days == null ? '—' : r1(x.cover_days) + ' d'}</td><td>${orderByCell(x)}</td><td>${unitsCell(x, x.location)}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}
function notesHTML(P, one){
  const q = P.data_quality, out = [];
  const wape = q.wape != null ? ` Forecast error (WAPE) ${Math.round(q.wape * 100)}% against ${Math.round(q.wape_baseline * 100)}% for the recent-average baseline.` : '';
  out.push(`<div class="lab-panel"><div class="lab-ph"><b>Data quality</b></div><div class="lab-dqt">
    <span>${q.stockout_days.length ? `<b>${q.stockout_days.length} stockout days</b> (history days ${esc(rangeText(q.stockout_days))}): demand on those days is understated, so it is corrected ${q.correction_pct > 0 ? `upward by about ${r1(q.correction_pct)}%` : 'where needed'} ${evTag('Assumption')}` : 'No stockout days in the history.'}</span>
    <span>${q.missing_days.length ? `<b>${q.missing_days.length} missing sales days</b> are shown as gaps, not filled with zeros.` : 'No missing sales days.'}</span>
    <span>Forecast, 30 days: ${fmt(q.demand_30d.P10)} · <b>${fmt(q.demand_30d.P50)}</b> · ${fmt(q.demand_30d.P90)} (P10 · P50 · P90) ${lbl3('Calculated')} · confidence <span class="lab-conf ${q.confidence}">${esc(q.confidence)}</span>.${wape}</span></div></div>`);
  if (P.signals.length) out.push(`<div class="lab-evbox">${P.signals.map(s => `<b>Supplied event ${esc(s.signal_id)} (dated ${fullD(s.date)}): ${esc(s.source)}.</b> ${s.type === 'supply' ? `Supply signal, likely delay ${s.delay_likely} days.` : `Demand signal, likely uplift ${pct(s.uplift_likely)}.`} Status ${esc(s.status)}. It applies only to the SKUs it names. Source: ${esc(s.source_file || 'signal pack')}.`).join('<br>')}</div>`);
  if (one && P.transfer && P.transfer.spare > 0) out.push(`<div class="note">Also available: ${esc(locName(P.transfer.from))} holds ${fmt(P.transfer.spare)} units above its safety stock. A transfer would arrive in ${P.transfer.lead_days} day${P.transfer.lead_days === 1 ? '' : 's'}. <span class="dl-pill xs">Option</span> The planner decides.</div>`);
  if (P.aged_elsewhere.length) out.push(`<div class="note" style="margin-top:6px">${P.aged_elsewhere.map(a => `${esc(locName(a.location))} holds ${fmt(a.aged_units)} aged units`).join('; ')}. <button class="linkb" onclick="invGo('ageing')">See the Ageing tab</button></div>`);
  return out.join('');
}
function rangeText(days){
  const out = []; let s = days[0], p = days[0];
  for (const d of days.slice(1).concat([null])){ if (d === p + 1){ p = d; continue; } out.push(s === p ? `${s}` : `${s} to ${p}`); s = p = d; }
  return out.join(', ');
}

/* ---------------- Screen 3: Draft purchase order ---------------- */
async function poLoad(id, qty){
  const t = INV.open.find(x => x.id === id); if (!t) return;
  const st = INV.po[id] || (INV.po[id] = {qty:null, data:null, error:null, reason:null, ack:null, terms:''});
  st.loading = true;
  try {
    st.data = await api('/drafts/po', {method:'POST', body:{sku:t.sku, location:t.loc, ...(qty ? {qty} : {})}});
    st.qty = st.data.draft_po.qty; st.error = null;
  } catch (e) { st.error = errMsg(e); }
  st.loading = false;
  if (CURRENT === 'network' && INV.active === id){
    const typing = document.activeElement && document.activeElement.id === 'poQty';
    invRefresh();
    const el = $('poQty'); if (typing && el){ el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
    poGuard(id);
  }
}
function poInput(id, v){
  const st = INV.po[id]; const q = Math.round(+v || 0);
  clearTimeout(st.t);
  if (q <= 0){ const el = $('poMsg'); if (el) el.innerHTML = '<div class="warnbox">Quantity must be positive.</div>'; return; }
  st.reason = null;
  st.t = setTimeout(() => poLoad(id, q), 400);
}
// Oversize: above the quantity needed under P90 demand. Shown once per entered quantity.
function poGuard(id){
  const st = INV.po[id]; if (!st || !st.data) return;
  const im = st.data.impact, q = st.data.draft_po.qty;
  if (im.units_above_p90_need <= 0 || st.ack === q || st.reason) return;
  const r = im.recommended, extra = (im.holding_added_aed + im.ageing_added_aed) - (im.recommended_holding_and_ageing_aed || 0);
  openModal(`<span class="dl-pill bad">Not recommended</span><h3 style="margin-top:8px">This quantity is above what we recommend</h3>
    <div class="hint">You entered ${fmt(q)} units. The engine recommends ${fmt(r.qty)} (range ${fmt(r.low)} to ${fmt(r.high)}). ${fmt(q)} is above the quantity needed under P90 demand.</div>
    <div class="rbody" style="padding:10px 0 0"><div class="dl-kv"><span>Extra holding and ageing cost, 30 days</span><b>+ ${aed(extra)}</b></div><div class="dl-kv"><span>Units above the P90 need, heading toward the ageing threshold</span><b>+ ${fmt(im.units_above_p90_need)}</b></div><div class="dl-kv"><span>Net benefit vs do nothing</span><b>${aed(im.recommended_net_benefit_aed)} → ${aed(im.net_benefit_aed)}</b></div></div>
    <div style="display:grid;gap:6px;margin-top:14px"><button class="btn sm acc" onclick="closeModal();poToLabTab(${jsq(id)})">${IC.flask} Test it first in Scenario Lab (${fmt(q)} pre-filled)</button><button class="btn sm" onclick="closeModal();poLoad(${jsq(id)},${r.qty})">Use recommended ${fmt(r.qty)}</button><button class="btn sm" style="color:var(--bad);border-color:var(--bad)" onclick="poKeep(${jsq(id)})">Keep my quantity · reason required</button></div>
    <div class="note" style="margin-top:8px">Keeping it is allowed. Your reason is stored in the Decision Log.</div>`);
}
function poKeep(id){
  const st = INV.po[id];
  reasonModal('Keep this quantity', `A short reason is stored in the Decision Log with the PO.`, why => { st.reason = why; st.ack = st.data.draft_po.qty; invRefresh(); }, 'Keep quantity', 'e.g. Supplier price break at this quantity');
}
async function poToLabTab(id){
  const t = INV.open.find(x => x.id === id), q = INV.po[id].data.draft_po.qty;
  busy('Opening a Scenario Lab tab for this order…');
  try { const tab = await api('/lab/tabs', {method:'POST', body:{sku:t.sku, location:t.loc, name:`Draft PO ${q}`, decision:{type:'reorder', location:t.loc, qty:q}}}); openLab(key(t.sku, t.loc), {select:tab.tab_id}); }
  catch (e) { showError(e); } finally { unbusy(); }
}
function poApprove(id, why){
  const t = INV.open.find(x => x.id === id), st = INV.po[id], d = st.data;
  const reason = why || st.reason || null;
  mutate('Logging the PO…', async () => {
    const r = await api('/drafts/po', {method:'POST', body:{sku:t.sku, location:t.loc, qty:d.draft_po.qty, save:true, override_reason:reason, expected_input_hash:d.input_hash}});
    st.done = r.decision.decision_id; st.status = r.decision.status;
    toast(`PO logged as ${r.decision.decision_id} (${r.decision.status}). Nothing was sent.`);
    return r;
  }, {onError: e => {
    if (e instanceof ApiError && e.status === 422 && /reason/i.test(e.message)){ reasonModal('A reason is required', esc(e.message), w => poApprove(id, w), 'Approve with reason'); return true; }
    return false;
  }});
}
function poHTML(t, L, A){
  const st = INV.po[t.id];
  if (!st || (!st.data && !st.error)) return '<div class="empty" style="padding:24px">Preparing the draft PO…</div>';
  if (st.error && !st.data) return `<div class="warnbox" style="margin:16px 18px">${esc(st.error)}</div>`;
  const d = st.data, p = d.draft_po, im = d.impact, r = im.recommended;
  const row = L && !L.error ? L.rows.find(x => x.sku === t.sku) : null;
  const cell = row ? row.locations[t.loc] : null;
  const agedHere = A && !A.error ? A.rows.filter(x => x.sku === t.sku && x.location !== t.loc && x.aged_units > 0) : [];
  const blocked = blockedCells(A)[key(t.sku, t.loc)];
  const lbl = (k, tag) => `<label>${k} ${tag ? lbl3(tag) : ''}</label>`;
  const fld = (v, cls) => `<div class="inv-fld ${cls || ''}">${v}</div>`;
  const under = im.units_below_p10_need > 0;
  const done = st.done;
  const chk = (ok, a, b) => `<div class="dl-kv"><span>${a}</span><b><span class="dl-pill ${ok ? 'ok' : 'bad'}">${b}</span></b></div>`;
  const lu = im.lost_units;
  return `<div class="inv-po">
    <div class="lab-panel" style="margin:0">
      <div class="row" style="justify-content:space-between;margin-bottom:10px"><b style="font-size:13.5px">Order details</b><span class="dl-pill warn">${done ? `Logged ${esc(done)} · not sent` : 'Draft · not sent'}</span></div>
      ${agedHere.length ? `<div class="lab-banner">${agedHere.map(x => `${esc(locName(x.location))} holds ${fmt(x.aged_units)} aged units`).join('; ')}. A transfer may be better than ordering. <button class="linkb" onclick="invGo('ageing')">Open the Ageing tab</button></div>` : ''}
      ${blocked ? `<div class="lab-alert">${esc(blocked)}. Approving needs a reason.</div>` : ''}
      <div class="lab-2">
        <div class="field">${lbl('Supplier', 'Data')}${fld(esc(p.supplier))}</div>
        <div class="field">${lbl('Deliver to', 'Calculated')}${fld(esc(locName(p.location)) + ' warehouse')}</div>
        <div class="field">${lbl('Unit cost', 'Data')}${fld(aed(im.unit_cost_aed) + ' <span class="muted">SKU master</span>')}</div>
        <div class="field">${lbl('Quantity', 'Calculated')}<input id="poQty" type="number" min="1" value="${p.qty}" ${done ? 'disabled' : ''} oninput="poInput(${jsq(t.id)},this.value)" style="border-color:${im.units_above_p90_need > 0 ? 'var(--bad)' : 'var(--sig)'}"><span class="note">recommended ${fmt(r.qty)} · range ${fmt(r.low)} to ${fmt(r.high)}</span></div>
        <div class="field">${lbl('Expected arrival', 'Calculated')}${fld(`${fullD(im.arrival_date)} · ${p.lead_time.lead_days}-day lead time`)}</div>
        <div class="field">${lbl('Order by', 'Calculated')}${fld(d.reorder_plan ? (d.reorder_plan.order_by_day < 0 ? `<span class="down">passed ${dlabIso(d.reorder_plan.order_by_date)}: order now</span>` : fullD(d.reorder_plan.order_by_date)) : 'No breach within 30 days')}</div>
        <div class="field">${lbl('Minimum order quantity · pack', 'Data')}${fld(`${fmt(im.moq)} · pack of ${fmt(im.pack_size)} <span class="muted">SKU master</span>`)}</div>
        <div class="field">${lbl('Payment terms', 'Assumption')}<input id="poTerms" placeholder="Not in data · enter or leave blank" value="${esc(st.terms)}" ${done ? 'disabled' : ''} oninput="INV.po[${jsq(t.id)}].terms=this.value" style="background:var(--warn-soft)"></div>
      </div>
      <div id="poMsg">${st.loading ? '<div class="note">Recalculating…</div>' : ''}${under ? `<div class="warnbox">This quantity is below what we recommend: ${fmt(im.units_below_p10_need)} units under the P10 need. Lost units at P90 demand stay at ${fmt(lu.P90.after)}.</div>` : ''}${st.reason ? `<div class="note">Kept above the recommendation. Reason for the Decision Log: “${esc(st.reason)}”.</div>` : ''}</div>
      <div class="row" style="margin-top:12px">${done ? `<button class="btn sm" onclick="openDecision(${jsq(done)})">Open in Decision Log</button><button class="btn sm" onclick="invClose(${jsq(t.id)})">Close</button>`
        : `<button class="btn acc" ${st.loading ? 'disabled' : ''} onclick="${im.units_above_p90_need > 0 && !st.reason ? `INV.po[${jsq(t.id)}].ack=null;poGuard(${jsq(t.id)})` : blocked && !st.reason ? `reasonModal('Approve despite aged stock', ${jsq(esc(blocked))}, w => poApprove(${jsq(t.id)}, w))` : `poApprove(${jsq(t.id)})`}">Approve and log PO (mock)</button><button class="btn sm" onclick="invClose(${jsq(t.id)})">Discard</button>`}</div>
      <div class="note" style="margin-top:8px">A mock order: it is logged, not sent.</div>
    </div>
    <div class="stack">
      <div class="lab-panel" style="margin:0"><div class="lab-ph"><b>Live impact</b><span class="note">vs do nothing, 30 days</span></div>
        <div class="dl-kv"><span>Order cost</span><b>${fmt(p.qty)} × ${aed(im.unit_cost_aed)} = ${aed(im.order_cost_aed)}</b></div>
        <div class="dl-kv"><span>Expected arrival</span><b>${dlabIso(im.arrival_date)}</b></div>
        <div class="dl-kv" title="${esc(im.lost_units_basis)}"><span>Lost units, P50 demand</span><b>${fmt(lu.P50.before)} → ${fmt(lu.P50.after)}</b></div>
        <div class="dl-kv" title="${esc(im.lost_units_basis)}"><span>Lost units, P90 demand</span><b>${fmt(lu.P90.before)} → ${fmt(lu.P90.after)}</b></div>
        <div class="dl-kv"><span>Holding and ageing cost added</span><b>${aed(im.holding_added_aed + im.ageing_added_aed)}</b></div>
        <div class="dl-kv"><span>Net benefit</span><b style="font-size:15px">${aed(im.net_benefit_aed)}</b></div>
        <span class="lab-tag">Calculated</span></div>
      <div class="lab-panel" style="margin:0"><div class="lab-ph"><b>Checks</b></div>
        ${chk(im.checks.arrives_before_breach.pass, 'Arrives before breach', im.checks.arrives_before_breach.breach_date ? `${dlabIso(im.arrival_date)} ${im.checks.arrives_before_breach.pass ? '≤' : '>'} ${dlabIso(im.checks.arrives_before_breach.breach_date)}` : 'no breach')}
        ${chk(im.checks.within_p90_need.pass, 'Within P90 demand need', im.checks.within_p90_need.pass ? 'Pass' : `above ${fmt(im.checks.within_p90_need.p90_qty)}`)}
        ${chk(d.guardrail.in_range, 'Within max cover on arrival', d.guardrail.in_range ? 'Pass' : 'outside safe range')}
        ${!im.checks.arrives_before_breach.pass && cell && cell.transfer && cell.transfer.spare > 0 ? `<div class="note" style="margin-top:6px">${esc(locName(cell.transfer.from))} holds ${fmt(cell.transfer.spare)} spare units; a transfer arrives in ${cell.transfer.lead_days} day${cell.transfer.lead_days === 1 ? '' : 's'}.</div>` : ''}</div>
    </div></div>`;
}

/* ---------------- Purchase orders ---------------- */
function posHTML(list){
  const drafts = INV.open.filter(t => t.kind === 'po' && !(INV.po[t.id] && INV.po[t.id].done));
  return `<div style="padding:16px 18px 18px"><div class="lab-panel" style="margin:0"><div class="lab-ph"><b>Logged purchase orders (mock)</b><span class="note">Mock orders. Nothing was sent to a supplier.</span></div>
    <div class="tscroll"><table class="t"><thead><tr><th>Decision</th><th>Product</th><th>Deliver to</th><th class="r">Quantity</th><th>Order on</th><th>Status</th><th>Logged</th><th></th></tr></thead><tbody>
    ${list.slice().reverse().map(d => { return `<tr><td class="mono" style="font-size:11.5px">${esc(d.decision_id)}</td><td><b>${esc(SKU_NAME(d.sku))}</b><div class="muted mono" style="font-size:11px">${esc(d.sku)}</div></td><td>${esc(locName(d.location))}</td><td class="r">${fmt(d.chosen.qty)}</td><td>${pdlab(d.chosen.order_day || 0)}</td><td><span class="pill ${esc(d.status)}">${esc(d.status)}</span></td><td>${dlabIso(d.timestamp)}</td><td><button class="btn xs" onclick="openDecision(${jsq(d.decision_id)})">Receipt</button></td></tr>`; }).join('') || '<tr><td colspan="8"><div class="empty">No purchase order logged yet. Use Order now on a critical product.</div></td></tr>'}
    </tbody></table></div>
    ${drafts.length ? `<div class="note" style="margin-top:10px">Open drafts: ${drafts.map(t => `<button class="linkb" onclick="invGo(${jsq(t.id)})">${esc(t.sku)} → ${esc(locName(t.loc))}</button>`).join(', ')}</div>` : ''}</div></div>`;
}

/* ---------------- Screen 4: Ageing tab ---------------- */
function ageingHTML(A, L){
  const locs = ['All', ...LOCS.map(l => l.id)];
  let rows = A.rows.filter(r => INV.ageLoc === 'All' || r.location === INV.ageLoc);
  if (INV.ageSort === 'value') rows = rows.slice().sort((a, b) => b.value_at_cost_aed - a.value_at_cost_aed);
  const unknown = A.age_unknown.filter(r => INV.ageLoc === 'All' || r.location === INV.ageLoc);
  const card = (k, v, tag) => `<div class="lab-card"><span class="lbl">${k}</span><div class="lab-big">${v}</div><span class="lab-tag">${tag}</span></div>`;
  const C = A.cards;
  return `
  <div class="lab-cards" style="padding:16px 18px 0">${card('Aged units', fmt(C.aged_units), 'Data')}${card('Ageing within 30 days', fmt(C.ageing_units_30d), 'Calculated')}${card('Value at risk', aed(C.value_at_risk_aed), 'Calculated')}${card('Holding cost so far', aed(C.holding_cost_so_far_aed), 'Calculated')}</div>
  <div style="padding:12px 18px 18px"><div class="lab-panel" style="margin:0">
    <div class="row" style="justify-content:space-between;gap:8px;margin-bottom:8px">
      <div class="row" style="gap:6px">${locs.map(l => `<button class="dl-chip ${INV.ageLoc === l ? 'on' : ''}" onclick="INV.ageLoc=${jsq(l)};invRefresh()">${l === 'All' ? 'All products' : esc(locName(l)) + ' only'}</button>`).join('')}</div>
      <div class="row" style="gap:6px"><span class="note">Threshold ${A.threshold_days} days ${evTag('Assumption', A.threshold_note)}</span><div class="seg"><button class="${INV.ageSort === 'oldest' ? 'on' : ''}" onclick="INV.ageSort='oldest';invRefresh()">Oldest first</button><button class="${INV.ageSort === 'value' ? 'on' : ''}" onclick="INV.ageSort='value';invRefresh()">Highest value at risk</button></div></div>
    </div>
    <div class="tscroll"><table class="t inv-t"><thead><tr><th>Rank</th><th>Product · location</th><th>Age bands</th><th class="r">Oldest batch</th><th class="r">Aged · ageing</th><th class="r">Value at cost</th><th class="r">Holding so far</th><th>Crosses threshold</th><th>Suggested step</th><th>Action</th></tr></thead><tbody>
    ${rows.map((r, i) => ageRow(r, i + 1)).join('')}
    ${unknown.map(r => `<tr><td class="muted">—</td><td><b>${esc(r.name)}</b><div class="muted" style="font-size:11px">${esc(locName(r.location))} · <span class="mono">${esc(r.sku)}</span></div></td><td colspan="7"><span class="dl-pill warn">Age unknown</span> <span class="note">${fmt(r.units)} units have no stock-age record. Left out of Value at risk and counted as a data issue.</span></td><td><button class="btn xs" onclick="go('data')">Add stock-age data</button></td></tr>`).join('')}
    ${!rows.length && !unknown.length ? '<tr><td colspan="10"><div class="empty">No aged or ageing stock here.</div></td></tr>' : ''}
    </tbody></table></div>
    <details class="receipt" style="margin-top:10px"><summary><span>How ageing and suggested steps are decided</span>${IC.down.replace('<svg', '<svg class="i"')}</summary><div class="rbody">
      ${Object.entries(A.rules).map(([k, x]) => `<div class="ln"><span><b>${esc(k)}</b></span><span class="muted" style="text-align:right">${esc(x)}</span></div>`).join('')}
      <div class="ln"><span><b>Steps</b></span><span class="muted" style="text-align:right">Transfer when another location sells at least 1.5× faster and has room · Hold only with a supplied demand signal or a planner tag · Discount only when nothing stronger applies and carrying cost exceeds the margin given up (uplift is an Assumption) · Stop reordering whenever aged or ageing stock is on hand · Liquidate or write off as a last resort</span></div>
    </div></details>
  </div></div>`;
}
function ageRow(r, rank){
  const b = r.bands, tot = Math.max(1, b['0-30'] + b['31-60'] + b['61-90'] + b['90+']);
  const seg = (k, c) => b[k] ? `<i style="width:${b[k] / tot * 100}%;background:${c}" title="${k} days: ${fmt(b[k])} units"></i>` : '';
  const s = r.suggested, k = key(r.sku, r.location);
  const done = r.decision_id || (activeDecision(k) && ['Approved', 'Overridden'].includes(activeDecision(k).status) ? activeDecision(k).decision_id : null);
  const detail = !s ? '' : s.step === 'Transfer' ? `${fmt(s.qty)} units to ${esc(locName(s.to))} · ${aed(s.cost_aed)} · ${s.lead_days} d`
    : s.step === 'Hold' ? `holding ${aed(s.holding_cost_aed)} vs margin ${aed(s.expected_margin_aed)}${s.warning ? ` · <span class="down">${esc(s.warning)}</span>` : ''}`
    : s.step === 'Discount' ? `${s.depth_pct}% off · margin given up ${aed(s.margin_lost_aed)} vs carrying ${aed(s.holding_and_ageing_cost_aed)}`
    : s.step === 'Liquidate or write off' ? `full loss ${aed(s.loss_aed)}` : 'blocks Order now here';
  const tagged = AGE_TAGS.includes(k);
  return `<tr><td class="mono">${rank}</td>
    <td><b>${esc(r.name)}</b><div class="muted" style="font-size:11px">${esc(locName(r.location))} · <span class="mono">${esc(r.sku)}</span></div></td>
    <td><div class="inv-bands">${seg('0-30', 'var(--line)')}${seg('31-60', 'var(--faint)')}${seg('61-90', 'var(--warn)')}${seg('90+', 'var(--bad)')}</div><div class="muted" style="font-size:10.5px">${['0-30', '31-60', '61-90', '90+'].map(x => fmt(b[x])).join(' · ')}</div></td>
    <td class="r"><b>${fmt(r.oldest_days)} d</b></td>
    <td class="r">${fmt(r.aged_units)}${r.ageing_units_30d ? `<div class="muted" style="font-size:11px">${fmt(r.ageing_units_30d)} more by ${dlabIso(r.crosses_date)}</div>` : ''}</td>
    <td class="r">${aed(r.value_at_cost_aed)}</td><td class="r">${aed(r.holding_cost_so_far_aed)}</td>
    <td>${r.crosses_date ? dlabIso(r.crosses_date) : r.aged_units ? '<span class="down">already past</span>' : '—'}</td>
    <td style="white-space:normal;min-width:200px"><b>${esc(s ? s.step : '—')}</b>${s ? `: ${esc(s.reason)} ${lbl3(s.tag)}` : ''}<div class="muted" style="font-size:11px">${detail}</div>
      ${r.seasonal_note ? `<div class="muted" style="font-size:11px">${esc(r.seasonal_note)} · <button class="linkb" onclick="ageTag(${jsq(k)})">tag as seasonal</button></div>` : tagged ? `<div class="muted" style="font-size:11px">Seasonal tag set by you ${evTag('Assumption')} · <button class="linkb" onclick="ageTag(${jsq(k)})">remove</button></div>` : ''}</td>
    <td>${done ? `<button class="btn xs" onclick="openDecision(${jsq(done)})"><span class="dl-pill ok xs" style="margin:0">Decision logged</span></button>` : `<button class="btn xs acc" style="white-space:normal;text-align:left;max-width:190px" onclick="ageToLab(${jsq(r.sku)},${jsq(r.location)})">${IC.flask} Recommend a solution in Scenario Lab</button>`}</td></tr>`;
}
function ageTag(k){
  AGE_TAGS = AGE_TAGS.includes(k) ? AGE_TAGS.filter(x => x !== k) : [...AGE_TAGS, k];
  try { localStorage.setItem('inventra-seasonal', JSON.stringify(AGE_TAGS)); } catch (e) {}
  invRefresh();
}
// Opens pre-filled decision tabs for the steps the rules allow, beside the pinned Do nothing tab
async function ageToLab(sku, loc){
  const A = (LAZY.agel || {})[AGE_TAGS.join(',')]; if (!A || A.error) return;
  const r = A.rows.find(x => x.sku === sku && x.location === loc); if (!r) return;
  let steps = r.steps.filter(s => s.lab);
  if (steps.length > 1) steps = steps.filter(s => s.step !== 'Stop reordering');
  steps = steps.slice(0, 3);
  busy('Opening pre-filled decision tabs…');
  try {
    const ws = await api(`/lab/workspace?sku=${encodeURIComponent(sku)}&location=${encodeURIComponent(loc)}`);
    let first = null;
    for (const s of steps){
      const name = s.step === 'Transfer' ? `Transfer ${s.qty} to ${locName(s.to)}` : s.step === 'Discount' ? `Discount ${s.depth_pct}% (uplift assumed)` : s.step;
      const have = ws.tabs.find(t => t.name === name);
      if (have){ first = first || have.tab_id; continue; }
      const t = await api('/lab/tabs', {method:'POST', body:{sku, location:loc, name, decision:s.lab}});
      first = first || t.tab_id;
    }
    openLab(key(sku, loc), first ? {select:first} : undefined);
  } catch (e) { showError(e); } finally { unbusy(); }
}
