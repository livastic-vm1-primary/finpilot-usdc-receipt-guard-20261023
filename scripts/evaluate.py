#!/usr/bin/env python3
"""Honest offline held-out quality check for FinPilot with synthetic USDC only."""
from __future__ import annotations
from copy import deepcopy
from datetime import date,timedelta
from decimal import Decimal
import json
import random
from pathlib import Path

from finpilot.engine import BASE_USDC,analyze

def evaluate() -> dict:
    rng=random.Random(20261023)
    today=date(2026,10,23)
    tests=40
    true_positive=true_negative=false_positive=false_negative=0
    stable=0
    monotonic=0
    verifier_ok=0
    cases=[]
    for i in range(tests):
        records=[]
        labels=[]
        for j in range(12):
            should_accept=j%6 in (0,1,5)
            entry={
                "id":f"case{i}-event{j}", "date":str(today-timedelta(days=rng.randrange(3,85))),
                "kind":"income" if j%2 else "expense","amount":f"{rng.randrange(1,75)}.000000",
                "asset":"USDC", "status":"settled","chain":"synthetic",
                "category":rng.choice(["rent","tools","subscriptions"]),
            }
            if j%6==2:entry["status"]="pending"
            if j%6==3:entry["kind"]="self_transfer"
            if j%6==4:entry["asset"]="TEST"
            records.append(entry)
            labels.append(should_accept)
        payload={"as_of":str(today),"balance_usdc":str(50+rng.randrange(1,100)),
                 "transactions":records,"data_origin":"synthetic_generated_eval"}
        report=analyze(payload)
        actual_accept=report["accepted_rows"]
        expected_accept=sum(labels)
        true_positive+=min(actual_accept,expected_accept)
        false_positive+=max(0,actual_accept-expected_accept)
        false_negative+=max(0,expected_accept-actual_accept)
        true_negative+=len(labels)-max(actual_accept,expected_accept)
        if report["forecast"]==analyze(payload)["forecast"]:stable+=1
        variant=deepcopy(payload);variant["scenario"]={"one_time_purchase_usdc":"15"}
        other=analyze(variant)
        if Decimal(other["forecast"]["point_end_balance_usdc"]) == (
            Decimal(report["forecast"]["point_end_balance_usdc"])-Decimal(15)
        ):monotonic+=1
        if report["verification"]["grounded_by_internal_reference"]:verifier_ok+=1
        cases.append({"id":i,"expected_accepted":expected_accept,
                      "actual_accepted":actual_accept,"row_count":len(labels)})
    recall=true_positive/max(1,true_positive+false_negative)
    specificity=true_negative/max(1,true_negative+false_positive)
    return {
        "source":"independently seeded synthetic cases generated in this file",
        "not_real_world_predictive_accuracy":True,
        "Mesh_model_called":False,
        "cases":tests,"rows":tests*12,
        "expected_valid_receipts":true_positive+false_negative,
        "expected_invalid_receipts":true_negative+false_positive,
        "receipt_filter_recall":round(recall,3),
        "receipt_filter_specificity":round(specificity,3),
        "deterministic_replays_matching":stable,
        "point_forecast_scenario_monotonic_15usdc":monotonic,
        "advice_reference_verification_passed":verifier_ok,
        "individual_case_summaries":cases,
    }

if __name__=="__main__":
    import sys
    report=evaluate()
    dest=Path(__file__).resolve().parents[1]/"reports"/"synthetic_evaluation.json"
    dest.parent.mkdir(exist_ok=True,parents=True)
    dest.write_text(json.dumps(report,indent=2)+"\n",encoding="utf8")
    print("Cases:",report["cases"],"receipt rows:",report["rows"])
    print("Synthetic recall:",report["receipt_filter_recall"],
          "specificity:",report["receipt_filter_specificity"])
    print("Determinism:",report["deterministic_replays_matching"],
          "scenario monotonic:",report["point_forecast_scenario_monotonic_15usdc"],
          "reference verified:",report["advice_reference_verification_passed"])
    print("Report:",dest)
    if not (report["receipt_filter_recall"]==report["receipt_filter_specificity"]==1 and
            report["deterministic_replays_matching"]==report["cases"] and
            report["point_forecast_scenario_monotonic_15usdc"]==report["cases"] and
            report["advice_reference_verification_passed"]==report["cases"]):
        sys.exit(1)
