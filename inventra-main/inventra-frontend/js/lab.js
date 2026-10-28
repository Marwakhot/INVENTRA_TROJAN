/* =====================================================================
   INVENTRA FRONTEND · Scenario Lab, approvals, draft PO, corrections,
   decisions, assistant drawer, boot
   ===================================================================== */

/* ================= explanations ================= */
function renderCited(text, fx){
  return esc(text).replace(/\[([FR]\d+(?:\s*,\s*[FR]\d+)*)\]/g, (m, ids) => ids.split(/\s*,\s*/).map(id => {
    const f = fx.facts.find(x => x.id === id), r = fx.reasons.find(x => x.id === id);
    if (f) return `<button type="button" class="fact" title="${esc(f.label)}: ${esc(f.value)}${f.unit ? ' ' + esc(f.unit) : ''} · ${esc(f.tag)}">${id}</button>`;
    if (r) return `<button type="button" class="fact rsn" title="${esc(r.text)} · ${esc(r.tag)}">${id}</button>`;
    return `<span class="fact" style="color:var(--bad)">${id}?</span>`;
  }).join(''));
}
function factsTable(fx, note){
  return `${note ? `<div class="warnbox">${note}</div>` : ''}<div class="tscroll"><table class="t ftable"><tbody>${fx.facts.map(f => `<tr><td class="mono muted">${f.id}</td><td>${esc(f.label)}</td><td class="r"><b>${esc(typeof f.value === 'number' ? fmt(f.value) : f.value)}${f.unit ? ' ' + esc(f.unit) : ''}</b></td><td>${evTag(f.tag)}</td></tr>`).join('')}${fx.reasons.map(r => `<tr><td class="mono muted">${r.id}</td><td colspan="2">${esc(r.text)}</td><td>${evTag(r.tag)}</td></tr>`).join('')}</tbody></table></div>`;
}
function explainHTML(x){
  if (x.error) return `<div class="warnbox">${esc(x.error)}</div>`;
  if (keyed() && x.text) return `<div class="narr">${renderCited(x.text, x.facts)}</div><div class="row" style="margin-top:10px"><span class="vbadge">${IC.shield} ${esc(x.badge)}</span><span class="note">Backend LLM${x.cached ? ' · cached' : ''}</span></div>`;
  const note = keyed() && x.fallback ? `<b>${esc(x.fallback)}.</b>` : null;
  return `<div class="narr">${renderCited(x.template, x.facts)}</div><div class="row" style="margin:10px 0"><span class="note">${keyed() ? 'Template' : 'Keyless template'} · every figure comes from the fact set</span></div>${factsTable(x.facts, note)}`;
}

/* ================= approvals ================= */
let REASON_CB = null;
function reasonModal(title, text, cb, btn, ph){
  REASON_CB = cb;
  openModal(`<h3>${title}</h3><div class="hint">${text}</div><div class="field" style="margin-top:14px"><label for="rsR">Reason</label><input id="rsR" maxlength="500" placeholder="${esc(ph || 'e.g. Accept the risk at P90; review on Thursday')}"></div><div class="row"><button class="btn sm solid" onclick="const v=$('rsR').value.trim();if(!v){$('rsR').style.borderColor='var(--bad)';return}closeModal();REASON_CB(v)">${esc(btn || 'Approve with reason')}</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(() => $('rsR') && $('rsR').focus(), 50);
}
function approveRec(k){
  const r = recOf(k); if (!r || !r.top) return;
  const o = r.top;
  const send = why => mutate('Approving and re-planning…', () => api('/decisions', {method:'POST', body:{action:'approve', sku:r.sku, location:r.location, option_id:o.option_id, expected_input_hash:r.input_hash, reason:why || null}}));
  if (o.robustness === 'Fragile') return reasonModal('Approve a Fragile option', `${esc(o.label)} fails ${(o.robustness_failing_cases || []).length} of 9 demand and delay cases. A one-line reason is required.`, send);
  send(null);
}
function rejectModal(k){
  const r = recOf(k), o = r.top;
  openModal(`<h3>Reject this option</h3><div class="hint">${esc(r.sku)} → ${esc(locName(r.location))} · ${esc(o.label)}. A reason is required and goes into the decision log.</div>
    <div class="field" style="margin-top:14px"><label for="rjR">Reason</label><textarea id="rjR" rows="3" maxlength="500" placeholder="e.g. Dubai team cannot load a truck before Thursday"></textarea></div>
    <div class="row"><button class="btn sm solid" onclick="doReject(${jsq(k)})">Reject and log</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(() => $('rjR').focus(), 50);
}
function doReject(k){
  const why = $('rjR').value.trim(); if (!why){ $('rjR').style.borderColor = 'var(--bad)'; return; }
  const r = recOf(k); closeModal();
  mutate('Logging the rejection…', () => api('/decisions', {method:'POST', body:{action:'reject', sku:r.sku, location:r.location, option_id:r.top.option_id, reason:why}}));
}

/* ================= draft PO with soft guardrail (N4) ================= */
let PO = {key:null, last:null, t:null};
async function poModal(k){
  const [sku, loc] = k.split('|');
  PO = {key:k, last:null, t:null};
  busy('Preparing the draft PO…');
  let d; try { d = await api('/drafts/po', {method:'POST', body:{sku, location:loc}}); } catch (e) { unbusy(); showError(e); return; }
  unbusy(); PO.last = d;
  const g = d.guardrail.safe_range, p = d.draft_po, ro = d.reorder_plan || {};
  openModal(`<h3>Draft purchase order</h3><div class="hint">${esc(p.supplier)} · ${esc(sku)} ${esc(p.name)} → ${esc(locName(loc))} · ${ro.order_now_note ? esc(ro.order_now_note) : `order by ${dlabIso(p.order_by_date)}`}, arrives ${dlabIso(p.expected_arrival)}. Draft only: never sent.</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:14px"><div class="field"><label for="poQ">Quantity</label><input id="poQ" type="number" min="1" value="${p.prefilled_qty}" oninput="poCheck()"></div><div class="field"><label>Safe range</label><div style="padding:9px 0;font-variant-numeric:tabular-nums"><b>${fmt(g.min_qty_covers_p10_need)} – ${fmt(g.max_qty_max_cover_on_arrival)}</b> units <span class="note">recommended ${fmt(p.prefilled_qty)}</span></div></div></div>
    <div class="note">${esc(d.guardrail.formula)}. Lead time ${p.lead_time.lead_days} days (supplier mean ${r1(p.lead_time.mean_past_lead_days)}${p.lead_time.signals.length ? ' + ' + esc(p.lead_time.signals.join(', ')) + ' ' + p.lead_time.signal_delay_days + ' d' : ''}).${ro.moq_forced_excess ? ' <b>MOQ forces cover above the cap; flagged.</b>' : ''}</div>
    <div class="note" style="margin-top:6px">Assumption shown on every reorder receipt: purchase cost is not counted as a loss because ordered units stay saleable; over-ordering is penalised through holding cost, ageing cost and the max-cover cap.</div>
    <div id="poW"></div><div id="poBtns" class="row" style="margin-top:14px"></div>`);
  poRenderCheck(d);
}
function poCheck(){
  clearTimeout(PO.t);
  PO.t = setTimeout(async () => {
    const [sku, loc] = PO.key.split('|'), q = Math.round(+$('poQ').value || 0);
    if (q <= 0){ $('poW').innerHTML = '<div class="warnbox">Quantity must be positive.</div>'; $('poBtns').innerHTML = ''; return; }
    try { PO.last = await api('/drafts/po', {method:'POST', body:{sku, location:loc, qty:q}}); poRenderCheck(PO.last); } catch (e) { $('poW').innerHTML = `<div class="warnbox">${esc(errMsg(e))}</div>`; }
  }, 350);
}
function poRenderCheck(d){
  const g = d.guardrail, r = g.risk || {};
  let w = '';
  if (!g.in_range && r.units_above_max_cover != null) w = `<div class="warnbox"><b>Above the safe range.</b> ${fmt(r.units_above_max_cover)} units sit above max cover, adding ${aed(r.extra_holding_cost_aed_in_horizon)} of holding cost in 30 days. ${r.note ? esc(r.note) : ''}</div>`;
  else if (!g.in_range && r.units_below_p10_need != null) w = `<div class="warnbox"><b>Below the safe range.</b> ${fmt(r.units_below_p10_need)} units below the P10 need: ${fmt(r.extra_lost_sales_p50)} more units of lost sales at P50 than at the bottom of the range.</div>`;
  $('poW').innerHTML = w;
  $('poBtns').innerHTML = w ? `<button class="btn sm solid" onclick="poToLab()">${IC.flask} Test in Scenario Lab</button><button class="btn sm" onclick="poOverride()">Override with reason</button><button class="btn sm" onclick="closeModal()">Cancel</button>`
    : `<button class="btn sm acc" onclick="poSave(null)">Create draft PO</button><button class="btn sm" onclick="closeModal()">Cancel</button>`;
}
async function poToLab(){
  const [sku, loc] = PO.key.split('|'), q = Math.round(+$('poQ').value); closeModal();
  busy('Opening a Scenario Lab tab for this order…');
  try { const t = await api('/lab/tabs', {method:'POST', body:{sku, location:loc, name:`Draft PO ${q}`, decision:{type:'reorder', location:loc, qty:q}}}); openLab(PO.key, {select:t.tab_id}); }
  catch (e) { showError(e); } finally { unbusy(); }
}
function poOverride(){
  $('poBtns').innerHTML = `<div class="field sp1" style="margin:0"><label for="poR">Reason for override</label><input id="poR" maxlength="500" placeholder="e.g. Supplier price break at this quantity"></div><button class="btn sm solid" style="align-self:flex-end" onclick="const v=$('poR').value.trim();if(!v){$('poR').style.borderColor='var(--bad)';return}poSave(v)">Override and log</button>`;
}
function poSave(reason){
  const [sku, loc] = PO.key.split('|'), q = Math.round(+$('poQ').value), h = PO.last.input_hash;
  closeModal();
  mutate('Saving the draft PO…', async () => {
    const r = await api('/drafts/po', {method:'POST', body:{sku, location:loc, qty:q, save:true, override_reason:reason, expected_input_hash:h}});
    DSELD = r.decision.decision_id; return r;
  }, {goto:'decisions', onError: e => {
    if (e instanceof ApiError && e.status === 422 && /reason/i.test(e.message)){ reasonModal('A reason is required', esc(e.message), why => poSaveWith(sku, loc, q, h, why), 'Save with reason'); return true; }
    return false;
  }});
}
function poSaveWith(sku, loc, q, h, why){
  mutate('Saving the draft PO…', async () => { const r = await api('/drafts/po', {method:'POST', body:{sku, location:loc, qty:q, save:true, override_reason:why, expected_input_hash:h}}); DSELD = r.decision.decision_id; return r; }, {goto:'decisions'});
}

/* ================= corrections (G2, D4) ================= */
function correctModal(o){
  const fields = [['inventory','available'],['inventory','reserved'],['safety_stock','units']];
  const evid = [...new Set((S.validation.issues || []).map(i => i.evidence_record_id).filter(Boolean))];
  openModal(`<h3>Correct a record</h3><div class="hint">Correct once, update everywhere. The original stays in the log; forecast, plan and impact re-run on the server and affected decisions turn Stale. Cite an evidence record where one exists.</div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:14px">
      <div class="field"><label for="crS">SKU</label><select id="crS" onchange="crSync()">${SKUS().map(s => `<option ${s === o.sku ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label for="crL">Location</label><select id="crL" onchange="crSync()">${LOCS.map(l => `<option value="${esc(l.id)}" ${l.id === o.loc ? 'selected' : ''}>${l.name}</option>`).join('')}</select></div>
      <div class="field"><label for="crF">Field</label><select id="crF" onchange="crSync()">${fields.map(([a, b]) => `<option value="${a}.${b}" ${(a === (o.table || 'inventory') && b === o.field) ? 'selected' : ''}>${a === 'safety_stock' ? 'safety stock' : b}</option>`).join('')}</select></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:0"><div class="field"><label>Current value</label><div id="crOld" style="padding:9px 0;font-size:16px;font-weight:600"></div></div><div class="field"><label for="crN">New value</label><input id="crN" type="number" min="0"></div></div>
    <div class="field"><label for="crEv">Evidence record</label><input id="crEv" list="crEvL" value="${esc(o.evidence || '')}" placeholder="e.g. stock_counts:CHG-01|Abu Dhabi|2026-10-27T15:30:00"><datalist id="crEvL">${evid.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
    <div class="field"><label for="crR">Reason</label><input id="crR" maxlength="500" value="${esc(o.reason || '')}" placeholder="e.g. Cycle count on 27 Oct"></div>
    <div class="note" id="crSrc"></div><div id="crMsg"></div>
    <div class="row" style="margin-top:14px"><button class="btn sm acc" onclick="saveCorrection()">Save correction</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
  crSync(o.suggest);
  setTimeout(() => $('crN').select(), 60);
}
function crCurrent(){
  const sku = $('crS').value, loc = $('crL').value, [t, f] = $('crF').value.split('.'), r = (CELL[key(sku, loc)] || {}).stock;
  const v = !r ? null : t === 'safety_stock' ? r.safety_stock : r[f];
  return {sku, loc, t, f, v};
}
function crSync(suggest){
  const c = crCurrent();
  $('crOld').textContent = c.v ? fmt(c.v.value) : '—';
  $('crN').value = suggest != null ? suggest : (c.v ? c.v.value : '');
  $('crSrc').textContent = c.v ? `Source: ${srcOf(c.v)}` : '';
}
function saveCorrection(){
  const c = crCurrent(), nv = Math.round(+$('crN').value), why = $('crR').value.trim(), ev = $('crEv').value.trim();
  if (!why){ $('crR').style.borderColor = 'var(--bad)'; $('crR').placeholder = 'A reason is required'; return; }
  if (c.v && nv === c.v.value){ closeModal(); return; }
  const body = {record_id:`${c.t}:${c.sku}|${c.loc}`, field:c.f, new_value:nv, reason:why, evidence_record_id: ev || null};
  busy('Saving the correction and re-planning…');
  api('/corrections', {method:'POST', body}).then(async res => {
    closeModal(); await loadAll(); showRipple(res.what_changed); refreshChrome(); render(CURRENT, true);
  }).catch(e => {
    if (e instanceof ApiError && e.data && e.data.suggested_evidence_record_id){ $('crEv').value = e.data.suggested_evidence_record_id; $('crMsg').innerHTML = `<div class="warnbox">${esc(e.message)} The latest count says ${esc(e.data.counted_units)}. The evidence field is filled in; check the new value and save again.</div>`; }
    else $('crMsg').innerHTML = `<div class="warnbox">${esc(errMsg(e))}</div>`;
  }).finally(unbusy);
}
function paramModal(name){
  const d = (PARAMS.find(p => p[0] === name) || [])[1] || '';
  openModal(`<h3>Change ${esc(name)}</h3><div class="hint">${esc(d)}. A planning parameter is an Assumption; the change is logged as a correction and re-runs the chain.</div>
    <div class="field" style="margin-top:14px"><label for="pmN">New value</label><input id="pmN" ${name === 'confidence_thresholds' ? 'placeholder="10;25;20"' : 'type="number" step="any" min="0"'}></div>
    <div class="field"><label for="pmR">Reason</label><input id="pmR" maxlength="500" placeholder="e.g. Finance policy update"></div><div id="pmMsg"></div>
    <div class="row"><button class="btn sm acc" onclick="saveParam(${jsq(name)})">Save and re-plan</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
}
function saveParam(name){
  const nv = $('pmN').value.trim(), why = $('pmR').value.trim();
  if (!why){ $('pmR').style.borderColor = 'var(--bad)'; return; } if (!nv){ $('pmN').style.borderColor = 'var(--bad)'; return; }
  busy('Saving the parameter and re-planning…');
  api('/corrections', {method:'POST', body:{record_id:'planning_parameters:' + name, field:'value', new_value:nv, reason:why}}).then(async res => {
    closeModal(); await loadAll(); showRipple(res.what_changed); refreshChrome(); render(CURRENT, true);
  }).catch(e => { $('pmMsg').innerHTML = `<div class="warnbox">${esc(errMsg(e))}</div>`; }).finally(unbusy);
}

/* ================= DECISIONS (R1, R2) ================= */
let DSELD = null, RECALC = {};
/* the Decisions section view (log, track record, record review) lives in decisions.js */
const kvVal = v => v == null ? '—' : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} ${typeof b === 'object' ? JSON.stringify(b) : b}`).join(' · ') : typeof v === 'number' ? fmt(v) : String(v);
function decisionDoc(d){
  const R = d.receipt || {}, ch = R.chosen || {}, econ = (R.constraints_checked || {}).economic || {};
  const rc = RECALC[d.decision_id];
  const cons = R.constraints_checked || {};
  const consRows = [
    ['Safety stock under P90', cons.safety_stock && cons.safety_stock.pass, (cons.safety_stock && cons.safety_stock.failures || []).join('; ') || 'no new breach'],
    ['Reserved stock untouched', cons.reserved_stock && cons.reserved_stock.pass, cons.reserved_stock && cons.reserved_stock.rule],
    ['Availability (within spare)', cons.availability && cons.availability.pass, (cons.availability && cons.availability.failures || []).join('; ') || 'legs within spare'],
    ['Lead time inside horizon', cons.lead_time && cons.lead_time.pass, cons.lead_time && cons.lead_time.rule],
    ['Economic (net > 0)', econ.pass, econ.net_benefit_aed != null ? `net ${aed(econ.net_benefit_aed)}` : '']
  ];
  const lt = R.lead_time_breakdown || {};
  return `
  ${d.status === 'Stale' ? `<div class="warnbox rv" style="--d:.06s;margin-top:14px"><b>Stale.</b> An input this decision used has changed (input hash ${esc(d.input_hash)} no longer matches). The decision released its spare-stock lock.
    ${rc ? (rc.recommendation ? `<div style="margin-top:8px">Recalculated: <b>${esc(rc.recommendation.label)}</b> · ${esc(actText(rc.recommendation.decision))} · net ${aed(rc.recommendation.net_benefit_aed)} (was ${esc(d.chosen.label)}).</div>` : '<div style="margin-top:8px">Recalculated: no action needed any more.</div>') : ''}
    <div class="row" style="margin-top:10px">${rc && rc.recommendation ? `<button class="btn sm acc" onclick="approveRecalc(${jsq(d.decision_id)})">Approve the recalculated option</button>` : `<button class="btn sm acc" onclick="recalc(${jsq(d.decision_id)})">Recalculate</button>`}<button class="btn sm" onclick="openLab(${jsq(key(d.sku, d.location))})">Open in the Lab</button></div></div>` : ''}
  <div class="grid">
    <div class="doc span-7 rv" style="--d:.1s">
      <div class="dh"><div><span class="lbl">Decision receipt</span><h3>${esc(d.decision_id)} · ${esc(ch.label || d.chosen.label)}</h3><div class="hint">${esc(d.sku)} ${esc(R.sku_name || '')} → ${esc(locName(d.location))} · ${esc(d.approver)}, ${tlab(d.timestamp)}${d.node_id ? ` · from tree node ${esc(d.node_id)}` : ''}${d.path_id ? ` · ${esc(d.path_id)}` : ''}</div></div><span class="pill ${esc(d.status)}">${esc(d.status)}</span></div>
      ${d.reason ? `<div class="warnbox" style="margin-top:0"><b>${d.status === 'Rejected' ? 'Rejected' : d.status === 'Overridden' ? 'Override' : 'Reason'}:</b> ${esc(d.reason)}</div>` : ''}
      ${R.path ? `<div class="note">Path: ${R.path.map(p => esc(p.label)).join(' → ')}</div>` : ''}
      <h4>Chosen option</h4>
      <div class="brief-row"><div><span class="lbl">Net vs Do nothing</span><b>${aed(ch.net_benefit_aed)}</b></div><div><span class="lbl">Lost sales avoided</span><b>${fmt(econ.lost_sales_avoided)}</b></div><div><span class="lbl">Direct cost</span><b>${aed(econ.direct_cost_aed)}</b></div><div><span class="lbl">Robustness</span><b>${esc((R.robustness || {}).label || '—')}</b></div></div>
      ${(R.robustness || {}).failing_cases && R.robustness.failing_cases.length ? `<div class="note" style="margin-top:6px">Failing cases: ${R.robustness.failing_cases.map(esc).join('; ')}</div>` : ''}
      ${R.draft_po ? `<h4>Draft PO</h4><div class="formula">${esc(R.draft_po.status)} · ${fmt(R.draft_po.qty)} units · order by ${dlabIso(R.draft_po.order_by_date)} · arrives ${dlabIso(R.draft_po.expected_arrival)} · safe range ${fmt(R.guardrail.safe_range.min_qty_covers_p10_need)}–${fmt(R.guardrail.safe_range.max_qty_max_cover_on_arrival)}${R.guardrail.in_range ? '' : ' · outside the safe range'}</div>` : ''}
      <h4>Rejected options and why they lost</h4>
      ${(R.rejected_options || []).map(x => `<div class="rej"><div><b>${esc(x.label)}</b><div class="${(x.failing_checks || []).length ? 'why' : 'muted'}" style="font-size:12px">${esc(x.why)}</div></div><div class="r num-t">${sgn(x.net_benefit_aed)}</div></div>`).join('') || '<div class="empty">No other option was generated.</div>'}
      <h4>Inputs</h4>
      <div class="tscroll"><table class="t ftable"><thead><tr><th>Input</th><th class="r">Value</th><th>Tag</th><th>Source</th></tr></thead><tbody>${(R.inputs || []).map(f => `<tr><td>${esc(f.label)}</td><td class="r"><b>${esc(kvVal(f.value))}</b>${f.unit ? ` <span class="muted">${esc(f.unit)}</span>` : ''}</td><td>${evTag(f.tag)}</td><td class="mono" style="font-size:10.5px">${esc(f.source_file ? srcOf(f) : f.formula || (f.changed_by ? 'changed by ' + f.changed_by : ''))}</td></tr>`).join('')}</tbody></table></div>
      <h4>Constraints checked</h4>
      ${consRows.map(([n, ok, det]) => `<div class="chk"><span class="bx ${ok ? 'y' : 'n'}">${ok ? '✓' : '✕'}</span><div><b>${esc(n)}</b><div class="muted">${esc(det || '')}</div></div><span></span></div>`).join('')}
      <h4>Lead-time breakdown</h4>
      ${lt.legs ? lt.legs.map(l => `<div class="formula">Transfer ${esc(l.from)} → ${esc(l.to)}: ${l.lane_lead_days} day(s) · dispatch ${dlabIso(l.dispatch_date)} · arrive ${dlabIso(l.arrival_date)}</div>`).join('') : ''}
      ${lt.lead_days != null ? `<div class="formula">L_supplier = mean of past lead times ${r1(lt.mean_past_lead_days)}${lt.signal_delay_days ? ` + ${esc((lt.signals || []).join(', '))} ${lt.signal_delay_days}` : ''} = ${lt.lead_days} days · order ${dlabIso(lt.order_date)} · arrive ${dlabIso(lt.arrival_date)}</div>` : ''}
      ${lt.po_id ? `<div class="formula">${esc(lt.po_id)}: ETA ${dlabIso(lt.eta)}${lt.signal_delay_days ? ` + ${lt.signal_delay_days} d signal delay` : ''} · arrival ${dlabIso(lt.arrival_before)} → ${dlabIso(lt.arrival_after)}</div>` : ''}
      <h4>Formulas</h4>
      ${(R.formulas || []).map(f => `<div class="formula">${esc(f)}</div>`).join('')}
      ${(R.assumptions || []).map(a => `<div class="note" style="margin-top:6px">Assumption: ${esc(a)}</div>`).join('')}
      ${R.tested_under_tree_assumptions ? `<div class="note" style="margin-top:6px">Tested in the Lab under sandbox assumptions: ${esc(JSON.stringify(R.tested_under_tree_assumptions))}</div>` : ''}
      <div class="note mono" style="margin-top:14px;font-size:10.5px">Input hash ${esc(R.input_hash || d.input_hash)}</div>
    </div>
    <div class="stack span-5">
      <div class="doc rv" style="--d:.14s"><div class="dh"><div><span class="lbl">Staff instructions</span><h3>${esc(d.sku)} → ${esc(locName(d.location))}</h3></div>${d.status === 'Rejected' ? '<span class="pill Rejected">Not issued</span>' : d.status === 'Stale' ? '<span class="pill Stale">Hold</span>' : ''}</div>
        ${(R.staff_instructions || []).length ? R.staff_instructions.map((s, i) => `<div class="q-item" style="grid-template-columns:30px minmax(0,1fr)"><span class="n">${i+1}</span><div><div class="ss" style="color:var(--ink)">${esc(s)}</div></div></div>`).join('') : '<div class="empty">Wait for inbound: no staff action.</div>'}
        <div class="note" style="margin-top:10px">Decision support only. Inventra never executes transfers or sends purchase orders.</div>
        <div class="row" style="margin-top:14px"><button class="btn sm solid" onclick="downloadBrief(${jsq(d.decision_id)})">${IC.dl} Download (.md)</button><button class="btn sm" onclick="copyBrief(${jsq(d.decision_id)})">${IC.copy} Copy text</button></div>
      </div>
    </div>
  </div>`;
}
function briefText(d){
  const R = d.receipt || {};
  return `# Staff instructions ${d.decision_id}\n${d.sku} ${R.sku_name || ''} → ${locName(d.location)}\n${d.status} by ${d.approver}, ${tlab(d.timestamp)}\n\n` + ((R.staff_instructions || []).map((s, i) => `${i + 1}. ${s}`).join('\n') || 'Wait for inbound: no staff action.') + `\n\nDecision support only. Generated by Inventra from fictional data. Input hash ${R.input_hash || d.input_hash}.`;
}
function decCached(id){ const b = LAZY.dec || {}; const k = Object.keys(b).find(x => x.startsWith(id + '#') && b[x] && b[x].decision_id); return k ? b[k] : null; }
function downloadBrief(id){ const d = decCached(id); if (d) download(`staff-instructions-${id}.md`, briefText(d)); }
function copyBrief(id){ const d = decCached(id); if (!d) return; const t = briefText(d); try { navigator.clipboard.writeText(t).then(() => toast('Copied'), () => fallbackCopy(t)); } catch (e) { fallbackCopy(t); } }
function fallbackCopy(t){ openModal(`<h3>Copy the instructions</h3><textarea id="cpT" rows="12" style="width:100%;margin-top:10px;font-family:var(--mono);font-size:12px;background:var(--surface);color:var(--ink);border:1px solid var(--line);padding:10px">${esc(t)}</textarea><div class="row" style="margin-top:10px"><button class="btn sm" onclick="closeModal()">Done</button></div>`); setTimeout(() => $('cpT').select(), 50); }
async function recalc(id){
  busy('Recalculating on the server…');
  try { RECALC[id] = await api(`/decisions/${encodeURIComponent(id)}/recalculate`, {method:'POST'}); }
  catch (e) { showError(e); }
  finally { unbusy(); render('decisions', true); }
}
function approveRecalc(id){
  const rc = RECALC[id], d = S.decisions.find(x => x.decision_id === id), o = rc.recommendation;
  const send = why => mutate('Approving the recalculated option…', async () => { const r = await api('/decisions', {method:'POST', body:{action:'approve', sku:d.sku, location:d.location, option_id:o.option_id, expected_input_hash:rc.current_input_hash, reason:why || null}}); DSELD = r.decision.decision_id; delete RECALC[id]; return r; });
  if (o.robustness === 'Fragile') return reasonModal('Approve a Fragile option', `${esc(o.label)} fails some demand and delay cases. A one-line reason is required.`, send);
  send(null);
}

/* ================= INVENTRA DRAWER: what-if and explanations ================= */
const CHIPS_K = ['What if we also reorder 50 power banks for Abu Dhabi?', 'What if we move 60 USB-C 20W chargers from Sharjah to Abu Dhabi?', 'Explain the top recommendation'];
const CHIPS_L = ['Explain the top recommendation', 'Explain CHG-01 in Abu Dhabi', 'Explain CBL-02 in Abu Dhabi'];
function renderChips(){ $('drChips').innerHTML = (keyed() ? CHIPS_K : CHIPS_L).map(c => `<button onclick="ask(this.textContent)">${esc(c)}</button>`).join(''); }
function syncPilotMode(){
  document.querySelectorAll('#modeSeg button').forEach(b => { b.classList.toggle('on', b.dataset.m === (keyed() ? 'live' : 'local')); if (b.dataset.m === 'live') b.disabled = !serverKeyed(); });
  const inp = $('drInp'), note = $('drKeyless'); if (!inp) return;
  inp.style.display = keyed() ? '' : 'none'; note.style.display = keyed() ? 'none' : '';
  renderChips();
}
function setMode(m){ if (m === 'live' && !serverKeyed()) return; LOCAL_KEYLESS = m === 'local'; try { localStorage.setItem('inventra-keyless', LOCAL_KEYLESS ? '1' : '0'); } catch (e) {} refreshChrome(); render(CURRENT, true); }
function openPilot(q){
  $('drawer').classList.add('open'); $('scrim').classList.add('on');
  syncPilotMode();
  if (!$('chat').children.length) addBub('g', {html:`Hello ${esc(plannerName())}. I have two jobs. I explain computed results, citing every figure so it can be checked. When the backend has an LLM key I also turn a typed what-if into scenario-builder fields for you to check and run. I never compute a number, run a scenario or choose which decision to test.`});
  if (q && q.trim()) ask(q); else setTimeout(() => { if (keyed()) $('q').focus(); }, 350);
}
function closePilot(){ $('drawer').classList.remove('open'); $('scrim').classList.remove('on'); }
function addBub(role, o){ const c = $('chat'), d = document.createElement('div'); d.className = 'bub ' + (role === 'u' ? 'u' : 'g'); if (o.text !== undefined) d.textContent = o.text; else d.innerHTML = o.html; c.appendChild(d); c.scrollTop = c.scrollHeight; return d; }
async function ask(q){
  if (!q || !q.trim()) return;
  addBub('u', {text:q}); $('q').value = '';
  const bub = addBub('g', {html:'<span class="typing"><span></span><span></span><span></span></span>'});
  if (/^\s*(explain|why)/i.test(q) || !keyed()){
    const code = (q.match(/\b[A-Z]{3}-\d{2}\b/i) || [])[0], loc = /abu dhabi|auh/i.test(q) ? 'Abu Dhabi' : /sharjah|shj/i.test(q) ? 'Sharjah' : /dubai|dxb/i.test(q) ? 'Dubai' : null;
    const withTop = RECS.filter(x => x.top);
    const r = code ? (withTop.find(x => x.sku === code.toUpperCase() && (!loc || x.loc === loc)) || withTop.find(x => x.sku === code.toUpperCase())) : withTop[0];
    if (!r){
      const dk = code && key(code.toUpperCase(), loc || ''), dec = dk && ['Approved','Overridden'].includes((activeDecision(dk) || {}).status) ? activeDecision(dk) : null;
      bub.innerHTML = dec ? `${esc(code.toUpperCase())} in ${esc(locName(loc))} already has an approved decision (${esc(dec.decision_id)}: ${esc(dec.chosen.label)}). Its receipt lists the inputs, checks and reasons.<button class="bact" onclick="closePilot();openDecision(${jsq(dec.decision_id)})">Open the receipt</button>`
        : 'That is not in the data: no open recommendation exists for that SKU and location.';
      return;
    }
    try {
      const x = await api(`/explain/recommendation?sku=${encodeURIComponent(r.sku)}&location=${encodeURIComponent(r.loc)}`);
      bub.innerHTML = `<div style="margin-bottom:6px"><b>${esc(r.sku)} → ${esc(locName(r.loc))}</b></div>` + explainHTML(x) + `<button class="bact" onclick="openLab(${jsq(r.key)})">Open ${esc(r.sku)} → ${esc(locName(r.loc))} in the Lab</button>`;
    } catch (e) { bub.innerHTML = esc(errMsg(e)); }
    $('chat').scrollTop = $('chat').scrollHeight; return;
  }
  const r = await askWhatIf(q);
  if (!r || r.text){ bub.innerHTML = esc(r ? r.text : 'No answer.'); return; }
  const m = r.last;
  bub.innerHTML = m.kind === 'interpretation' ? `<b>I read this as:</b> (tab ${esc(r.tab.letter)}, nothing has run)<div style="margin-top:6px">${readingTable(m.builder)}</div><button class="bact" onclick="closePilot();go('lab')">Confirm or edit in the Lab</button>` : esc(m.text || '');
  $('chat').scrollTop = $('chat').scrollHeight;
}

/* ================= RESET + BOOT ================= */
function resetDemo(){ openModal(`<h3>Reset the demo</h3><div class="hint">Reloads the seeded dataset on the server and clears inbox events, corrections, signal edits, decision trees and decisions.</div><div class="row" style="margin-top:14px"><button class="btn sm solid" onclick="doReset()">Reset</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`); }
async function doReset(){
  closeModal(); busy('Reloading the seeded dataset…');
  try {
    await api('/reset', {method:'POST'});
    ANSWERED = {}; try { localStorage.setItem('inventra-answered', '{}'); localStorage.removeItem('inventra-trees'); } catch (e) {}
    LAB = {key:null, ws:null, wsAt:null, sel:null, tabs:{}, ticks:[], mode:'tabs', cmp:null, ev:null, form:null, showSettings:true, loading:false};
    DSELD = null; RP = null; RECALC = {};
    await loadAll(); refreshChrome(); go('home'); toast('Seeded dataset reloaded');
  } catch (e) { showError(e); }
  finally { unbusy(); }
}
document.addEventListener('keydown', e => {
  if (!$('intro').classList.contains('gone')) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing){ e.preventDefault(); openPilot(); }
  if (e.key === 'Escape'){ closePilot(); closeModal(); }
});
function setTheme(t){
  const dark = t === 'dark';
  if (dark) document.documentElement.setAttribute('data-sp', 'dark'); else document.documentElement.removeAttribute('data-sp');
  const b = $('themeBtn'); if (b){ b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode'); b.title = dark ? 'Light mode' : 'Dark mode'; }
}
function toggleTheme(){ const t = document.documentElement.getAttribute('data-sp') === 'dark' ? 'light' : 'dark'; setTheme(t); try { localStorage.setItem('inventra-theme', t); } catch (e) {} }
let POLL = null;
async function boot(){
  try {
    busy('Loading the plan from the Inventra API…');
    await loadAll();
    hideApiDown();
    refreshChrome();
    const h = location.hash.slice(1); go(ORDER.includes(h) ? h : CURRENT);
    if (!POLL) POLL = setInterval(pollEvents, 6000);
  } catch (e) { if (!(e instanceof ApiError && e.status === 0)) { showApiDown(); $('apiDown').querySelector('span').textContent = errMsg(e); } }
  finally { unbusy(); }
}
function init(){
  try { setTheme(localStorage.getItem('inventra-theme') || 'light'); } catch (e) { setTheme('light'); }
  renderDock(); renderWhere();
  $('qSend').innerHTML = IC.send;
  $('bell').insertAdjacentHTML('afterbegin', IC.bell);
  boot();
}
init();
$('app').addEventListener('animationend', e => { if (e.target === $('app')) $('app').classList.remove('enter'); });
