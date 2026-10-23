# FinPilot Receipt Guard

**Live, free browser demo:** https://livastic-vm1-primary.github.io/finpilot-usdc-receipt-guard-20261023/ — synthetic, local-only; no wallet connection or checkout.

**One-minute original visual demo (silent):** https://livastic-vm1-primary.github.io/finpilot-usdc-receipt-guard-20261023/finpilot-base-receipt-guard-honest-demo-60s.mp4 — 60.0 seconds, synthetic sample and tested app, no verified live blockchain receipts.

A real working **FastAPI multi-agent USDC planning demo**, using entirely
synthetic records by default. It models a practical source of bad financial
decisions: promised and pending payments, self-transfers, wrong-network tokens,
and duplicate log entries being mistaken for spendable income.

## Status and eligibility

Prepared for evaluation of [Agent Arena 2026](https://career.krishnaik.in/hackathons/agent-arena-2026),
FinPilot track. **Not entered or prize-awarded until official registration and
submission are verified**. Official rules require all LLM calls to go through
**Mesh API**. The current implementation explicitly supports a real Mesh API
call when `MESH_API_KEY` is configured, and **does not pretend to call a model**
when there is no credential. Obtain a sponsor key through its normal account
interface; do not commit it. A local mock/test without a working sponsor key
**is not a valid final competition submission**. No unapproved human-identity
or prize-receipt assertions.

## Agents

1. **IngestAgent** validates positive six-decimal USDC amounts, network, Base
   chain ID, official Circle USDC token contract, transaction hash and log index;
   rejects pending, future, internal and duplicate evidence.
2. **BehaviorAgent** groups final receipts/spending over 30/60/90 days, learns
   category medians, and flags unusually large settled expenses.
3. **ForecastAgent** makes scenario-adjusted weighted estimates and **500
   deterministic seeded daily bootstrap resamples**. It makes no calibrated
   guarantee; sparse data may yield fragile or very wide forecasts.
4. **AdviceAgent** proposes a short list of concrete, non-investment
   interventions from calculated risk rather than a model's guesses.
5. **VerifyAgent** checks recommendation evidence references and rejects
   ungrounded suggestions. Optional **Mesh** natural-language rendering checks
   any numerical tokens against computed measurements and falls back to
   deterministic output if hallucinated. The endpoint never trades, signs, or
   sends payments.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q
.venv/bin/python -m uvicorn finpilot.app:app --host 127.0.0.1 --port 8765
```

Open http://127.0.0.1:8765 to run the fully synthetic demo. `GET /demo`
returns original test input and measured output. For user-supplied input POST
`/analyze` using the schema in `/docs`, with `with_mesh=false` for
deterministic analysis or `with_mesh=true` to call the **real** Mesh provider
if configured. No account info, wallet keys or customer data should be placed
in this public demonstration.

## Optional voluntary support (not a checkout)

The free browser demo also displays one **public, read-only receiving address**
from the original human owner's existing MetaMask account. Optional tips are
specified as **Base mainnet chain ID 8453 / native Circle USDC only**. This is
not a required payment, invoice, paid job or expected earning: see
[DONATIONS.md](DONATIONS.md). The website does not connect to any wallet, sign,
broadcast, confirm an on-chain receipt or charge money. Actual unrelated
business services need a separate written scope and payee confirmation.

## Work with the operator (optional)
**Payment proof field guide:** A practical, cited, free article on separating crypto bounty promises, upstream code acceptance and independently settled native Base Circle USDC: [7 checks before marking a bounty paid](https://livastic-vm1-primary.github.io/finpilot-usdc-receipt-guard-20261023/base-usdc-payment-proof.html). The guide uses only fictional sample rows; it includes an honest, separately negotiated 25-USDC nonsecret QA inquiry, not an automatic checkout.


The code is free and MIT-licensed. An independent payer may request a **fixed
scope offline source/receipt-format QA report** via the precise [commercial
scope and eligibility terms](SERVICES.md). A tentative 25 Base native Circle
USDC price is an invitation to negotiate a proper paid contract, not a
checkout or an earned payout. Do not supply secret keys or private customer
information, and do not expect independent chain finality proof from the
synthetic-only engine.

## Browser-only version (no wallet or account)

The new `docs/index.html` uses only static HTML and a source-checked JavaScript
module `docs/receipt-guard.mjs`. Start it with a local static HTTP server
(eg `python3 -m http.server 8090 --directory docs`) and open the root
page. The demo validates the *shape* of a claimed Base USDC receipt and its
unique txHash/logIndex. It does not query the chain, verify a receipt or touch
your wallet. It works with fictional records and provides a prospective
25-USDC offline QA consultation link, not a direct paid checkout.

The pure JS module has **15 separate Node.js unit tests** run with
`node --test tests/browser-demo.test.mjs`. No NPM packages needed.

## NEW — live, read-only Ink mainnet native-USDC proof (2026-10-23)

**Working public page:** https://livastic-vm1-primary.github.io/finpilot-usdc-receipt-guard-20261023/ink-usdc-receipt-proof.html

Unlike the *separate original Base synthetic demo*, this page **does read the real Ink public blockchain** using the official `https://rpc-gel.inkonchain.com` HTTPS JSON-RPC. No wallet connection, credentials, transactions or gas required. It validates the exact native Circle USDC token on chain **57073** (`0x2D270e6886d130D724215A266106e6832161EAEd`), the user-supplied transaction receipt, one exact external Transfer event, recipient, minimum amount, canonical block hash, and the RPC-reported `finalized` block height. The output supplies a unique `57073:txHash:logIndex` evidence key. It only proves an Ink RPC-observed on-chain event — NOT contract payment/independent commercial buyer, L1 Ethereum withdrawal finality, unique ledger accounting, or a developer's earned income.

Built as `docs/ink-usdc-proof.mjs` with 26 dependency-free synthetic negative and positive tests (`node --test tests/ink-usdc-proof.test.mjs`). Verified once against an actual publicly observable unrelated on-chain Ink USDC Transfer, **20.541761 USDC**, tx `0xba6e3b6a1fcfeb40a88f3f227da3929c89396b393c3974444804af5c37d123da`, output `reports/ink_public_chain_readonly_demo.json`. This public unrelated transfer is NOT the operator's customer, revenue, tip, donation, or wallet. Chain and token sources: [Ink network docs](https://docs.inkonchain.com/general/network-information), [Ink canonical payment tokens](https://docs.inkonchain.com/build/paymaster-integration/payment-tokens), [Circle native Ink USDC](https://www.circle.com/multi-chain-usdc/ink). Browser queries only the fixed official RPC and displays `NOT VERIFIED` when any required proof fails. CORS permission was checked on the live public endpoint. No tracking or data collection by this page.

**Separately:** the original `/` Base demo remains wholly fictional and local-only. Running that Base example does NOT read the network, and a synthetic record must never be confused with the real Ink page's event evidence. Neither page executes a payment or proves an earned paycheck.

## Reproducible synthetic evaluation (2026-10-23 KST)

`PYTHONPATH=. python scripts/evaluate.py` produced 40 deliberately synthetic
cases (480 labelled ledger rows): receipt filtering recall 1.000,
specificity 1.000; 40/40 point-forecast purchase monotonic checks,
40/40 deterministic replays and 40/40 internal advice reference checks.
`pytest -q` passes 28 cases. These are **engine invariants on controlled synthetic
fixtures, NOT observed predictive accuracy on a real financial population**,
not an LLM benchmark and not evidence of payout or contest selection.
See `reports/synthetic_evaluation.json`.

## Honest limitations

- The *original synthetic Base ledger and forecast engine* does not access real wallets, payment receipts or mainnet RPC. The separate new Ink page does access Ink public read-only RPC for explicitly entered public receipt hashes, as explained above; neither executes a transfer or establishes service revenue.
- USDC is a token and this analysis does **not** imply a guaranteed dollar
  peg or compute live conversion prices. Portfolio tax/accounting not supported.
- Bootstrap samples reuse historical observations and are **not** a calibrated
  future-probability distribution. They are not financial/investment advice.
- Exact contract (ERC-20 Transfer emitter) and event log ID validation are
  essential to avoid double-booking.
- This is **not yet a competition entry**, not Mesh-gateway validated,
  and not a payable customer deliverable until it is accepted under written
  terms.

## Security and IP

No password, OTP, private key, seed, proprietary data, wallet signature,
transaction approval, mainnet transfer, gas, bridge, trading or user assets.
All source was authored for this worktree. No customer bespoke code or IP
transferred in advance of an accepted paid contract.
