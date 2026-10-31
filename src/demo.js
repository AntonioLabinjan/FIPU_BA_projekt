// Demo backend: ista logika kao IronChain.sol, ali u localStorage (bez walleta i ETH-a).
const KEY = 'ironchain-demo-v2'
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

const emptyStats = () => ({ currentStreak: 0, longestStreak: 0, totalLifts: 0, totalPRs: 0, lastDay: 0, trainingDays: 0 })
const nowSec = (db) => Math.floor(Date.now() / 1000) + (db.offset || 0)

// --- badges (isti ID-evi kao u ugovoru) ---
function award(db, who, id) {
  db.badges[who] = (db.badges[who] || 0) | (1 << id)
}

function awardBadges(db, who) {
  const s = db.stats[who]
  if (s.totalLifts >= 1) award(db, who, 0)
  if (s.totalPRs >= 1) award(db, who, 1)
  if (s.longestStreak >= 7) award(db, who, 2)
  if (s.longestStreak >= 30) award(db, who, 3)
  if (s.totalLifts >= 100) award(db, who, 4)
  if (s.totalPRs >= 10) award(db, who, 5)
}

// --- challenge (status: 0 none, 1 active, 2 won, 3 lost) ---
function checkChallenge(db, who, ts) {
  const c = db.challenges[who]
  if (!c || c.status !== 1 || ts > c.deadline) return
  if (db.stats[who].trainingDays - c.startDays >= c.targetDays) {
    c.status = 2
    db.pending[who] = (db.pending[who] || 0) + c.stake
    award(db, who, 8)
  }
}

function settleLost(db, who) {
  const c = db.challenges[who]
  c.status = 3
  db.pending[c.beneficiary] = (db.pending[c.beneficiary] || 0) + c.stake
}

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
  if (today !== s.lastDay) s.trainingDays++
  s.lastDay = today
  if (s.currentStreak > s.longestStreak) s.longestStreak = s.currentStreak
  s.totalLifts++

  ;(db.lifts[addr] ??= []).push({ exercise, weight10, reps, timestamp: ts, est1RM10: est, isPR, attestations: 0 })
  awardBadges(db, addr)
  checkChallenge(db, addr, ts)
}

function seed() {
  const db = { lifts: {}, stats: {}, best: {}, attested: {}, badges: {}, challenges: {}, pending: {}, offset: 0 }
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

    const c = db.challenges[a]
    const challenge = c
      ? {
          status: c.status,
          stakeEth: String(c.stake),
          beneficiary: c.beneficiary,
          targetDays: c.targetDays,
          progress: Math.max(0, Math.min(c.targetDays, stats.trainingDays - c.startDays)),
          deadline: c.deadline,
        }
      : { status: 0, stakeEth: '0', beneficiary: '', targetDays: 0, progress: 0, deadline: 0 }

    return {
      lifts,
      stats,
      attested,
      challenge,
      badges: db.badges[a] || 0,
      pendingEth: String(db.pending[m] || 0),
      now: nowSec(db),
    }
  },

  async logLift(me, exercise, weight10, reps) {
    const db = load()
    addLift(db, me, exercise, weight10, reps, nowSec(db))
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
    award(db, a, 6)
    award(db, m, 7)
    save(db)
  },

  async createChallenge(me, targetDays, durationDays, beneficiary, stakeEth) {
    const db = load()
    const m = me.toLowerCase()
    const b = beneficiary.toLowerCase()
    const stake = Number(stakeEth)
    if (!(stake > 0)) throw new Error('Stake required')
    if (!(targetDays >= 1 && targetDays <= durationDays)) throw new Error('Bad target')
    if (durationDays > 90) throw new Error('Max 90 days')
    if (!b || b === m) throw new Error('Bad beneficiary')

    const now = nowSec(db)
    const old = db.challenges[m]
    if (old?.status === 1) {
      if (now <= old.deadline) throw new Error('Challenge still running')
      settleLost(db, m)
    }
    db.challenges[m] = {
      stake,
      beneficiary: b,
      targetDays,
      startDays: (db.stats[m] || emptyStats()).trainingDays,
      deadline: now + durationDays * DAY,
      status: 1,
    }
    save(db)
  },

  async forfeit(user) {
    const db = load()
    const u = user.toLowerCase()
    const c = db.challenges[u]
    if (!c || c.status !== 1) throw new Error('No active challenge')
    if (nowSec(db) <= c.deadline) throw new Error('Deadline not passed')
    settleLost(db, u)
    save(db)
  },

  async withdraw(me) {
    const db = load()
    const m = me.toLowerCase()
    const amount = db.pending[m] || 0
    if (!(amount > 0)) throw new Error('Nothing to withdraw')
    db.pending[m] = 0
    save(db)
    return amount
  },

  // Samo za demo: pomakni sat za jedan dan unaprijed (da se challenge moze zavrsiti bez cekanja)
  async skipDay() {
    const db = load()
    db.offset = (db.offset || 0) + DAY
    save(db)
  },
}
