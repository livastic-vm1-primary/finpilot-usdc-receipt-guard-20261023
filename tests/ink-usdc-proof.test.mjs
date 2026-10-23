import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyInkUSDC,createInkRPC,decodeTransfer,microUSDC,displayUSDC,INK_CHAIN_ID,INK_USDC,ERC20_TRANSFER} from '../docs/ink-usdc-proof.mjs';

const tx='0x'+'a'.repeat(64);
const bh='0x'+'b'.repeat(64);
const payer='0x'+'1'.repeat(40);
const receiver='0x'+'2'.repeat(40);
const other='0x'+'3'.repeat(40);
const topic=address=>'0x'+'0'.repeat(24)+address.slice(2).toLowerCase();
const hex32=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const event=(o={})=>({
  address:o.token||INK_USDC,topics:[o.sig||ERC20_TRANSFER,topic(o.from||payer),topic(o.to||receiver)],
  data:hex32(o.amount??50000n),logIndex:o.logIndex??'0x2'
});
const receipt=(o={})=>({transactionHash:tx,status:o.status||'0x1',blockNumber:'0x64',blockHash:bh,logs:o.logs??[event()]});
const fake=(opts={})=>{
  const methods=[];
  const rpc=async(method,params)=>{
    methods.push([method,params]);
    if(method==='eth_chainId')return opts.chain??'0xdef1';
    if(method==='eth_getTransactionReceipt')return opts.receipt===undefined?receipt():opts.receipt;
    if(method==='eth_getBlockByNumber'){
      return params[0]==='finalized'?
        (opts.finalized===undefined?{number:'0x65'}:opts.finalized):
        (opts.canonical===undefined?{hash:bh}:opts.canonical);
    }
    throw Error('unexpected method '+method);
  };
  rpc.calls=methods;
  return rpc;
};
const verify=(o={})=>verifyInkUSDC({transactionHash:tx,recipient:receiver,minUSDC:'0.05',...o,rpc:o.rpc||fake()});

test('genuine local fixture: one canonical Ink transfer proves unique receipt (not buyer income)',async()=>{
  const z=await verify();assert.equal(z.verified,true);
  assert.equal(z.state,'INK_RPC_FINALIZED_TRANSFER');assert.equal(z.chainId,57073);
  assert.equal(z.logIndex,2);assert.equal(z.valueUSDC,'0.05');
  assert.equal(z.rawAtomic,'50000');
  assert.equal(z.dedupKey,'57073:'+tx+':2');
  assert.ok(/not establish a commercial buyer/i.test(z.warning));
});
test('known Ink chain ID and canonical Circle contract not the Base contract',()=>{
  assert.equal(INK_CHAIN_ID,57073n);assert.equal(INK_USDC.toLowerCase(),'0x2d270e6886d130d724215a266106e6832161eaed');
});
test('micro-amount parses exactly without floating-point rounding',()=>{
  assert.equal(microUSDC('0.000001'),1n);
  assert.equal(microUSDC('20.541761'),20541761n);
  assert.equal(microUSDC('20'),20000000n);
  assert.equal(displayUSDC(20541761n),'20.541761');
});
test('reject invalid/zero/too-precise minimum',()=>{
  for(const v of ['0','0.000000','0.0000001','1.0000001','-2','1e6','1.','2.5.1','1,000','abc']){
    assert.throws(()=>microUSDC(v),Error,v);
  }
});
test('reject invalid tx hash locally before reaching any RPC',async()=>{
  const rpc=fake();
  await assert.rejects(verify({transactionHash:'0xdead',rpc}),/hash must/);
  assert.equal(rpc.calls.length,0);
});
test('reject invalid receiver locally without RPC',async()=>{
  const rpc=fake();await assert.rejects(verify({recipient:'0x123',rpc}),/Recipient must/);assert.equal(rpc.calls.length,0);
});
test('wrong chain fails closed before receipt query',async()=>{
  const rpc=fake({chain:'0x2105'});const x=await verify({rpc});assert.equal(x.verified,false);assert.equal(x.reason,'wrong_network');
  assert.deepEqual(rpc.calls.map(x=>x[0]),['eth_chainId']);
});
test('no receipt fails closed',async()=>{
  const x=await verify({rpc:fake({receipt:null})});assert.equal(x.reason,'transaction_receipt_absent');
});
test('receipt tx hash mismatch fails',async()=>{
  const x=await verify({rpc:fake({receipt:{...receipt(),transactionHash:'0x'+'d'.repeat(64)}})});
  assert.equal(x.reason,'receipt_hash_mismatch');
});
test('reverted transaction fails',async()=>{
  const x=await verify({rpc:fake({receipt:receipt({status:'0x0'})})});assert.equal(x.reason,'execution_failed');
});
test('wrong token rejects look-alike Transfer',async()=>{
  const x=await verify({rpc:fake({receipt:receipt({logs:[event({token:'0x'+'4'.repeat(40)})]})})});
  assert.equal(x.reason,'no_exact_native_usdc_transfer_to_expected_recipient_at_or_above_minimum');
});
test('wrong recipient rejects event even when token and amount match',async()=>{
  const x=await verify({rpc:fake({receipt:receipt({logs:[event({to:other})]})})});
  assert.equal(x.verified,false);
});
test('insufficient USDC rejects small gift',async()=>{
  const x=await verify({rpc:fake({receipt:receipt({logs:[event({amount:49999n})]})})});
  assert.equal(x.verified,false);
});
test('self-transfer never counts as external incoming payment',async()=>{
  const x=await verify({rpc:fake({receipt:receipt({logs:[event({from:receiver})]})})});
  assert.equal(x.verified,false);
});
test('optional payer mismatch fails',async()=>{
  const x=await verify({sender:other});assert.equal(x.verified,false);
});
test('proper sender pins the payer for an exact event',async()=>{
  const x=await verify({sender:payer});assert.equal(x.verified,true);assert.equal(x.from,payer);
});
test('multiple matching token transfers fail closed rather than arbitrarily picking an event',async()=>{
  const x=await verify({rpc:fake({receipt:receipt({logs:[event({logIndex:'0x2'}),event({logIndex:'0x3'})]})})});
  assert.equal(x.reason,'multiple_matching_transfers_require_individual_log_selection');
});
test('nonmatching ERC-20 signature fails closed',async()=>{
  const x=await verify({rpc:fake({receipt:receipt({logs:[event({sig:'0x'+'f'.repeat(64)})]})})});
  assert.equal(x.verified,false);
});
test('invalid transfer topic padding fails closed',()=>{
  const l=event();l.topics[2]='0x'+'a'.repeat(24)+receiver.slice(2);assert.equal(decodeTransfer(l),null);
});
test('a different block hash rejects an orphan/malformed receipt',async()=>{
  const x=await verify({rpc:fake({canonical:{hash:'0x'+'c'.repeat(64)}})});
  assert.equal(x.reason,'receipt_block_not_canonical');
});
test('missing historical block proof fails closed',async()=>{
  const x=await verify({rpc:fake({canonical:null})});assert.equal(x.verified,false);
});
test('finalized height must cover actual receipt block',async()=>{
  const x=await verify({rpc:fake({finalized:{number:'0x63'}})});assert.equal(x.reason,'not_ink_rpc_finalized');
});
test('finalized block missing fails closed',async()=>{
  const x=await verify({rpc:fake({finalized:null})});assert.equal(x.reason,'not_ink_rpc_finalized');
});
test('prevents any write/send or unknown RPC method',async()=>{
  let sent=false;
  const fetchFn=async()=>{sent=true;throw Error('should never execute')};
  await assert.rejects(createInkRPC(fetchFn)('eth_sendRawTransaction',['0x']),/Unsupported/);
  assert.equal(sent,false);
});
test('RPC response errors fail closed (not a success)',async()=>{
  const fakeFetch=async()=>({ok:true, status:200, text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'archive disabled'}})});
  await assert.rejects(createInkRPC(fakeFetch)('eth_chainId',[]),/unavailable or inconsistent/);
});
test('bad Ink chain result cannot produce positive status',async()=>{
  await assert.rejects(verify({rpc:fake({chain:'not_hex'})}),/Malformed on-chain quantity/);
});

// Public page must never implicitly call wallet APIs, and its sample is clearly someone else's receipt.
test('public Ink page cleanly separates real public RPC from fictional Base local demo',async()=>{
  const {readFileSync}=await import('node:fs');
  const {fileURLToPath}=await import('node:url');
  const {dirname,resolve}=await import('node:path');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const ink=readFileSync(resolve(root,'docs/ink-usdc-receipt-proof.html'),'utf8');
  const home=readFileSync(resolve(root,'docs/index.html'),'utf8');
  const readme=readFileSync(resolve(root,'README.md'),'utf8');
  const sitemap=readFileSync(resolve(root,'docs/sitemap.xml'),'utf8');
  assert.ok(home.includes('href="./ink-usdc-receipt-proof.html"'));
  assert.ok(ink.includes('real public example (not our payment)'));
  assert.ok(ink.includes('0x2D270e6886d130D724215A266106e6832161EAEd'));
  assert.ok(ink.includes('Ink mainnet'));
  assert.ok(ink.includes('ink-usdc-proof.mjs'));
  assert.ok(!/window\.ethereum|eth_sendTransaction|eth_sendRawTransaction|personal_sign|wallet_requestPermissions|googletagmanager/i.test(ink));
  assert.ok(readme.includes('original Base synthetic demo'));
  assert.equal(sitemap.split('ink-usdc-receipt-proof.html</loc>').length-1,1);
});

test('Ink visitor has optional explicit paid QA inquiry, no automatic checkout or wallet signing', async()=>{
  const {readFileSync}=await import('node:fs');
  const {fileURLToPath}=await import('node:url');
  const {dirname,resolve}=await import('node:path');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const html=readFileSync(resolve(root,'docs/ink-usdc-receipt-proof.html'),'utf8');
  const scope=readFileSync(resolve(root,'SERVICES.md'),'utf8');
  assert.ok(html.includes('mailto:onecursor1@gmail.com?subject=FinPilot%20Ink%20USDC%20QA'));
  assert.ok(html.includes('indicative 25 canonical Base USDC'));
  assert.ok(html.includes('No checkout or invoice'));
  assert.ok(scope.includes('Ink mainnet native-USDC receipt QA'));
  assert.ok(scope.includes('Base mainnet (8453)'));
  assert.ok(scope.includes('No Ink paid client contracts'));
  assert.ok(!/eth_sendTransaction|eth_sendRawTransaction|window\.ethereum|wallet_requestPermissions/i.test(html));
});
