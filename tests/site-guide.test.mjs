import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const article = read('docs/base-usdc-payment-proof.html');
const home = read('docs/index.html');
const sitemap = read('docs/sitemap.xml');
const readme = read('README.md');
const canonical = 'https://livastic-vm1-primary.github.io/finpilot-usdc-receipt-guard-20261023/base-usdc-payment-proof.html';

test('guide has one exact canonical URL and crawlable metadata', () => {
  assert.equal((article.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(article.includes('href="'+canonical+'"'));
  assert.ok(article.includes('<meta name="description"'));
  assert.ok(article.includes('datePublished'));
});

test('first-party official Circle USDC Base asset and chain are consistent', () => {
  assert.ok(article.includes('0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913'));
  assert.ok(article.includes('chain ID 8453'));
  assert.ok(article.includes('0x2105'));
  assert.ok(article.includes('six decimals'));
});

test('the real paid workflow distinguishes promise from finalized receipt', () => {
  for (const required of [
    'Advertised opportunity', 'Work performed', 'Potential receivable',
    'Finalized matching external transfer', 'logIndex', 'refund',
    'ERC-20', 'the agreed amount']) {
    assert.ok(article.toLowerCase().includes(required.toLowerCase()), 'missing '+required);
  }
});

test('guide labels synthetic scenarios non-payment', () => {
  assert.ok(article.includes('fictional'));
  assert.match(article, /fictional.*row|wholly.*fictional/s);
  assert.ok(article.includes('no real transaction receipt'));
});

test('commercial offer is an inquiry not an executable checkout', () => {
  assert.ok(article.includes('Indicative 25 native Circle USDC'));
  assert.ok(article.includes('mailto:onecursor1@gmail.com'));
  assert.ok(article.includes('separate') && article.includes('written agreement'));
  assert.ok(article.includes('No online checkout'));
  assert.equal((article.match(/<form\b/g)||[]).length,0);
});

test('no JS wallet interaction or external tracking code added to guide', () => {
  assert.equal((article.match(/<script/g) || []).length,1);
  assert.ok(article.includes('type="application/ld+json"'));
  assert.ok(!/window\.ethereum|eth_sendTransaction|eth_sign|sendRawTransaction|google-analytics\.com|googletagmanager\.com/i.test(article));
});

test('existing demo and README both prominently link same free guide', () => {
  assert.ok(home.includes('href="./base-usdc-payment-proof.html"'));
  assert.ok(readme.includes(canonical));
  assert.ok(article.includes('href="./"'));
  assert.ok(article.includes('SERVICES.md'));
});

test('published project sitemap includes both pages exactly once', () => {
  assert.equal(sitemap.split('<loc>'+canonical+'</loc>').length-1,1);
  assert.equal(sitemap.split('<loc>https://livastic-vm1-primary.github.io/finpilot-usdc-receipt-guard-20261023/</loc>').length-1,1);
  assert.ok(sitemap.startsWith('<?xml version="1.0"'));
});
