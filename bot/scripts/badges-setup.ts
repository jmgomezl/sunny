// Creates the badge mints on devnet (once) and writes them to .env as SUNNY_BADGES.
// Run: node --env-file=../.env --import tsx scripts/badges-setup.ts
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BADGES, badgeMints, createBadgeMint } from '../src/badges.js'

const ENV = join(import.meta.dirname, '../../.env')
if (/^SUNNY_BADGES=/m.test(readFileSync(ENV, 'utf8'))) {
  console.log('SUNNY_BADGES is already set:', badgeMints())
  process.exit(0)
}
const mints: Record<string, string> = {}
for (const badge of BADGES) {
  mints[badge.id] = await createBadgeMint(badge)
  console.log('created', badge.id, mints[badge.id])
}
appendFileSync(ENV, `\n# Good-habit badge mints (Token-2022, non-transferable, devnet)\nSUNNY_BADGES=${JSON.stringify(mints)}\n`)
console.log('wrote SUNNY_BADGES to .env')
