"""HTTP-level tests prevent a working engine from masking a broken API."""
import copy
import json
from pathlib import Path
from fastapi.testclient import TestClient
from finpilot.app import app

client=TestClient(app)
ROOT=Path(__file__).resolve().parents[1]

def test_liveness_endpoint():
    r=client.get('/health')
    assert r.status_code==200
    assert r.json()['status']=='ok'

def test_html_exposes_real_demo_button():
    r=client.get('/')
    assert r.status_code==200
    assert 'Run fully synthetic data' in r.text
    assert 'fetch("/demo")' in r.text
    assert 'MESH_API_KEY' not in r.text

def test_demo_is_computed():
    data=client.get('/demo').json()
    assert data["input"]["data_origin"].startswith("fully_synthetic")
    assert data["output"]["accepted_rows"]==12
    assert data["output"]["verification"]["grounded_by_internal_reference"]

def test_post_matches_get_and_tracks_each_agent():
    d=client.get('/demo').json()
    result=client.post('/analyze',json=d["input"])
    assert result.status_code==200
    assert result.json()["forecast"]==d["output"]["forecast"]
    assert len(result.json()["agent_trace"])==5

def test_mesh_fails_closed_with_no_token(monkeypatch):
    monkeypatch.delenv("MESH_API_KEY",raising=False)
    d=client.get('/demo').json()["input"]
    r=client.post('/analyze',json={**d,"with_mesh":True})
    assert r.status_code==200
    assert r.json()["mesh"]["mode"]=="not_called_no_mesh_key"
    assert not r.json()["mesh"]["eligible_for_mesh_required_hackathon"]

def test_invalid_amount_422():
    d=client.get('/demo').json()["input"]
    bad=copy.deepcopy(d);bad["transactions"][0]["amount"]="not-a-number"
    r=client.post('/analyze',json=bad)
    assert r.status_code==422

def test_public_example_contains_no_wallet_keys():
    assert ".env" in (ROOT/".gitignore").read_text("utf8")
    assert "MESH_API_KEY=" in (ROOT/".env.example").read_text('utf8')
    assert "private_key" not in (ROOT/"data"/"synthetic_ledger.json").read_text('utf8').lower()
