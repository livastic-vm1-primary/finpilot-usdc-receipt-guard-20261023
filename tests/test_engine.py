from decimal import Decimal
import copy
import json
from pathlib import Path
import pytest

from finpilot.engine import (IngestAgent, BehaviorAgent, ForecastAgent, AdviceAgent,
                              VerifyAgent, analyze, amount, money, BASE_USDC)

EXAMPLE=Path(__file__).resolve().parents[1]/"data"/"synthetic_ledger.json"
def case():
    return json.loads(EXAMPLE.read_text("utf-8"))

def event(i="a",kind="income",val="5",day="2026-10-20",status="settled"):
    return {"id":i,"kind":kind,"amount":val,"date":day,
            "asset":"USDC","chain":"synthetic","status":status,"category":"tools"}

def test_demo_is_real_not_static():
    data=case()
    x=analyze(data)
    assert x["accepted_rows"]==12
    assert len(x["rejected_rows"])==4
    assert x["behavior"]["income_last_30d_usdc"]=="100.000000"
    assert x["verification"]["grounded_by_internal_reference"] is True
    assert [a["agent"] for a in x["agent_trace"]]==[
        "IngestAgent","BehaviorAgent","ForecastAgent","AdviceAgent","VerifyAgent"]
    y=copy.deepcopy(data);y["balance_usdc"]="1"
    assert analyze(y)["forecast"]["starting_usdc"]=="1.000000"
    assert x["forecast"]["starting_usdc"]!="1.000000"

def test_ledger_excludes_pending_pledges():
    x=IngestAgent().run({"as_of":"2026-10-23","balance_usdc":"0",
       "transactions":[event("promise",val="200",status="pending")]})
    assert x["events"]==[]
    assert x["rejected"][0]["why"]=="not_final_settlement"

def test_self_transfer_is_not_earned():
    data=case();data["transactions"]=[event("own","self_transfer")]
    out=analyze(data)
    assert out["accepted_rows"]==0
    assert out["behavior"]["income_last_30d_usdc"]=="0.000000"

def test_future_event_rejected():
    data=case();data["transactions"]=[event("future",day="2027-01-01")]
    assert analyze(data)["rejected_rows"][0]["why"]=="future_dated"

@pytest.mark.parametrize("bad",["NaN","Infinity","0","-1","0.0000001",True])
def test_invalid_amounts_fail_closed(bad):
    with pytest.raises(ValueError):
        amount(bad)

def test_duplicate_log_different_source_ids_dedup():
    raw=event("one")
    raw.update({"chain":"base","chain_id":8453,
                "token_contract":BASE_USDC,"tx_hash":"0x"+"a"*64,"log_index":3})
    dup={**raw,"id":"other", "amount":"100"}
    out=analyze({"as_of":"2026-10-23","balance_usdc":"0",
                 "transactions":[raw,dup]})
    assert out["accepted_rows"]==1
    assert out["rejected_rows"][0]["why"]=="duplicate_receipt_or_synthetic_key"
    assert out["behavior"]["income_last_30d_usdc"]=="5.000000"

def test_wrong_token_chain_rejected():
    raw=event("bad")
    raw.update({"chain":"base","chain_id":1,
                "token_contract":BASE_USDC,"tx_hash":"0x"+"a"*64,"log_index":3})
    out=analyze({"as_of":"2026-10-23","balance_usdc":"0","transactions":[raw]})
    assert out["accepted_rows"]==0
    assert out["rejected_rows"][0]["why"]=="incorrect_chain_or_noncanonical_asset"

def test_zero_transactions():
    out=analyze({"as_of":"2026-10-23","balance_usdc":"20","transactions":[]})
    assert out["forecast"]["point_end_balance_usdc"]=="20.000000"
    assert out["forecast"]["bootstrap_p05_usdc"]=="20.000000"

def test_duplicate_id_rejected():
    raw=event("same")
    out=analyze({"as_of":"2026-10-23","balance_usdc":"20","transactions":[raw,raw]})
    assert out["accepted_rows"]==1
    assert out["rejected_rows"][0]["why"]=="duplicate_event_id"

def test_forecast_is_deterministic_and_scenario_changes():
    data=case()
    x=analyze(data)["forecast"]
    assert x==analyze(data)["forecast"]
    new=copy.deepcopy(data)
    new["scenario"]["one_time_purchase_usdc"]="200"
    y=analyze(new)["forecast"]
    assert Decimal(y["point_end_balance_usdc"]) < Decimal(x["point_end_balance_usdc"])

def test_unknown_asset_ignored_not_converted():
    raw=event("e");raw["asset"]="ABC"
    out=analyze({"as_of":"2026-10-23","balance_usdc":"0","transactions":[raw]})
    assert out["accepted_rows"]==0
    assert out["rejected_rows"][0]["why"]=="unsupported_asset_no_fx_assumptions"

def test_no_value_leak_via_llm_without_key(monkeypatch):
    monkeypatch.delenv("MESH_API_KEY",raising=False)
    from finpilot.mesh_client import explain_via_mesh
    out=explain_via_mesh(analyze(case()))
    assert out["mode"]=="not_called_no_mesh_key"
    assert not out["eligible_for_mesh_required_hackathon"]

def test_advice_verifier_rejects_fabricated_reference():
    f=analyze(case())["forecast"]
    v=VerifyAgent().run([{"code":"RESERVE","evidence":["unfounded_wallet_profit"],
        "text":"risk free yield"}],{"anomalies":[]},f)
    assert not v["kept"]
    assert v["rejected"][0]["why"]=="unsupported_evidence_reference"

def test_invalid_scenario():
    data=case();data["scenario"]["income_reduction_pct"]=150
    with pytest.raises(ValueError):analyze(data)

def test_exact_usdc_precision():
    assert money(amount("1.000001"))=="1.000001"

def test_json_roundtrip():
    result=analyze(case())
    assert json.loads(json.dumps(result))["forecast"]["sampling"].startswith("500 seeded")
