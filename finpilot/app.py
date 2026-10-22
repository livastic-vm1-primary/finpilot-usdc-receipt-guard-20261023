"""FastAPI facade; read-only finances simulation, no chain calls."""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from finpilot.engine import analyze
from finpilot.mesh_client import explain_via_mesh

ROOT=Path(__file__).resolve().parents[1]
app=FastAPI(title="FinPilot Receipt Guard",version="0.1.0",
            description="Source-grounded, synthetic-USDC multi-agent planning. No trading or wallet interactions.")

class RunRequest(BaseModel):
    as_of: str
    balance_usdc: str
    transactions: list[dict[str,Any]]=Field(default_factory=list,max_length=3000)
    scenario: dict[str,Any]=Field(default_factory=dict)
    data_origin: str = "caller_supplied"
    with_mesh: bool = False

@app.get("/health")
def health() -> dict[str,str]:
    return {"status":"ok","model":"no live chain; Mesh optional; deterministic engine operational"}

@app.get("/demo")
def demo() -> dict[str,Any]:
    data=json.loads((ROOT/"data"/"synthetic_ledger.json").read_text("utf-8"))
    return {"input":data,"output":analyze(data)}

@app.post("/analyze")
def run(request: RunRequest) -> dict[str,Any]:
    data=request.model_dump()
    try:
        report=analyze(data)
        if request.with_mesh:
            report["mesh"]=explain_via_mesh(report)
        return report
    except ValueError as exc:
        raise HTTPException(status_code=422,detail=str(exc)) from exc
    except Exception:
        # No traces or credentials sent to the client.
        raise HTTPException(status_code=502, detail="Optional Mesh service request failed; try offline analysis.") from None

@app.get("/",response_class=HTMLResponse)
def index()->str:
    return """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>FinPilot Receipt Guard</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:900px;margin:3rem auto;padding:0 1rem;background:#fbfcfe;color:#182230}
article{background:white;border:1px solid #d8dfe9;border-radius:12px;padding:1rem;margin:1rem 0}
code,pre{white-space:pre-wrap;word-break:break-word;font-size:13px}
button{padding:10px 15px;border:0;border-radius:6px;background:#2240a5;color:white;cursor:pointer}
small{color:#5d6572}a{color:#2240a5}</style></head><body>
<h1>FinPilot Receipt Guard</h1><p>Five real roles: ingest → behavior → forecast → advise → verify.</p>
<p>Local, source-grounded USDC scenario analysis. No wallets, chain transactions, custody, swaps or price predictions.</p>
<article><button id="demo">Run fully synthetic data</button><p id="summary"></p><pre id="results"></pre></article>
<p><a href="/docs">API docs</a> · <a href="/demo">Synthetic demonstration JSON</a> · <a href="/health">Health check</a></p>
<small>Analytical simulation, not financial advice. Original source and measured tests required for any competition submission.</small>
<script>document.querySelector("#demo").onclick=async()=>{
const o=await(await fetch("/demo")).json();document.querySelector("#summary").textContent=
"Accepted "+o.output.accepted_rows+" settled records; filtered "+o.output.rejected_rows.length+
"; p05 30-day balance "+o.output.forecast.bootstrap_p05_usdc+" USDC.";
document.querySelector("#results").textContent=JSON.stringify(o.output,null,2);
};</script></body></html>"""

if __name__=="__main__":
    import uvicorn
    uvicorn.run("finpilot.app:app",host="127.0.0.1",port=8765)
