// The news desk's labels decide what becomes a Telegram warning and what's called an
// opportunity, so they're tested on real-looking headlines. Run: pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify } from '../src/news.js'

test('hacks, exploits and scams are security news, even when only the teaser says so', () => {
  assert.equal(classify('Solana lending protocol drained of $2M in oracle exploit'), 'security')
  assert.equal(classify('Phishing campaign targets Phantom users with fake airdrop site'), 'security')
  assert.equal(classify('Protocol pauses deposits', 'The team confirmed an attacker stole funds overnight.'), 'security')
  assert.equal(classify('Hackers compromise a popular wallet extension'), 'security')
})

test('only the headline makes something an opportunity', () => {
  assert.equal(classify('Jupiter launches a mobile app with perps'), 'opportunity')
  assert.equal(classify('Solana Foundation announces a hackathon with $1M in grants'), 'opportunity')
  assert.equal(classify('Treasury firm authorizes a stock buyback', 'It may also launch staking products later.'), 'news')
  assert.equal(classify('Capital is rotating back to crypto, says analyst'), 'news')
})
