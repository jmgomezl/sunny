// Real usage numbers for the submission, read straight from Sunny's data files.
// No dependencies, so it runs on the server as is:
//   ssh root@<host> 'SUNNY_DATA_DIR=/opt/sunny/data node --input-type=module -' < bot/scripts/stats.mjs
// or locally: SUNNY_DATA_DIR=./data node scripts/stats.mjs
// Guests (negative ids) and the ids used by the e2e and QA scripts (990000000–991999999) are left out.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.env.SUNNY_DATA_DIR || join(process.cwd(), 'data')
const read = (file, empty) => {
  try {
    return JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  } catch {
    return empty
  }
}
const real = (id) => Number(id) > 0 && !(Number(id) >= 990_000_000 && Number(id) < 992_000_000)
const DAY = 86_400_000
const now = Date.now()

const users = Object.entries(read('users.json', {})).filter(([id]) => real(id))
const vaults = Object.keys(read('vaults.json', {})).filter(real)
const alerts = read('alerts.json', []).filter((a) => real(a.userId))
const groups = Object.values(read('groups.json', {}))
const activeGroups = groups.filter((g) => !g.removedAt)
let shares = 0
try {
  shares = readdirSync(join(DIR, 'shares')).length
} catch {}

const seenWithin = (ms) => users.filter(([, u]) => u.seenAt && now - Date.parse(u.seenAt) < ms).length
const count = (fn) => users.filter(([, u]) => fn(u)).length
const activity = users.flatMap(([, u]) => u.activity ?? [])
const byKind = (kind) => activity.filter((a) => a.kind === kind).length
const badges = users.reduce((s, [, u]) => s + Object.keys(u.badges ?? {}).length, 0)
const longest = Math.max(0, ...users.map(([, u]) => u.streak?.days ?? 0))

const rows = [
  ['People', users.length],
  ['  seen in the last 24 h', seenWithin(DAY)],
  ['  seen in the last 7 days', seenWithin(7 * DAY)],
  ['  Spanish speakers', count((u) => u.lang?.startsWith('es'))],
  ['Sunny wallets created', vaults.length],
  ['  key backed up', count((u) => u.flags?.keyBackup)],
  ['Wallets watched', users.reduce((s, [, u]) => s + (u.wallets?.length ?? 0), 0)],
  ['Scams caught (people)', count((u) => u.flags?.scamCaught)],
  ['Deep scans bought (people)', count((u) => u.flags?.deepScan)],
  ['Badges minted', badges],
  ['Longest streak (days)', longest],
  ['Morning notes on', count((u) => u.morning !== false)],
  ['Price alerts set', alerts.length],
  ['  triggered', alerts.filter((a) => a.triggeredAt).length],
  ['Recent checks (last 20 per person)', byKind('check') + byKind('scam')],
  ['  of them scams', byKind('scam')],
  ['Groups guarded', activeGroups.length],
  ['  members in them', activeGroups.reduce((s, g) => s + (g.members ?? 0), 0)],
  ['  warnings posted', groups.reduce((s, g) => s + g.warnings, 0)],
  ['  /check answers', groups.reduce((s, g) => s + g.checks, 0)],
  ['Share cards made (last 7 days)', shares],
]

const width = Math.max(...rows.map(([label]) => label.length))
console.log(`Sunny stats · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\n`)
for (const [label, value] of rows) console.log(`${label.padEnd(width)}  ${value}`)
