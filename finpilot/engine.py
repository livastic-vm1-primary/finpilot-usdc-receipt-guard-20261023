"""Four cooperating deterministic financial agents.

This module does not contact an RPC, access a wallet, place trades, or execute
transactions. All inputs are synthetic or explicitly supplied by the caller.
No fiat conversion or claims about USDC's market price are performed.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
import random
import statistics
from typing import Any

BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
SIX = Decimal("0.000001")
MAX_RECORDS = 3000

def amount(value: Any) -> Decimal:
    if isinstance(value, bool):
        raise ValueError("boolean is not a monetary amount")
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("invalid monetary amount") from exc
    if not d.is_finite() or d <= 0 or d > Decimal("100000000"):
        raise ValueError("amount outside strictly positive accepted range")
    if d.as_tuple().exponent < -6:
        raise ValueError("USDC amounts permit at most 6 decimals")
    return d

def money(value: Decimal | int | float) -> str:
    return str(Decimal(str(value)).quantize(SIX, rounding=ROUND_HALF_UP))

def ratio(value: float) -> str:
    return format(value, ".3f")

def as_date(value: Any) -> date:
    if not isinstance(value, str):
        raise ValueError("date must be ISO8601 YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("invalid YYYY-MM-DD") from exc

@dataclass(frozen=True)
class Event:
    id: str
    day: date
    kind: str
    amount: Decimal
    category: str
    source_key: str

class IngestAgent:
    """Deduplicate receipts and fail closed on token, chain and finality."""

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("expected object")
        as_of = as_date(payload.get("as_of"))
        items = payload.get("transactions")
        if not isinstance(items, list) or len(items) > MAX_RECORDS:
            raise ValueError("transactions must be a list of at most 3000 rows")
        if not isinstance(payload.get("balance_usdc"), (int, float, str, Decimal)):
            raise ValueError("balance_usdc required")
        balance = Decimal(str(payload["balance_usdc"]))
        if not balance.is_finite() or balance < 0 or balance > 100000000:
            raise ValueError("invalid nonnegative balance")
        if balance.as_tuple().exponent < -6:
            raise ValueError("balance exceeds 6 USDC decimals")

        events: list[Event] = []
        rejected: list[dict[str, str]] = []
        seen_ids: set[str] = set()
        seen_source_keys: set[str] = set()
        for index, row in enumerate(items):
            if not isinstance(row, dict):
                raise ValueError(f"transaction[{index}] not object")
            event_id = row.get("id")
            if not isinstance(event_id, str) or not (1 <= len(event_id) <= 100):
                raise ValueError(f"transaction[{index}].id invalid")
            if event_id in seen_ids:
                rejected.append({"id": event_id, "why": "duplicate_event_id"})
                continue
            seen_ids.add(event_id)
            when = as_date(row.get("date"))
            if when > as_of:
                rejected.append({"id": event_id, "why": "future_dated"})
                continue
            if row.get("asset") != "USDC":
                rejected.append({"id": event_id, "why": "unsupported_asset_no_fx_assumptions"})
                continue
            kind = row.get("kind")
            if kind not in {"income", "expense", "refund", "self_transfer"}:
                raise ValueError(f"transaction[{index}].kind must be income, expense, refund or self_transfer")
            value = amount(row.get("amount"))
            if row.get("status") != "settled":
                rejected.append({"id": event_id, "why": "not_final_settlement"})
                continue
            if kind == "self_transfer":
                rejected.append({"id": event_id, "why": "internal_transfer_not_revenue"})
                continue

            chain = row.get("chain")
            if chain == "base":
                if row.get("chain_id") != 8453 or str(row.get("token_contract", "")).lower() != BASE_USDC.lower():
                    rejected.append({"id": event_id, "why": "incorrect_chain_or_noncanonical_asset"})
                    continue
                tx = row.get("tx_hash")
                li = row.get("log_index")
                if not isinstance(tx, str) or len(tx) != 66 or not tx.startswith("0x"):
                    rejected.append({"id": event_id, "why": "missing_transaction_receipt_id"})
                    continue
                try:
                    int(tx[2:], 16)
                except ValueError:
                    rejected.append({"id": event_id, "why": "malformed_tx_hash"})
                    continue
                if type(li) is not int or li < 0:
                    rejected.append({"id": event_id, "why": "missing_event_log_index"})
                    continue
                source_key = f"eip155:8453:{tx.lower()}:{li}"
            elif chain == "synthetic":
                # No claim that synthetic evidence is a real onchain receipt.
                source_key = f"synthetic:{event_id}"
            else:
                rejected.append({"id": event_id, "why": "unsupported_chain_or_missing_provenance"})
                continue

            if source_key in seen_source_keys:
                rejected.append({"id": event_id, "why": "duplicate_receipt_or_synthetic_key"})
                continue
            seen_source_keys.add(source_key)
            category = str(row.get("category", "uncategorized"))[:60]
            events.append(Event(event_id, when, kind, value, category, source_key))
        return {"as_of": as_of, "events": events, "rejected": rejected,
                "balance": balance, "source_count": len(items)}

class BehaviorAgent:
    """Summarize 30/60/90 day behavior and flag demonstrable outliers."""

    def run(self, ingested: dict[str, Any]) -> dict[str, Any]:
        today: date = ingested["as_of"]
        events: list[Event] = ingested["events"]
        incoming = [Decimal(0)] * 3
        outgoing = [Decimal(0)] * 3
        by_category: dict[str, list[Decimal]] = defaultdict(list)
        expense_events: list[Event] = []
        ninety_days: list[dict[str, Decimal]] = [
            {"income": Decimal(0), "expense": Decimal(0)} for _ in range(90)
        ]
        for item in events:
            age = (today - item.day).days
            if age < 0 or age >= 90:
                continue
            bucket = min(2, age // 30)
            position = 89 - age
            if item.kind == "income":
                incoming[bucket] += item.amount
                ninety_days[position]["income"] += item.amount
            elif item.kind in ("expense", "refund"):
                outgoing[bucket] += item.amount
                ninety_days[position]["expense"] += item.amount
                if item.kind == "expense":
                    by_category[item.category].append(item.amount)
                    expense_events.append(item)

        anomalies: list[dict[str, str]] = []
        for item in expense_events:
            peers = by_category[item.category]
            if len(peers) < 3:
                continue
            med = Decimal(str(statistics.median(peers)))
            if med > 0 and item.amount > 3 * med:
                anomalies.append({
                    "id": item.id, "category": item.category, "observed": money(item.amount),
                    "category_median": money(med),
                    "reason": "more_than_three_times_category_median",
                })
        return {
            "incoming": incoming, "outgoing": outgoing,
            "categories": {key: money(sum(vals)) for key, vals in sorted(by_category.items())},
            "anomalies": anomalies, "daily": ninety_days,
            "recent_net": incoming[0] - outgoing[0],
            "retained_event_count": len(events),
        }

class ForecastAgent:
    """Deterministic scenario forecast plus seeded empirical daily Monte Carlo."""

    def run(self, ingested: dict[str, Any], behavior: dict[str, Any],
            scenario: dict[str, Any] | None = None) -> dict[str, Any]:
        scenario = scenario or {}
        if not isinstance(scenario, dict):
            raise ValueError("scenario must be object")
        added = Decimal(str(scenario.get("monthly_extra_spend_usdc", "0")))
        purchase = Decimal(str(scenario.get("one_time_purchase_usdc", "0")))
        drop = Decimal(str(scenario.get("income_reduction_pct", "0")))
        if any(not x.is_finite() for x in [added,purchase,drop]) or not (0 <= added <= 1e7 and 0 <= purchase <= 1e7 and 0 <= drop <= 100):
            raise ValueError("scenario values must be nonnegative finite; reduction 0–100%")
        weights = [Decimal(".5"), Decimal(".3"), Decimal(".2")]
        monthly_in = sum(v * w for v, w in zip(behavior["incoming"],weights)) * (100-drop)/100
        monthly_out = sum(v * w for v, w in zip(behavior["outgoing"],weights)) + added
        initial = ingested["balance"]
        point = initial + monthly_in - monthly_out - purchase

        # Daily empirical distribution, not an invented return model.
        daily = behavior["daily"]
        seed_material = json.dumps([ingested["as_of"].isoformat(), money(initial),
                                    money(added), money(purchase), money(drop)],
                                   separators=(",",":"))
        seed = int(hashlib.sha256(seed_material.encode()).hexdigest()[:16],16)
        randomizer = random.Random(seed)
        net_samples = []
        for _ in range(500):
            synthetic_income = Decimal(0)
            synthetic_expense = Decimal(0)
            for _ in range(30):
                row = daily[randomizer.randrange(90)]
                synthetic_income += row["income"]
                synthetic_expense += row["expense"]
            net_samples.append(
                initial + synthetic_income*(100-drop)/100 - synthetic_expense - added - purchase
            )
        net_samples.sort()
        low = net_samples[25]
        middle = net_samples[249]
        high = net_samples[474]
        risk = sum(x < 0 for x in net_samples)/len(net_samples)
        return {
            "starting_usdc": money(initial),
            "forecast_monthly_income_usdc": money(monthly_in),
            "forecast_monthly_expense_usdc": money(monthly_out),
            "one_time_purchase_usdc": money(purchase),
            "point_end_balance_usdc": money(point),
            "bootstrap_p05_usdc": money(low),
            "bootstrap_p50_usdc": money(middle),
            "bootstrap_p95_usdc": money(high),
            "empirical_shortfall_probability": ratio(risk),
            "sampling": "500 seeded resamples of observed daily USDC transactions (not a calibrated future distribution)",
        }

class AdviceAgent:
    """Generate precise interventions without investment instructions."""

    def run(self, behavior: dict[str, Any], forecast: dict[str, Any]) -> list[dict[str, Any]]:
        advice: list[dict[str, Any]] = []
        reserve = Decimal(forecast["forecast_monthly_expense_usdc"])
        baseline = Decimal(forecast["starting_usdc"])
        point = Decimal(forecast["point_end_balance_usdc"])
        if Decimal(forecast["bootstrap_p05_usdc"]) < 0:
            advice.append({
                "code":"SHORTFALL",
                "text":"The empirical p05 scenario is below zero; reduce optional planned spending before committing new funds.",
                "evidence":["bootstrap_p05_usdc","empirical_shortfall_probability"],
            })
        if baseline < reserve:
            advice.append({
                "code":"RESERVE",
                "text":"The supplied balance is below the weighted 30-day spending estimate; check essential outflows first.",
                "evidence":["starting_usdc","forecast_monthly_expense_usdc"],
            })
        if behavior["anomalies"]:
            advice.append({
                "code":"ANOMALY_REVIEW",
                "text":"One or more settled expense events exceeded three times their category median; verify these entries before forecasting.",
                "evidence":["expense_anomaly_event_ids"],
            })
        if not advice:
            advice.append({
                "code":"STABLE_OBSERVED",
                "text":"No threshold rule triggered on the supplied synthetic or user-provided USDC ledger. This does not ensure future solvency.",
                "evidence":["point_end_balance_usdc","bootstrap_p05_usdc"],
            })
        return advice

class VerifyAgent:
    """Confirm advice has source identifiers; refuse numeric hallucinations."""

    REQUIRED = {
        "SHORTFALL":{"bootstrap_p05_usdc","empirical_shortfall_probability"},
        "RESERVE":{"starting_usdc","forecast_monthly_expense_usdc"},
        "ANOMALY_REVIEW":{"expense_anomaly_event_ids"},
        "STABLE_OBSERVED":{"point_end_balance_usdc","bootstrap_p05_usdc"},
    }

    def run(self, advice: list[dict[str, Any]], behavior: dict[str, Any],
            forecast: dict[str, Any]) -> dict[str, Any]:
        kept, rejected = [], []
        for proposal in advice:
            code = proposal.get("code")
            evidence = set(proposal.get("evidence") or [])
            valid = code in self.REQUIRED and self.REQUIRED[code].issubset(evidence)
            valid = valid and all(k in forecast or
                (k == "expense_anomaly_event_ids" and bool(behavior["anomalies"]))
                for k in evidence)
            if valid:
                kept.append(proposal)
            else:
                rejected.append({"code":code,"why":"unsupported_evidence_reference"})
        return {"kept": kept, "rejected": rejected, "verified":len(kept)==len(advice)}

def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    ingest = IngestAgent().run(payload)
    behavior = BehaviorAgent().run(ingest)
    forecast = ForecastAgent().run(ingest, behavior, payload.get("scenario"))
    draft = AdviceAgent().run(behavior,forecast)
    verified = VerifyAgent().run(draft,behavior,forecast)
    if not verified["kept"]:
        draft = [{"code":"STABLE_OBSERVED","text":"No verified recommendation available.",
                  "evidence":["point_end_balance_usdc","bootstrap_p05_usdc"]}]
        verified = VerifyAgent().run(draft,behavior,forecast)
    return {
        "as_of":ingest["as_of"].isoformat(),
        "asset":"USDC", "data_origin":payload.get("data_origin","caller_supplied"),
        "scope":"local evidence-grounded simulation; not investment or tax advice",
        "accepted_rows":len(ingest["events"]),
        "rejected_rows":ingest["rejected"],
        "behavior":{
            "income_last_30d_usdc":money(behavior["incoming"][0]),
            "expense_last_30d_usdc":money(behavior["outgoing"][0]),
            "net_last_30d_usdc":money(behavior["recent_net"]),
            "category_spend_usdc":behavior["categories"],
            "anomalies":behavior["anomalies"],
        },
        "forecast":forecast,
        "advice":verified["kept"],
        "verification":{"kept":len(verified["kept"]),"rejected":verified["rejected"],
                        "grounded_by_internal_reference":verified["verified"]},
        "agent_trace":[
            {"agent":"IngestAgent","event":"accepted_and_deduplicated",
             "accepted":len(ingest["events"]),"rejected":len(ingest["rejected"])},
            {"agent":"BehaviorAgent","event":"historical_baselines_and_anomalies",
             "expense_anomalies":len(behavior["anomalies"])},
            {"agent":"ForecastAgent","event":"empirical_simulation_completed",
             "samples":500},
            {"agent":"AdviceAgent","event":"advice_proposed","count":len(draft)},
            {"agent":"VerifyAgent","event":"recommendations_grounded",
             "accepted":len(verified["kept"]),"rejected":len(verified["rejected"])},
        ],
    }
