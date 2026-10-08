// Link checks: real look-alikes are caught, and honest sites that merely share letters with a
// brand are left alone (both kinds were found by the QA rounds). Run: pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkLink } from '../src/scams.js'

const verdict = (link: string) => {
  const r = checkLink(link)
  return 'error' in r ? 'error' : r.verdict
}

test('catches look-alikes of Solana brands', () => {
  for (const link of ['raydlum.io', 'jupp.ag', 'jupiter.ag', 'phantorn.app', 'phantom-wallet.com', 'phantomwallet-support.xyz', 'magicedan.io', 'solana-airdrop.vercel.app']) {
    assert.equal(verdict(link), 'suspicious', link)
  }
})

test('leaves honest sites alone', () => {
  for (const link of ['tenor.com', 'tensorflow.org', 'meteor.com', 'pumpkin.com', 'phantombuster.com', 'draft.com', 'driftwood.com', 'bonkers.com', 'backpackers.com', 'solana.fm']) {
    assert.notEqual(verdict(link), 'suspicious', link)
  }
  assert.equal(verdict('jup.ag'), 'official')
})

test('platform pages are never official, and bait on them is suspicious', () => {
  assert.equal(verdict('https://t.me/PhantomSupportDesk_bot'), 'suspicious')
  assert.equal(verdict('https://github.com/drainer/claim-airdrop'), 'suspicious')
  assert.equal(verdict('https://x.com/JupiterExchange'), 'unknown')
  // A broken %-escape doesn't crash the check.
  assert.equal(verdict('https://t.me/%E0%A4%A'), 'unknown')
})
