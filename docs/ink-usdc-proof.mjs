// FinPilot Ink USDC proof — public, noncustodial, read-only, no API keys.
// This verifies one exact ERC-20 Transfer in a canonical receipt returned by
// the Ink public JSON-RPC. It does NOT prove a contract, buyer agreement,
// merchant account, Ethereum L1 challenge-period finality, or spendable income.
export const INK_CHAIN_ID = 57073n;
export const INK_USDC = '0x2D270e6886d130D724215A266106e6832161EAEd';
export const INK_RPC = 'https://rpc-gel.inkonchain.com';
export const INK_EXPLORER = 'https://explorer.inkonchain.com';
export const ERC20_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX_RE = /^0x[a-fA-F0-9]+$/;

function hexInt(value) {
  if (typeof value !== 'string' || !HEX_RE.test(value)) throw new Error('Malformed on-chain quantity: cannot prove payment.');
  return BigInt(value);
}
function fixedAddress(value) {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) throw new Error('Recipient must be a complete 0x + 40-hex EVM address.');
  return value.toLowerCase();
}
export function microUSDC(value) {
  const v = String(value ?? '').trim();
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,6})?$/.test(v)) throw new Error('USDC minimum must be a positive decimal with at most 6 places.');
  const [whole, dec = ''] = v.split('.');
  const amount = BigInt(whole) * 1000000n + BigInt(dec.padEnd(6, '0'));
  if (amount <= 0n) throw new Error('USDC minimum must be positive.');
  return amount;
}
export function displayUSDC(raw) {
  const n = BigInt(raw);
  const decimal = (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return (n / 1000000n).toString() + (decimal ? '.' + decimal : '');
}
export function decodeTransfer(log) {
  if (!log || typeof log !== 'object' || String(log.address ?? '').toLowerCase() !== INK_USDC.toLowerCase()) return null;
  const topics = log.topics;
  if (!Array.isArray(topics) || topics.length !== 3 || topics[0].toLowerCase() !== ERC20_TRANSFER ||
    !HASH_RE.test(topics[1] ?? '') || !HASH_RE.test(topics[2] ?? '') ||
    topics[1].slice(2, 26) !== '0'.repeat(24) || topics[2].slice(2, 26) !== '0'.repeat(24) ||
    !/^0x[a-fA-F0-9]{64}$/.test(log.data ?? '')) return null;
  const logIndex = hexInt(log.logIndex);
  if (logIndex > 1000000n) throw new Error('Unexpected log index; no proof.');
  return Object.freeze({
    from: '0x' + topics[1].slice(-40).toLowerCase(),
    to: '0x' + topics[2].slice(-40).toLowerCase(),
    raw: hexInt(log.data),
    logIndex: Number(logIndex),
  });
}
function unproven(reason, more = {}) {
  return Object.freeze({ verified: false, state: 'UNPROVEN', reason, ...more });
}
export async function verifyInkUSDC({ transactionHash, recipient, minUSDC, sender = '', rpc }) {
  if (typeof rpc !== 'function') throw new Error('Missing read-only RPC client.');
  const tx = String(transactionHash ?? '').trim();
  if (!HASH_RE.test(tx)) throw new Error('Transaction hash must be 0x followed by 64 hexadecimal characters.');
  const to = fixedAddress(recipient);
  const from = String(sender ?? '').trim() ? fixedAddress(String(sender).trim()) : null;
  const min = microUSDC(minUSDC);
  // A chain mismatch is never a "probably passed": we check the real chain.
  if (hexInt(await rpc('eth_chainId', [])) !== INK_CHAIN_ID) return unproven('wrong_network');
  const receipt = await rpc('eth_getTransactionReceipt', [tx]);
  if (!receipt || typeof receipt !== 'object') return unproven('transaction_receipt_absent');
  if (String(receipt.transactionHash ?? '').toLowerCase() !== tx.toLowerCase()) return unproven('receipt_hash_mismatch');
  if (hexInt(receipt.status) !== 1n) return unproven('execution_failed');
  const paidAt = hexInt(receipt.blockNumber);
  const hash = String(receipt.blockHash ?? '');
  if (!HASH_RE.test(hash)) return unproven('missing_canonical_block_hash');
  if (!Array.isArray(receipt.logs)) return unproven('missing_event_logs');
  const candidates = receipt.logs.map(decodeTransfer).filter(x =>
    x && x.to === to && x.from !== to && (!from || x.from === from) && x.raw >= min);
  if (!candidates.length) return unproven('no_exact_native_usdc_transfer_to_expected_recipient_at_or_above_minimum');
  if (candidates.length !== 1) return unproven('multiple_matching_transfers_require_individual_log_selection');
  // Prove canonical block hash at the actual receipt block, not just that a
  // later head is larger; prevents a stale/orphaned receipt from being credited.
  const canonical = await rpc('eth_getBlockByNumber', ['0x' + paidAt.toString(16), false]);
  if (!canonical || String(canonical.hash ?? '').toLowerCase() !== hash.toLowerCase()) return unproven('receipt_block_not_canonical');
  const finalized = await rpc('eth_getBlockByNumber', ['finalized', false]);
  if (!finalized || hexInt(finalized.number) < paidAt) return unproven('not_ink_rpc_finalized');
  const event = candidates[0];
  return Object.freeze({
    verified: true,
    state: 'INK_RPC_FINALIZED_TRANSFER',
    chainId: 57073,
    token: INK_USDC,
    tokenDecimals: 6,
    from: event.from,
    to,
    valueUSDC: displayUSDC(event.raw),
    rawAtomic: event.raw.toString(),
    txHash: tx.toLowerCase(),
    logIndex: event.logIndex,
    dedupKey: '57073:' + tx.toLowerCase() + ':' + event.logIndex,
    blockNumber: paidAt.toString(),
    inkRpcFinalizedHeight: hexInt(finalized.number).toString(),
    warning: 'Only this Ink JSON-RPC canonical finalized tag + a precise USDC Transfer. This does not establish a commercial buyer, a signed SOW, L1 withdrawal finality, legal income, tax status or a nonduplicated accounting entry.'
  });
}
export function createInkRPC(fetchImpl = fetch) {
  const allowed = new Set(['eth_chainId', 'eth_getTransactionReceipt', 'eth_getBlockByNumber']);
  return async (method, params) => {
    if (!allowed.has(method)) throw new Error('Unsupported or state-changing method blocked.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetchImpl(INK_RPC, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('Ink read-only RPC HTTP ' + response.status + '; no proof.');
      const body = await response.text();
      if (body.length > 1000000) throw new Error('Ink RPC returned excessive data; no proof.');
      const data = JSON.parse(body);
      if (data.id !== 1 || data.error || !('result' in data)) throw new Error('Ink RPC unavailable or inconsistent; no proof.');
      return data.result;
    } finally {
      clearTimeout(timeout);
    }
  };
}
