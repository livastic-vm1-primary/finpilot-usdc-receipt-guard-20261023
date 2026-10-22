/* FinPilot Receipt Guard — local-only, no wallet connect/sign/transfer.
 * A structurally valid asserted event is NOT independent chain settlement proof.
 * No storage, cookies, telemetry, fetch, or external API requests.
 */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DAY = 86400000n;
const MAX = 500;
const RE_HEX = /^0x[0-9a-fA-F]{64}$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_NUMBER = /^(0|[1-9]\d{0,8})(?:\.(\d{1,6}))?$/;
export const REASON = Object.freeze({
  DUPLICATE_ID: "duplicate event ID",
  FUTURE: "future-dated row",
  PENDING: "pending or unpaid record",
  SELF: "self-transfer is not customer revenue",
  WRONG_ASSET: "not supported canonical USDC",
  WRONG_CHAIN: "wrong chain ID or USDC token contract",
  BAD_RECEIPT: "missing or malformed txHash:logIndex evidence key",
  DUPLICATE_RECEIPT: "same txHash:logIndex already counted",
  UNSUPPORTED_CHAIN: "unrecognized or unstated evidence chain",
  BAD_DATE: "invalid ISO date",
  BAD_AMOUNT: "amount is not a positive six-decimal USDC quantity",
  BAD_KIND: "unrecognized event type"
});
export function toMicro(input, allowZero = false) {
  if (typeof input === "boolean" || typeof input === "object" || input === null)
    throw new Error("USDC value must be a decimal string or finite number");
  const text = String(input).trim();
  const match = text.match(RE_NUMBER);
  if (!match) throw new Error("invalid USDC quantity (0–9 digits, up to 6 decimals)");
  const [whole, fractional = ""] = text.split(".");
  const value = BigInt(whole) * 1000000n + BigInt(fractional.padEnd(6, "0") || "0");
  if (!allowZero && value <= 0n) throw new Error("transaction amount must be greater than zero");
  return value;
}
export function formatMicro(value) {
  const n = BigInt(value);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  return sign + (abs / 1000000n).toString() + "." + (abs % 1000000n).toString().padStart(6, "0");
}
function parseDay(value) {
  if (typeof value !== "string" || !RE_DATE.test(value)) throw new Error(REASON.BAD_DATE);
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10)!==value)
    throw new Error(REASON.BAD_DATE);
  return BigInt(parsed.getTime());
}
function median(values) {
  const list = values.slice().sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  if (!list.length) return 0n;
  const i = Math.floor(list.length / 2);
  return list.length % 2 ? list[i] : (list[i-1]+list[i]) / 2n;
}
export function inspectLedger(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Ledger input must be an object");
  if (!Array.isArray(input.transactions) || input.transactions.length > MAX)
    throw new Error("transactions must be an array of no more than 500 events");
  const today = parseDay(input.as_of);
  const reportedBalance = toMicro(input.balance_usdc, true);
  const s = input.scenario || {};
  const addedMonthly = toMicro(s.monthly_extra_spend_usdc ?? "0", true);
  const oneOff = toMicro(s.one_time_purchase_usdc ?? "0", true);
  const reductionRaw = Number(s.income_reduction_pct ?? "0");
  if (!Number.isFinite(reductionRaw) || reductionRaw < 0 || reductionRaw > 100)
    throw new Error("Income reduction must be in the range 0–100%");
  const reduction = BigInt(Math.round(reductionRaw * 100));
  const seenId = new Set(), seenReceipt = new Set(), accepted = [], rejected = [];
  let inflows = 0n, outflows = 0n;
  const expenseCategories = new Map();
  const reject = (id, reason) => rejected.push({id, reason});
  for (let i=0;i<input.transactions.length;i++) {
    const t=input.transactions[i];
    const id=t && typeof t.id==="string" && t.id.length<120 ? t.id : "row:"+i;
    if (!t || typeof t!=="object" || Array.isArray(t)) { reject(id,"non-object row"); continue; }
    if (!t.id || typeof t.id!=="string" || t.id.length>100) {reject(id,"invalid event ID");continue;}
    if (seenId.has(id)) {reject(id,REASON.DUPLICATE_ID);continue;}
    seenId.add(id);
    let when,amount;
    try {when=parseDay(t.date);} catch {reject(id,REASON.BAD_DATE);continue;}
    if (when>today){reject(id,REASON.FUTURE);continue;}
    if (t.asset!=="USDC"){reject(id,REASON.WRONG_ASSET);continue;}
    if (!["income","expense","refund","self_transfer"].includes(t.kind)){reject(id,REASON.BAD_KIND);continue;}
    try {amount=toMicro(t.amount);}catch{reject(id,REASON.BAD_AMOUNT);continue;}
    if(t.status!=="settled"){reject(id,REASON.PENDING);continue;}
    if(t.kind==="self_transfer"){reject(id,REASON.SELF);continue;}
    let key;
    if(t.chain==="synthetic"){
      key="fictional:"+id;
    } else if(t.chain==="base"){
      if(t.chain_id!==8453||String(t.token_contract||"").toLowerCase()!==BASE_USDC.toLowerCase()){
        reject(id,REASON.WRONG_CHAIN);continue;
      }
      if(!RE_HEX.test(t.tx_hash)||!Number.isSafeInteger(t.log_index)||t.log_index<0){
        reject(id,REASON.BAD_RECEIPT);continue;
      }
      key=t.tx_hash.toLowerCase()+":"+t.log_index;
    }else{reject(id,REASON.UNSUPPORTED_CHAIN);continue;}
    if(seenReceipt.has(key)){reject(id,REASON.DUPLICATE_RECEIPT);continue;}
    seenReceipt.add(key);
    const evidence=t.chain==="base"?"onchain-shaped, not actually chain verified":"entirely fictional demo row";
    accepted.push({id,kind:t.kind,date:t.date,amount_usdc:formatMicro(amount),evidence,category:String(t.category||"uncategorized").slice(0,60)});
    const age=(today-when)/DAY;
    if(age>=0n&&age<30n){
      if(t.kind==="income"){inflows+=amount;}
      else {outflows+=amount;}
    }
    if(t.kind==="expense" && age>=0n && age<90n){
      const cat=String(t.category||"uncategorized").slice(0,60);
      if(!expenseCategories.has(cat))expenseCategories.set(cat,[]);
      expenseCategories.get(cat).push({id,amount});
    }
  }
  const anomalies=[];
  for(const [category,values] of expenseCategories){
    if(values.length<3)continue;
    const baseline=median(values.map(v=>v.amount));
    if(baseline>0n)for(const v of values)if(v.amount>3n*baseline){
      anomalies.push({id:v.id,category,observed_usdc:formatMicro(v.amount),median_usdc:formatMicro(baseline)});
    }
  }
  const reducedIncome=(inflows*(10000n-reduction))/10000n;
  const next=reportedBalance+reducedIncome-outflows-addedMonthly-oneOff;
  const stress=reportedBalance+(reducedIncome*7n)/10n-(outflows*13n)/10n-addedMonthly-oneOff;
  const recommendations=[];
  if(stress<0n)recommendations.push({
    title:"Shortfall in a transparent stress scenario",
    reason:"Synthetic stress = 70% of observed income and 130% of observed expense; no statistical probability claim."
  });
  if(reportedBalance<outflows+addedMonthly)recommendations.push({
    title:"Reported balance is below projected spending",
    reason:"The supplied balance is less than observed 30-day expenses plus the planned extra amount."
  });
  if(anomalies.length)recommendations.push({
    title:"Review large outlier expenses",
    reason:anomalies.length+" expense(s) exceeded three times the median of their own category."
  });
  if(!recommendations.length)recommendations.push({
    title:"No local threshold alarm",
    reason:"This does not establish solvency or verified incoming payments."
  });
  return {
    data_origin:String(input.data_origin||"caller_supplied"),
    event_count:input.transactions.length,
    included_count:accepted.length,rejected_count:rejected.length,
    accepted,rejected,anomalies,
    last_30d:{
      income_usdc:formatMicro(inflows),
      expense_usdc:formatMicro(outflows),
      net_usdc:formatMicro(inflows-outflows)
    },
    scenario:{
      reported_balance_usdc:formatMicro(reportedBalance),
      planned_extra_spend_usdc:formatMicro(addedMonthly),
      planned_purchase_usdc:formatMicro(oneOff),
      income_reduction_pct:reductionRaw,
      point_end_balance_usdc:formatMicro(next),
      stress_end_balance_usdc:formatMicro(stress)
    },
    recommendations,
    trust_boundary:"Read-only local format and arithmetic checks; asserted settled labels and tx hashes are NOT verified onchain receipts, asset balances or income. No RPC/wallet access."
  };
}
export const SYNTHETIC_DEMO={
 as_of:"2026-10-23",balance_usdc:"120.000000",
 data_origin:"100% synthetic, nobody's wallet or income",
 scenario:{monthly_extra_spend_usdc:"15",one_time_purchase_usdc:"10",income_reduction_pct:"20"},
 transactions:[
  {id:"fake-revenue",date:"2026-10-12",kind:"income",amount:"45",asset:"USDC",chain:"synthetic",status:"settled",category:"fictional test sales"},
  {id:"fake-rent",date:"2026-10-16",kind:"expense",amount:"38.5",asset:"USDC",chain:"synthetic",status:"settled",category:"fictional expenses"},
  {id:"unpaid-invoice",date:"2026-10-20",kind:"income",amount:"200",asset:"USDC",chain:"synthetic",status:"pending",category:"advertised bounty"},
  {id:"internal-wallet-move",date:"2026-10-21",kind:"self_transfer",amount:"50",asset:"USDC",chain:"synthetic",status:"settled",category:"not a customer"},
  {id:"wrong-chain",date:"2026-10-22",kind:"income",amount:"80",asset:"USDC",chain:"base",chain_id:1,token_contract:BASE_USDC,tx_hash:"0x"+"1".repeat(64),log_index:0,status:"settled"},
  {id:"mock-onchain-event",date:"2026-10-22",kind:"income",amount:"8",asset:"USDC",chain:"base",chain_id:8453,token_contract:BASE_USDC,tx_hash:"0x"+"a".repeat(64),log_index:0,status:"settled",category:"synthetic record, not real transfer"},
  {id:"duplicate-mock-receipt",date:"2026-10-22",kind:"income",amount:"8",asset:"USDC",chain:"base",chain_id:8453,token_contract:BASE_USDC,tx_hash:"0x"+"a".repeat(64),log_index:0,status:"settled",category:"synthetic record, not real transfer"},
  {id:"test-outlay",date:"2026-10-22",kind:"expense",amount:"4.2",asset:"USDC",chain:"synthetic",status:"settled",category:"fictional expenses"}
 ]
};
