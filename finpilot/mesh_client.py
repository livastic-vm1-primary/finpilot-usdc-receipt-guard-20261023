"""Optional user-facing explanation from Mesh API only.

No alternate model provider is used. Missing credentials fail closed rather
than pretending the deterministic analyst is an LLM. Never log the API key.
"""
from __future__ import annotations
import json
import os
import re
from typing import Any

def explain_via_mesh(report: dict[str, Any]) -> dict[str, Any]:
    key = os.getenv("MESH_API_KEY")
    if not key:
        return {"mode":"not_called_no_mesh_key",
                "text":"Mesh API key not configured; no LLM call was made.",
                "eligible_for_mesh_required_hackathon":False}
    from openai import OpenAI
    endpoint = "https://api.meshapi.ai/v1"
    client = OpenAI(api_key=key,base_url=endpoint,timeout=14,max_retries=0)
    minimal = {
        "asset": report.get("asset"), "balance":report["forecast"]["starting_usdc"],
        "forecast":report["forecast"], "advice":report["advice"],
        "rejected_rows":len(report.get("rejected_rows",[])),
    }
    instructions = (
       "You summarize a deterministic USDC budget forecast. Do not propose trades, "
       "staking, swaps, leverage or financial products. Do not invent any numeric "
       "claims, promises, or facts not in the supplied JSON. Include the disclaimer "
       "that this is a scenario model, not financial advice. 2-4 short sentences."
    )
    response = client.chat.completions.create(
        model=os.getenv("MESH_MODEL","openai/gpt-4o-mini"),
        messages=[{"role":"system","content":instructions},
                  {"role":"user","content":json.dumps(minimal,ensure_ascii=False)}],
        max_tokens=240,temperature=0,
    )
    raw = response.choices[0].message.content or ""
    # Numeric claims in untrusted LLM text can hallucinate. Strict numeric
    # verification: only rendered numbers already present in computed outputs.
    values = {str(v) for v in minimal["forecast"].values() if isinstance(v,str)}
    allowed = set()
    for val in values:
        allowed.update(re.findall(r"\d+(?:\.\d+)?",val))
    words = re.findall(r"\d+(?:\.\d+)?",raw)
    unknown = [word for word in words if word not in allowed and
               word not in ("2","4")]
    if unknown:
        return {"mode":"mesh_called_but_verification_rejected",
                "text":"Model output contained unsupported numeric claims; the deterministic source-grounded report is authoritative.",
                "rejected_numeric_tokens":sorted(set(unknown)),
                "eligible_for_mesh_required_hackathon":True}
    return {"mode":"mesh_called_numeric_checks_passed","text":raw,
            "eligible_for_mesh_required_hackathon":True}
