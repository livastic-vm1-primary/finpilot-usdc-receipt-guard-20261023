import assert from 'node:assert/strict';
import test from 'node:test';
import {BASE_USDC, SYNTHETIC_DEMO, inspectLedger, toMicro, formatMicro} from '../docs/receipt-guard.mjs';
function clone(x){return JSON.parse(JSON.stringify(x))}
function one(v){return {...v,as_of:'2026-10-23',balance_usdc:'1',scenario:{},data_origin:'pure_fake'}}
function row(id="a",kind="income",amount="1"){return {id,kind,amount,date:"2026-10-22",asset:"USDC",chain:"synthetic",status:"settled"}}
test('synthetic fixture produces accurate accepted and excluded counts',()=>{
 const r=inspectLedger(SYNTHETIC_DEMO);
 assert.equal(r.event_count,8);assert.equal(r.included_count,4);assert.equal(r.rejected_count,4);
 assert.equal(r.last_30d.income_usdc,'53.000000');
 assert.equal(r.last_30d.expense_usdc,'42.700000');
 assert.equal(r.scenario.point_end_balance_usdc,'94.700000');
 assert.match(r.trust_boundary,/NOT verified onchain/);
});
test('duplicate tx different event IDs is rejected',()=>{
 const x={...row(),chain:"base",chain_id:8453,token_contract:BASE_USDC,tx_hash:"0x"+"a".repeat(64),log_index:2};
 const r=inspectLedger(one({transactions:[x,{...x,id:'b'}]}));
 assert.equal(r.included_count,1);assert.match(r.rejected[0].reason,/same txHash/);
});
test('wrong token, wrong chain, and pending rejected',()=>{
 const x={...row(),chain:"base",chain_id:1,token_contract:BASE_USDC,tx_hash:"0x"+"a".repeat(64),log_index:0};
 const r=inspectLedger(one({transactions:[x,{...x,id:'b',chain_id:8453,token_contract:"0xnone"},{...row('c'),status:"pending"}]}));
 assert.equal(r.included_count,0);assert.equal(r.rejected_count,3);
});
test('self transfers excluded from revenue',()=>{
 const r=inspectLedger(one({transactions:[row('a','self_transfer','99')]}));
 assert.equal(r.last_30d.income_usdc,"0.000000");
});
test('six-decimal precision exact for BigInt',()=>{
 assert.equal(formatMicro(toMicro('123456789.000001')), '123456789.000001');
});
test('invalid numeric values fail closed',()=>{
 for (const x of ["-1","NaN","Infinity","0.0000001","3e4",true,null]){
  assert.throws(()=>toMicro(x));
 }
});
test('event overprecision rejected, not rounded into money',()=>{
 const r=inspectLedger(one({transactions:[row('a','income','1.0000001')]}));
 assert.equal(r.included_count,0);assert.equal(r.rejected_count,1);
});
test('future transactions rejected',()=>{
 const r=inspectLedger(one({transactions:[{...row(),date:"2027-01-01"}]}));
 assert.equal(r.rejected_count,1);
});
test('duplicate ID rejected',()=>{
 const r=inspectLedger(one({transactions:[row(),row()]}));
 assert.equal(r.rejected[0].reason,"duplicate event ID");
});
test('scenario extra purchase reduces projected balance exactly',()=>{
 const first=inspectLedger(SYNTHETIC_DEMO);const data=clone(SYNTHETIC_DEMO);
 data.scenario.one_time_purchase_usdc="25";
 const second=inspectLedger(data);
 assert.equal(toMicro(first.scenario.point_end_balance_usdc,true)-toMicro(second.scenario.point_end_balance_usdc,true),15000000n);
});
test('no transactions display zero flows',()=>{
 const r=inspectLedger(one({transactions:[]}));
 assert.equal(r.included_count,0);assert.equal(r.last_30d.net_usdc,'0.000000');
});
test('invalid input row count guard',()=>{
 const x=one({transactions:Array.from({length:501},(_,i)=>row("e"+i))});
 assert.throws(()=>inspectLedger(x),/no more than 500/);
});
test('invalid date must not parse silently',()=>{
 const r=inspectLedger(one({transactions:[{...row(),date:"2026-02-30"}]}));
 assert.equal(r.rejected[0].reason,"invalid ISO date");
});
test('all outputs are deterministic by canonical values',()=>{
 assert.deepEqual(inspectLedger(SYNTHETIC_DEMO),inspectLedger(clone(SYNTHETIC_DEMO)));
});
test('no wallet send, approve, swap or fetch APIs in module',()=>{
 const serialized=inspectLedger(SYNTHETIC_DEMO).trust_boundary;
 assert.match(serialized,/No RPC\/wallet access/);
});

test('original MetaMask payee is public but never wallet-connected', async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../docs/index.html', import.meta.url),'utf8');
 const policy=readFileSync(new URL('../DONATIONS.md', import.meta.url),'utf8');
 const expected='0x4e3106520E40af30870caFE78da1B1e7110eD98E';
 const usdc='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
 assert.equal(html.split(expected).length,2);
 assert.equal(html.split(usdc).length,2);
 assert.match(html,/Base mainnet \(chain ID 8453\)/);
 assert.ok(policy.includes(expected)&&policy.includes(usdc));
 assert.match(html,/This is <strong>not a checkout<\/strong>/);
 assert.doesNotMatch(html,/window\.ethereum|eth_sendTransaction|wallet_requestPermissions/);
});
test('support UI only copies address, no network or payment action', async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../docs/index.html', import.meta.url),'utf8');
 assert.match(html,/navigator\.clipboard\.writeText\(address\)/);
 assert.match(html,/Clipboard permission unavailable/);
 assert.doesNotMatch(html,/fetch\(|XMLHttpRequest|ethers\.Contract|approve\(/);
});
