"""Read models for the Inventory tab (planner view): ranked product list, product tab,
draft-PO impact strip and the Ageing tab. Every figure comes from the engine and carries
its evidence label (Data, Calculated, Assumption). Nothing here changes the plan."""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np

from . import candidates as cand
from . import plan as planmod
from . import views
from .engine import Engine

STATUS_RANK = {"Critical": 0, "Watch": 1, "Healthy": 2}
BANDS = [("0-30", 0, 30), ("31-60", 31, 60), ("61-90", 61, 90), ("90+", 91, 10 ** 6)]
DISCOUNT_DEPTH_PCT, DISCOUNT_UPLIFT_PCT, DISCOUNT_UPLIFT_RANGE = 15.0, 20.0, (10.0, 30.0)
FASTER_SELL_RATIO = 1.5


# ---------------------------------------------------------------------- shared helpers
def _order_by(eng: Engine, sku: str, loc: str) -> Optional[int]:
    bday = eng.breach_day(sku, loc)
    if bday is None:
        return None
    return bday - eng.supplier_lead(sku)[0] - eng.p("review_buffer_days")


def _status(c: Dict[str, Any]) -> str:
    """Critical: the breach comes before the fastest feasible fix (transfer or order) can land.
    Watch: a breach within the horizon that can still be fixed in time. Healthy: no breach."""
    if c["breach_day"] is None:
        return "Healthy"
    return "Critical" if c.get("urgency") == "Critical" else "Watch"


def _qty(eng: Engine, sku: str, loc: str) -> Dict[str, Any]:
    """Recommended reorder quantity and its range from the P10 and P90 demand need."""
    q = {p: cand.reorder_plan(eng, sku, loc, p) for p in ("P10", "P50", "P90")}
    v = {p: (r["decision"]["qty"] if r else 0) for p, r in q.items()}
    return {"qty": v["P50"], "low": min(v.values()), "high": max(v.values()), "plan": q["P50"], "p90_plan": q["P90"]}


def _incoming(eng: Engine, sku: str, loc: str) -> int:
    return int(sum(a["qty"] for a in eng.inbound(sku) if a["loc"] == loc))


def _data_issue(eng: Engine, sku: str, loc: str) -> Optional[Dict[str, Any]]:
    fc = eng.fc[(sku, loc)]
    oos, miss = [int(d) for d in fc.oos_days], [int(d) for d in fc.imputed_days]
    # Missing days only count when they drop forecast confidence to Low; stockout days always understate demand
    if not oos and fc.confidence != "Low":
        return None
    return {"stockout_days": oos, "missing_days": miss, "confidence": fc.confidence}


def _best_transfer(eng: Engine, plan: Dict[str, Any], sku: str, loc: str, need: float) -> Optional[Dict[str, Any]]:
    spare = (plan.get("spare_before_allocation") or {}).get(sku, {})
    best = None
    for src, units in spare.items():
        if src == loc or units < 1:
            continue
        if best is None or units > best["spare"]:
            lane = eng.lane(src, loc)
            best = {"from": src, "spare": int(math.floor(units)), "lead_days": int(lane["lead_days"]),
                    "cost_per_unit_aed": lane["cost_per_unit_aed"], "fixed_cost_aed": lane["fixed_cost_aed"]}
    if best:
        best["qty"] = int(min(best["spare"], need)) if need > 0 else best["spare"]
        best["tag"] = "Calculated"
        best["formula"] = "Spare = lowest projected stock at P90 demand and maximum delay - safety stock"
    return best


def _cell(eng: Engine, plan: Dict[str, Any], cells: Dict[Tuple[str, str], Dict[str, Any]], sku: str, loc: str) -> Dict[str, Any]:
    st = eng.state
    inv = st.inventory[(sku, loc)]
    c = cells[(sku, loc)]
    ob = _order_by(eng, sku, loc)
    status = _status(c)
    q = _qty(eng, sku, loc) if status != "Healthy" else None
    lost_units = c["projected_lost_sales_p50"]
    out = {
        "location": loc, "status": status, "flags": c["flags"],
        "excess": "Excess" in c["flags"], "aged_units": c["aged_units"], "ageing_units": c["ageing_units"],
        "available": inv["available"], "reserved": inv["reserved"], "free": st.free(sku, loc),
        "incoming": _incoming(eng, sku, loc), "safety_stock": st.safety.get((sku, loc), 0),
        "cover_days": c["cover_days"],
        "breach_day": c["breach_day"],
        "order_by_day": ob, "order_by_date": str(st.plan_date(ob)) if ob is not None else None,
        "lost_units_30d": lost_units,
        "lost_sales_aed_30d": round(lost_units * st.skus[sku]["unit_price"], 2),
        "data_issue": _data_issue(eng, sku, loc),
        "approved_decision_id": c.get("approved_decision_id"),
    }
    if q:
        out["units_to_order"] = {"qty": q["qty"], "low": q["low"], "high": q["high"], "tag": "Calculated",
                                 "formula": "P50 demand x (lead time + review period) + safety stock - free - incoming, "
                                            "rounded to MOQ and pack; range from P10 and P90 demand"}
        out["transfer"] = _best_transfer(eng, plan, sku, loc, q["qty"])
    return out


def _cells(plan: Dict[str, Any]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    return {(c["sku"], c["location"]): c for c in plan["cells"]}


# ---------------------------------------------------------------------- list
def inventory_list(eng: Engine, plan: Dict[str, Any]) -> Dict[str, Any]:
    st = eng.state
    cells = _cells(plan)
    rows = []
    for sku in sorted(st.skus):
        locs = {l: _cell(eng, plan, cells, sku, l) for l in eng.locs if (sku, l) in st.inventory}
        if not locs:
            continue
        worst = sorted(locs.values(), key=lambda x: (STATUS_RANK[x["status"]], -x["lost_sales_aed_30d"],
                                                       x["order_by_day"] if x["order_by_day"] is not None else 999))[0]
        aged_locs = [l for l, x in locs.items() if x["aged_units"] > 0]
        signals = sorted(set(eng.supplier_lead(sku)[1]["signals"]) |
                         {i for l in locs for i in eng.fc[(sku, l)].signal_ids} |
                         {i for a in eng.inbound(sku) for i in a.get("signals", [])})
        all_ = {
            "location": worst["location"] if worst["status"] != "Healthy" else None,
            "status": worst["status"],
            "flags": sorted({f for x in locs.values() for f in x["flags"]}),
            "excess": any(x["excess"] for x in locs.values()),
            "aged_units": sum(x["aged_units"] for x in locs.values()),
            "ageing_units": sum(x["ageing_units"] for x in locs.values()),
            **{k: sum(x[k] for x in locs.values()) for k in ("available", "reserved", "free", "incoming", "safety_stock")},
            "order_by_day": worst["order_by_day"], "order_by_date": worst["order_by_date"],
            "units_to_order": worst.get("units_to_order"), "transfer": worst.get("transfer"),
            "lost_units_30d": round(sum(x["lost_units_30d"] for x in locs.values()), 1),
            "lost_sales_aed_30d": round(sum(x["lost_sales_aed_30d"] for x in locs.values()), 2),
            "data_issue": next((x["data_issue"] for x in locs.values() if x["data_issue"]), None),
        }
        for l, x in locs.items():
            x["aged_elsewhere"] = [o for o in aged_locs if o != l]
        all_["aged_elsewhere"] = [o for o in aged_locs if o != all_["location"]] if all_["location"] else []
        rows.append({"sku": sku, "name": st.skus[sku]["name"], "category": st.skus[sku]["category"],
                     "signals": signals, "all": all_, "locations": locs})
    return {
        "planning_day": str(st.day90), "horizon_days": eng.H, "locations": eng.locs, "rows": rows,
        "rules": {
            "Critical": "Projected stock falls below safety stock before the fastest feasible fix (transfer or order) can arrive",
            "Watch": f"Projected stock falls below safety stock within {eng.H} days, and a fix can still arrive in time",
            "Healthy": f"Projected stock stays above safety stock for {eng.H} days",
            "Excess": f"Free stock plus inbound above {eng.p('max_cover_days')} days of P50 cover (planning parameter)",
            "Ageing": f"Batches older than {eng.p('ageing_days')} days in the stock-age data",
            "Data issue": "Stockout days understate demand, or gaps in the history drop forecast confidence to Low",
            "Order by": "Date projected stock (P50, likely delay) falls below safety stock - planning lead time - review buffer",
            "Lost sales": "Lost units at P50 demand under Do nothing x unit price",
            "Ranking": "Expected lost sales in AED, highest first; ties by the nearest order-by date",
        },
    }


# ---------------------------------------------------------------------- product tab
def _lead_receipt(eng: Engine, sku: str) -> Dict[str, Any]:
    st = eng.state
    sup = st.skus[sku]["supplier"]
    lh = st.lead_history
    rows = lh[lh["supplier"] == sup]
    days = sorted((r - o).days for o, r in zip(rows["order_date"], rows["received_date"]))
    L, info = eng.supplier_lead(sku)
    out = {"supplier": sup, "deliveries": len(days), "lead_days": L, "signals": info["signals"],
           "signal_delay_days": info["signal_delay_days"], "review_buffer_days": eng.p("review_buffer_days"),
           "review_period_days": eng.p("review_period_days"),
           "rule": "Planning lead time = past deliveries mean, rounded up, + delay from supplied signals that name this SKU's components"}
    if days:
        out.update({"median_days": float(np.median(days)), "mean_days": round(float(np.mean(days)), 2),
                    "slowest_20pct_days": float(np.percentile(days, 80)), "verified": True})
    else:
        out.update({"mean_days": info["mean_past_lead_days"], "verified": False,
                    "note": "No delivery history for this supplier: the default lead time is used, unverified (Assumption)"})
    return out


def _qty_receipt(eng: Engine, sku: str, loc: str) -> Optional[Dict[str, Any]]:
    q = _qty(eng, sku, loc)
    ro = q["plan"]
    if not ro:
        return None
    L, R = ro["lead"]["lead_days"], ro["review_period_days"]
    srow = eng.state.skus[sku]
    return {"cover_days": L + R, "d50_daily": ro["d50_daily"], "demand_p50": round(ro["d50_daily"] * (L + R), 1),
            "safety_stock": ro["safety_stock"], "free": ro["free"], "incoming": ro["open_inbound"],
            "raw_qty": ro["raw_qty"], "moq": srow["moq"], "pack_size": srow["pack_size"],
            "qty": q["qty"], "low": q["low"], "high": q["high"], "capped": ro["capped"],
            "max_cover_cap": ro["max_cover_cap"], "moq_forced_excess": ro["moq_forced_excess"],
            "extrapolated": ro["extrapolated"], "formula": ro["formula"]}


def _extend(path: np.ndarray, rate: float, days: int, arrivals: Dict[int, float]) -> List[float]:
    out, s = [], float(path[-1])
    for t in range(len(path) + 1, days + 1):
        s += arrivals.get(t, 0.0) - rate
        out.append(s)
    return out


def _series(eng: Engine, sku: str, loc: str, order: Optional[Dict[str, Any]], days: int) -> Dict[str, List[float]]:
    H = eng.H
    p = {k: eng.stock_path(sku, loc, k, "likely") for k in ("P10", "P50", "P90")}
    fc = eng.fc[(sku, loc)]
    late = {a["day"]: a["qty"] for a in eng.inbound(sku) if a["loc"] == loc and a["day"] > H}
    out = {}
    for k in ("P10", "P50", "P90"):
        rate = float(fc.daily(k)[-7:].mean())
        out[k] = [float(x) for x in p[k]] + (_extend(p[k], rate, days, late) if days > H else [])
    if order:
        po = eng.stock_path(sku, loc, "P50", "likely", [order])
        arr = dict(late)
        a_day = eng.supplier_lead(sku)[0] + order["order_day"]
        if a_day > H:
            arr[a_day] = arr.get(a_day, 0.0) + order["qty"]
        out["order"] = [float(x) for x in po] + (_extend(po, float(fc.daily("P50")[-7:].mean()), days, arr) if days > H else [])
    return out


def product(eng: Engine, plan: Dict[str, Any], sku: str, location: str, days: int = 30) -> Dict[str, Any]:
    st = eng.state
    if sku not in st.skus:
        raise KeyError(sku)
    locs = [l for l in eng.locs if (sku, l) in st.inventory] if location == "All" else [location]
    if not locs or any((sku, l) not in st.inventory for l in locs):
        raise KeyError((sku, location))
    days = max(eng.H, min(int(days), 90))
    cells = _cells(plan)
    per = {l: _cell(eng, plan, cells, sku, l) for l in eng.locs if (sku, l) in st.inventory}
    for l, x in per.items():
        x["aged_elsewhere"] = [o for o, y in per.items() if o != l and y["aged_units"] > 0]
    stock_rows = {r["location"]: r for r in views.stock(eng, plan, sku)}
    srow = st.skus[sku]

    orders, series = {}, {}
    for l in locs:
        ro = cand.reorder_plan(eng, sku, l)
        orders[l] = ro["decision"] if ro else None
        series[l] = _series(eng, sku, l, orders[l], days)
    n = days
    agg = {k: [round(sum(series[l][k][t] for l in locs), 1) for t in range(n)] for k in ("P10", "P50", "P90")}
    with_order = None
    if any(orders.values()):
        with_order = [round(sum((series[l].get("order") or series[l]["P50"])[t] for l in locs), 1) for t in range(n)]

    hist = []
    for t in range(-29, 1):
        i = st.history_days - 1 + t
        obs = [eng.fc[(sku, l)].history for l in locs]
        missing = any(h.missing[i] for h in obs)
        hist.append({"plan_day": t, "date": str(st.plan_date(t)),
                     "units": None if missing else round(float(sum(h.observed[i] for h in obs)), 1),
                     "out_of_stock": bool(any(h.oos[i] for h in obs)), "missing": bool(missing)})

    one = location != "All"
    cell = per[location] if one else None
    ro = cand.reorder_plan(eng, sku, location) if one else None
    banner = None
    if one and cell["order_by_day"] is not None:
        L = eng.supplier_lead(sku)[0]
        ob = cell["order_by_day"]
        arrival = max(0, ob) + L
        banner = {"order_by_day": ob, "order_by_date": cell["order_by_date"], "lead_days": L,
                  "review_buffer_days": eng.p("review_buffer_days"),
                  "arrival_day": arrival, "arrival_date": str(st.plan_date(arrival)),
                  "breach_day": cell["breach_day"], "breach_date": str(st.plan_date(cell["breach_day"])),
                  "passed": ob < 0, "gap_days": max(0, arrival - cell["breach_day"]) if ob <= 0 else 0,
                  "lost_before_arrival": ro["lost_before_arrival"] if ro else None}

    fcs = [eng.fc[(sku, l)] for l in locs]
    dq = {"stockout_days": sorted({int(d) for f in fcs for d in f.oos_days}),
          "missing_days": sorted({int(d) for f in fcs for d in f.imputed_days}),
          "observed_total": round(sum(f.observed_total for f in fcs), 1),
          "corrected_total": round(sum(f.corrected_total for f in fcs), 1),
          "confidence": "Low" if any(f.confidence == "Low" for f in fcs) else fcs[0].confidence,
          "demand_30d": {k: round(sum(f.total(k) for f in fcs), 1) for k in ("P10", "P50", "P90")}}
    dq["correction_pct"] = round((dq["corrected_total"] / dq["observed_total"] - 1) * 100, 1) if dq["observed_total"] else None
    acc = views.accuracy(eng)["wape"]

    sig_ids = sorted(set(eng.supplier_lead(sku)[1]["signals"]) | {i for f in fcs for i in f.signal_ids} |
                     {i for a in eng.inbound(sku) if a["loc"] in locs for i in a.get("signals", [])})
    sigs = [{k: s.get(k) for k in ("signal_id", "date", "source", "type", "status", "delay_likely", "uplift_likely", "source_file")}
            for s in st.signals if s["signal_id"] in sig_ids]

    return {
        "sku": sku, "name": srow["name"], "category": srow["category"], "location": location, "locations": list(per),
        "status": cell["status"] if one else sorted(per.values(), key=lambda x: STATUS_RANK[x["status"]])[0]["status"],
        "cells": per,
        "cards": {
            "available": {"value": sum(per[l]["available"] for l in locs), "tag": "Data",
                          "source": [views._lin(eng, st.inventory[(sku, l)]["record_id"]) for l in locs]},
            "reserved": {"value": sum(per[l]["reserved"] for l in locs), "tag": "Data"},
            "free": {"value": sum(per[l]["free"] for l in locs), "tag": "Calculated", "formula": "Available - Reserved"},
            "incoming": {"value": sum(per[l]["incoming"] for l in locs), "tag": "Data",
                         "orders": [x for l in locs for x in stock_rows[l]["incoming"]]},
            "safety_stock": {"value": sum(per[l]["safety_stock"] for l in locs), "tag": "Data"},
            "cover_days": {"value": cell["cover_days"] if one else None, "tag": "Calculated", "formula": "Free / P50 daily demand"},
        },
        "chart": {"days": n, "history": hist, "p50": agg["P50"], "band_low": agg["P90"], "band_high": agg["P10"],
                  "with_order": with_order, "safety_stock": sum(per[l]["safety_stock"] for l in locs),
                  "inbound": [{"plan_day": a["day"], "qty": a["qty"], "po_id": a["po_id"]}
                              for a in eng.inbound(sku) if a["loc"] in locs and a["day"] <= n],
                  "extrapolated_from_day": eng.H + 1 if n > eng.H else None,
                  "confidence_note": f"Days {eng.H + 1} to {n} extend the last week's daily rate: Low confidence, the history is only "
                                     f"{st.history_days} days" if n > eng.H else None,
                  "band_note": "Band = projected stock under P90 demand (low) to P10 demand (high)"
                               + ("; summed across locations, so it is wider than a joint band" if not one else "")},
        "order_by": banner,
        "receipt": {"lead_time": _lead_receipt(eng, sku), "quantity": _qty_receipt(eng, sku, location) if one else None},
        "data_quality": {**dq, "wape": acc.get("inventra"), "wape_baseline": acc.get("baseline_recent_average")},
        "signals": sigs,
        "transfer": cell.get("transfer") if one else None,
        "aged_elsewhere": [{"location": l, "aged_units": per[l]["aged_units"]} for l in (cell["aged_elsewhere"] if one else [])],
        "supplier": srow["supplier"], "unit_cost": srow["unit_cost"], "unit_price": srow["unit_price"],
        "moq": srow["moq"], "pack_size": srow["pack_size"],
    }


# ---------------------------------------------------------------------- draft PO impact strip
def _lost(eng: Engine, sku: str, loc: str, decisions: List[Dict[str, Any]], pct: str) -> float:
    return round(eng.simulate(sku, decisions, pct, "likely").locs[loc].lost, 1)


def po_impact(eng: Engine, sku: str, loc: str, qty: int, order_day: int) -> Dict[str, Any]:
    st = eng.state
    dec = {"type": "reorder", "sku": sku, "location": loc, "qty": int(qty), "order_day": int(order_day)}
    base, opt = eng.simulate(sku, []), eng.simulate(sku, [dec])
    net = eng.net(sku, opt, base)
    q = _qty(eng, sku, loc)
    rec_net = rec_hold = None
    if q["qty"]:
        rec = eng.net(sku, eng.simulate(sku, [dict(dec, qty=q["qty"])]), base)
        rec_net, rec_hold = rec["net_benefit_aed"], rec["delta_holding_aed"] + rec["delta_ageing_aed"]
    L = eng.supplier_lead(sku)[0]
    arrival = order_day + L
    bday = eng.breach_day(sku, loc)
    p90_need = q["high"]
    return {
        "order_cost_aed": round(qty * st.skus[sku]["unit_cost"], 2), "unit_cost_aed": st.skus[sku]["unit_cost"],
        "moq": st.skus[sku]["moq"], "pack_size": st.skus[sku]["pack_size"],
        "arrival_day": arrival, "arrival_date": str(st.plan_date(arrival)),
        "lost_units": {p: {"before": _lost(eng, sku, loc, [], p), "after": _lost(eng, sku, loc, [dec], p)} for p in ("P50", "P90")},
        "lost_units_basis": "Units of demand not served in 30 days at this location, likely delay",
        "holding_added_aed": net["delta_holding_aed"], "ageing_added_aed": net["delta_ageing_aed"],
        "net_benefit_aed": net["net_benefit_aed"], "recommended_net_benefit_aed": rec_net,
        "recommended_holding_and_ageing_aed": rec_hold,
        "lost_sales_avoided": net["lost_sales_avoided"],
        "recommended": {"qty": q["qty"], "low": q["low"], "high": q["high"]},
        "units_above_p90_need": max(0, int(qty) - p90_need) if p90_need else int(qty),
        "units_below_p10_need": max(0, q["low"] - int(qty)),
        "checks": {"arrives_before_breach": {"pass": bday is None or arrival <= bday,
                                             "breach_date": str(st.plan_date(bday)) if bday is not None else None},
                   "within_p90_need": {"pass": int(qty) <= max(p90_need, 0) or not q["high"], "p90_qty": p90_need}},
        "tag": "Calculated",
    }


# ---------------------------------------------------------------------- Ageing tab
def _fifo_ageing(eng: Engine, sku: str, loc: str, threshold: int) -> Dict[str, Any]:
    """Selling oldest first at P50 demand: which free units cross the threshold unsold within the horizon."""
    free_b, _, _ = eng._opening_batches(sku, loc)
    cum = np.cumsum(eng.demand(sku, loc, "P50"))
    ahead, crossing, cross_day = 0.0, 0.0, None
    for units, age, _bid in sorted(free_b, key=lambda x: -x[1]):
        if age < threshold:
            t = int(threshold - age)
            if t <= eng.H:
                sold_before = float(cum[t - 1]) if t >= 1 else 0.0
                left = max(0.0, min(units, ahead + units - sold_before))
                if left > 0.5:
                    crossing += left
                    cross_day = t if cross_day is None else min(cross_day, t)
        ahead += units
    return {"units": int(round(crossing)), "cross_day": cross_day}


def ageing_list(eng: Engine, plan: Dict[str, Any], decisions: List[Dict[str, Any]],
                seasonal_tags: Iterable[str] = ()) -> Dict[str, Any]:
    st = eng.state
    b = st.batches
    threshold = int(eng.p("aged_days"))
    tags = set(seasonal_tags)
    active = {(d["sku"], d["location"]): d["decision_id"] for d in decisions if d["status"] in planmod.ACTIVE}
    rows, unknown = [], []
    for (sku, loc) in sorted(st.inventory):
        grp = b[(b["sku"] == sku) & (b["location"] == loc)] if not b.empty else b
        if not len(grp):
            if st.inventory[(sku, loc)]["available"] > 0:
                unknown.append({"sku": sku, "name": st.skus[sku]["name"], "location": loc,
                                "units": st.inventory[(sku, loc)]["available"]})
            continue
        bands = {k: int(grp[(grp["age_days"] >= lo) & (grp["age_days"] <= hi)]["units"].sum()) for k, lo, hi in BANDS}
        aged = int(grp[grp["age_days"] >= threshold]["units"].sum())
        fifo = _fifo_ageing(eng, sku, loc, threshold)
        if not aged and not fifo["units"]:
            continue
        srow = st.skus[sku]
        cost, margin = srow["unit_cost"], st.margin(sku)
        rate = st.holding.get(loc, 0.0)
        aged_grp = grp[grp["age_days"] >= threshold]
        held = float((aged_grp["units"] * aged_grp["age_days"]).sum()) * rate
        units = aged + fifo["units"]
        oldest = int(grp["age_days"].max())
        steps = _steps(eng, plan, sku, loc, units, aged, rate, margin, f"{sku}|{loc}" in tags)
        rows.append({
            "sku": sku, "name": srow["name"], "location": loc, "bands": bands, "oldest_days": oldest,
            "oldest_band_units": int(grp[grp["age_days"] == oldest]["units"].sum()),
            "aged_units": aged, "ageing_units_30d": fifo["units"],
            "value_at_cost_aed": round(units * cost, 2), "holding_cost_so_far_aed": round(held, 2),
            "crosses_day": fifo["cross_day"],
            "crosses_date": str(st.plan_date(fifo["cross_day"])) if fifo["cross_day"] is not None else None,
            "steps": steps, "suggested": steps[0] if steps else None,
            "seasonal_tag": f"{sku}|{loc}" in tags,
            "seasonal_note": None if any(s["step"] == "Hold" for s in steps) else "No seasonal signal found",
            "decision_id": active.get((sku, loc)),
        })
    rows.sort(key=lambda r: (-r["oldest_days"], -r["oldest_band_units"]))
    return {
        "threshold_days": threshold, "threshold_tag": "Assumption",
        "threshold_note": "Planner-set planning parameter (aged_days). The case study supplies stock-age data but no thresholds.",
        "cards": {"aged_units": sum(r["aged_units"] for r in rows),
                  "ageing_units_30d": sum(r["ageing_units_30d"] for r in rows),
                  "value_at_risk_aed": round(sum(r["value_at_cost_aed"] for r in rows), 2),
                  "holding_cost_so_far_aed": round(sum(r["holding_cost_so_far_aed"] for r in rows), 2)},
        "rows": rows, "age_unknown": unknown,
        "rules": {"Aged": f"Units already {threshold}+ days old in the stock-age data (Data)",
                  "Ageing": f"Units that pass {threshold} days within {eng.H} days at P50 demand, selling oldest first (Calculated)",
                  "Holding cost so far": "Aged units x days on the shelf x holding cost per unit-day at the location",
                  "Value at cost": "(Aged + ageing) units x unit cost"},
    }


def _demand_signal(eng: Engine, sku: str, loc: str) -> Optional[str]:
    for s in eng.state.signals:
        if s.get("include") is False or s["type"] != "demand":
            continue
        if sku in (s.get("skus") or []) and loc in (s.get("locations") or []) and (s.get("uplift_likely") or 0) > 0:
            return s["signal_id"]
    return None


def _steps(eng: Engine, plan, sku: str, loc: str, units: int, aged: int, rate: float, margin: float,
           tagged: bool) -> List[Dict[str, Any]]:
    st = eng.state
    out: List[Dict[str, Any]] = []
    d_here = eng.d50(sku, loc)
    hold_30 = round(units * rate * eng.H, 2)
    # Transfer: another location sells faster and can take the units without going into excess
    best = None
    for dst in eng.locs:
        if dst == loc or (sku, dst) not in st.inventory:
            continue
        d_dst = eng.d50(sku, dst)
        room = eng.p("max_cover_days") * d_dst - st.free(sku, dst) - _incoming(eng, sku, dst)
        if d_dst >= FASTER_SELL_RATIO * max(d_here, 1e-6) and room >= min(units, 1):
            if best is None or d_dst > best[1]:
                best = (dst, d_dst, int(max(0, min(units, room))))
    if best and best[2] > 0:
        dst, d_dst, qty = best
        lane = eng.lane(loc, dst)
        ratio = d_dst / max(d_here, 1e-6)
        out.append({"step": "Transfer", "reason": f"{dst} sells {ratio:.1f}x faster", "tag": "Calculated",
                    "to": dst, "qty": qty, "lead_days": int(lane["lead_days"]),
                    "cost_aed": round(lane["fixed_cost_aed"] + lane["cost_per_unit_aed"] * qty, 2),
                    "lab": {"type": "transfer", "from": loc, "to": dst, "qty": qty}})
    sig = _demand_signal(eng, sku, loc)
    seasonal = bool(sig or tagged)
    if seasonal:
        exp_margin = round(units * margin, 2)
        out.append({"step": "Hold", "reason": f"seasonal signal {sig}" if sig else "planner tagged as seasonal",
                    "tag": "Data" if sig else "Assumption", "holding_cost_aed": hold_30, "expected_margin_aed": exp_margin,
                    "warning": "Holding cost is higher than the expected margin" if hold_30 > exp_margin else None,
                    "lab": {"type": "wait", "location": loc}})
    # Discount only when nothing stronger applies (Hold rules it out) and carrying the units costs more than the price cut
    if not out and aged:
        margin_lost = round(units * st.skus[sku]["unit_price"] * DISCOUNT_DEPTH_PCT / 100, 2)
        age_cost = round(units * st.skus[sku]["unit_cost"] * eng.p("ageing_cost_pct_per_30_days") / 100, 2)
        if hold_30 + age_cost >= margin_lost:
            out.append({"step": "Discount", "reason": f"assumed uplift {DISCOUNT_UPLIFT_PCT:g}% "
                                                      f"({DISCOUNT_UPLIFT_RANGE[0]:g} to {DISCOUNT_UPLIFT_RANGE[1]:g}%)",
                        "tag": "Assumption", "depth_pct": DISCOUNT_DEPTH_PCT, "margin_lost_aed": margin_lost,
                        "holding_and_ageing_cost_aed": round(hold_30 + age_cost, 2),
                        "lab": {"type": "discount", "location": loc, "units": int(units),
                                "depth_pct": DISCOUNT_DEPTH_PCT, "uplift_pct": DISCOUNT_UPLIFT_PCT}})
    stronger = bool(out)
    out.append({"step": "Stop reordering", "reason": "aged or ageing stock on hand here", "tag": "Calculated",
                "blocks_order": True, "lab": {"type": "wait", "location": loc}})
    if aged and not stronger:
        out.append({"step": "Liquidate or write off", "reason": "last resort: nothing else clears the units",
                    "tag": "Calculated", "loss_aed": round(aged * st.skus[sku]["unit_cost"], 2), "lab": None})
    return out
