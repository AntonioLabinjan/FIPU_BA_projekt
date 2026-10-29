// Demo backend: ista logika kao IronChain.sol, ali u localStorage (bez walleta i ETH-a).
const KEY = 'ironchain-demo-v1'
const ME_KEY = 'ironchain-demo-me'
const DAY = 86400

// Lowercase adresa da prođe isAddress bez checksum provjere
export const DEMO_FRIEND = '0xf00dbabe00000000000000000000000000000001'

function randomAddress() {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function getDemoAddress() {
  try {
    let a = localStorage.getItem(ME_KEY)
    if (!a) {
      a = randomAddress()
      localStorage.setItem(ME_KEY, a)
    }
    return a
  } catch {
    return '0x' + '0'.repeat(39) + '1'
  }
}

const emptyStats = () => ({ currentStreak: 0, longestStreak: 0, totalLifts: 0, totalPRs: 0, lastDay: 0 })

function addLift(db, who, exercise, weight10, reps, ts) {
  const addr = who.toLowerCase()
  const est = reps === 1 ? weight10 : Math.floor((weight10 * (30 + reps)) / 30)

  db.best[addr] ??= {}
  const isPR = est > (db.best[addr][exercise] || 0)
  const s = (db.stats[addr] ??= emptyStats())

  if (isPR) {
    db.best[addr][exercise] = est
    s.totalPRs++
  }

  const today = Math.floor(ts / DAY)
  if (s.lastDay === 0 || today > s.lastDay + 1) s.currentStreak = 1
  else if (today === s.lastDay + 1) s.currentStreak++
  s.lastDay = today
  if (s.currentStreak > s.longestStreak) s.longestStreak = s.currentStreak
  s.totalLifts++

  ;(db.lifts[addr] ??= []).push({ exercise, weight10, reps, timestamp: ts, est1RM10: est, isPR, attestations: 0 })
}

function seed() {
  const db = { lifts: {}, stats: {}, best: {}, attested: {} }
  const now = Math.floor(Date.now() / 1000)
  // [dana unazad, vježba, kg*10, reps] - demo prijatelj s 7-dnevnim streakom
  const plan = [
    [6, 'squat', 1000, 5],
    [5, 'bench press', 800, 5],
    [4, 'deadlift', 1400, 3],
    [3, 'squat', 1050, 5],
    [2, 'bench press', 850, 3],
    [1, 'deadlift', 1500, 2],
    [0, 'squat', 1100, 3],
  ]
  for (const [d, ex, w, r] of plan) addLift(db, DEMO_FRIEND, ex, w, r, now - d * DAY)
  return db
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  const db = seed()
  save(db)
  return db
}

function save(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* ignore */
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export const demoApi = {
  async loadProfile(addr, me) {
    const db = load()
    const a = addr.toLowerCase()
    const m = me.toLowerCase()
    const lifts = (db.lifts[a] || []).map((l, index) => ({ index, ...l }))
    const stats = db.stats[a] || emptyStats()
    const attested = {}
    if (a !== m) lifts.forEach((l) => (attested[l.index] = Boolean(db.attested[`${a}:${l.index}:${m}`])))
    return { lifts, stats, attested }
  },

  async logLift(me, exercise, weight10, reps) {
    const db = load()
    addLift(db, me, exercise, weight10, reps, Math.floor(Date.now() / 1000))
    save(db)
  },

  async attest(me, lifter, index) {
    const db = load()
    const a = lifter.toLowerCase()
    const m = me.toLowerCase()
    if (a === m) throw new Error('Cannot attest own lift')
    const lift = db.lifts[a]?.[index]
    if (!lift) throw new Error('No such lift')
    const key = `${a}:${index}:${m}`
    if (db.attested[key]) throw new Error('Already attested')
    db.attested[key] = true
    lift.attestations++
    save(db)
  },
}
