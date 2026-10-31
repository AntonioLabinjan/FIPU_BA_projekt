<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BrowserProvider, Contract, JsonRpcProvider, formatEther, isAddress, parseEther } from 'ethers'
import { BADGES, IRONCHAIN_ABI, IRONCHAIN_ADDRESS } from './contract'
import { DEMO_FRIEND, demoApi, getDemoAddress, resetDemo } from './demo'

const SEPOLIA_CHAIN_ID = '0xaa36a7'
const SEPOLIA_CHAIN_NUMBER = 11155111
const SEPOLIA_READ_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const EXERCISES = ['Bench press', 'Squat', 'Deadlift', 'Overhead press', 'Barbell row', 'Pull-up']

// Javni link profila: ?spot=0x... (citanje ne treba novcanik)
const initialSpot = (() => {
  try {
    const v = new URLSearchParams(window.location.search).get('spot') || ''
    return isAddress(v) ? v : ''
  } catch {
    return ''
  }
})()

const account = ref('')
const chainId = ref('')
const viewAddress = ref(initialSpot)
const lookupInput = ref('')

const exercise = ref(EXERCISES[0])
const weight = ref('')
const reps = ref('')

const lifts = ref([])
const stats = ref({ currentStreak: 0, longestStreak: 0, totalLifts: 0, totalPRs: 0, trainingDays: 0 })
const attestedByMe = ref({})
const badges = ref(0)
const challenge = ref({ status: 0, stakeEth: '0', beneficiary: '', targetDays: 0, progress: 0, deadline: 0 })
const pendingEth = ref('0')
const chainNow = ref(Math.floor(Date.now() / 1000))

const chTarget = ref('4')
const chDuration = ref('7')
const chStake = ref('')
const chBeneficiary = ref('')

const walletError = ref('')
const txHash = ref('')
const successMsg = ref('')
const isSending = ref(false)
const isLoading = ref(false)
const attestingIndex = ref(-1)

// null = još provjeravam, true = ugovor postoji na Sepoliji (on-chain), false = nema ga (demo mode)
const contractLive = ref(null)
const demoAddress = getDemoAddress()

const ethereum = typeof window !== 'undefined' ? window.ethereum : undefined
const demoMode = computed(() => contractLive.value === false)
const isConnected = computed(() => Boolean(account.value))
const isOnSepolia = computed(() => chainId.value.toLowerCase() === SEPOLIA_CHAIN_ID)
const me = computed(() => (demoMode.value ? account.value || demoAddress : account.value))
// ready = mogu pisati (demo, ili spojen na Sepoliji uz zivi ugovor)
const ready = computed(() => (demoMode.value ? true : contractLive.value === true && isConnected.value && isOnSepolia.value))
// canRead = mogu prikazati profil (on-chain citanje radi i bez novcanika)
const canRead = computed(() => demoMode.value || contractLive.value === true)
const isOwnProfile = computed(() => Boolean(me.value) && viewAddress.value.toLowerCase() === me.value.toLowerCase())
const networkName = computed(() => {
  if (demoMode.value) return 'Demo (local)'
  if (!chainId.value) return 'Not connected'
  return isOnSepolia.value ? 'Sepolia' : `Unsupported network (${chainId.value})`
})

const shortAddr = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '')
const fmtKg = (v10) => (v10 / 10).toFixed(1).replace(/\.0$/, '')
const fmtEth = (v) => String(+Number(v).toFixed(4))
const fmtDate = (ts) =>
  new Date(ts * 1000).toLocaleString('hr-HR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// Najbolji est. 1RM po vježbi (iz povijesti)
const prBoard = computed(() => {
  const best = {}
  for (const l of lifts.value) {
    if (!best[l.exercise] || l.est1RM10 > best[l.exercise].est1RM10) best[l.exercise] = l
  }
  return Object.values(best).sort((a, b) => b.est1RM10 - a.est1RM10)
})

const historyDesc = computed(() => [...lifts.value].reverse())

const badgeList = computed(() => BADGES.map((b) => ({ ...b, earned: ((badges.value >> b.id) & 1) === 1 })))
const badgeCount = computed(() => badgeList.value.filter((b) => b.earned).length)

const challengeExpired = computed(() => challenge.value.status === 1 && chainNow.value > challenge.value.deadline)
const canCreateChallenge = computed(
  () => isOwnProfile.value && ready.value && (challenge.value.status !== 1 || challengeExpired.value),
)
const progressPct = computed(() =>
  challenge.value.targetDays ? Math.min(100, (challenge.value.progress / challenge.value.targetDays) * 100) : 0,
)
const timeLeft = computed(() => {
  const sec = challenge.value.deadline - chainNow.value
  if (sec <= 0) return 'deadline passed'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${m}m left`
})

function displayError(error) {
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'The wallet request was rejected.'
  return error?.reason || error?.shortMessage || error?.message || 'Something went wrong. Please try again.'
}

// --- A/B odluka: postoji li legit ugovor na Sepoliji? ---
let publicProvider
function getPublicProvider() {
  publicProvider ??= new JsonRpcProvider(SEPOLIA_READ_RPC, SEPOLIA_CHAIN_NUMBER, { staticNetwork: true })
  return publicProvider
}

async function detectContract() {
  contractLive.value = null
  if (!isAddress(IRONCHAIN_ADDRESS)) {
    contractLive.value = false
    return
  }
  try {
    const code = await Promise.race([
      getPublicProvider().getCode(IRONCHAIN_ADDRESS),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ])
    contractLive.value = code !== '0x'
  } catch {
    contractLive.value = false
  }
}

// Citanje: kroz MetaMask ako je spojen na Sepoliji, inace kroz javni RPC (nema potrebe za novcanikom)
function getReadContract() {
  const runner = ethereum && isConnected.value && isOnSepolia.value ? new BrowserProvider(ethereum) : getPublicProvider()
  return new Contract(IRONCHAIN_ADDRESS, IRONCHAIN_ABI, runner)
}

async function getWriteContract() {
  const provider = new BrowserProvider(ethereum)
  return new Contract(IRONCHAIN_ADDRESS, IRONCHAIN_ABI, await provider.getSigner())
}

let loadSeq = 0
async function loadProfile() {
  if (!canRead.value || !isAddress(viewAddress.value)) return
  const seq = ++loadSeq
  const addr = viewAddress.value
  isLoading.value = true
  try {
    let next
    if (demoMode.value) {
      next = await demoApi.loadProfile(addr, me.value)
    } else {
      const contract = getReadContract()
      const [rawLifts, rawStats, rawBadges, rawCh, rawPending] = await Promise.all([
        contract.getLifts(addr),
        contract.getStats(addr),
        contract.getBadges(addr),
        contract.getChallenge(addr),
        me.value ? contract.pendingOf(me.value) : Promise.resolve(0n),
      ])
      const trainingDays = Number(rawStats.trainingDays)
      const targetDays = Number(rawCh.targetDays)
      const parsedLifts = rawLifts.map((l, index) => ({
        index,
        exercise: l.exercise,
        weight10: Number(l.weight10),
        reps: Number(l.reps),
        timestamp: Number(l.timestamp),
        est1RM10: Number(l.est1RM10),
        isPR: l.isPR,
        attestations: Number(l.attestations),
      }))

      let attested = {}
      if (me.value && me.value.toLowerCase() !== addr.toLowerCase()) {
        const flags = await Promise.all(parsedLifts.map((l) => contract.hasAttested(addr, l.index, me.value)))
        flags.forEach((f, i) => (attested[i] = f))
      }

      next = {
        lifts: parsedLifts,
        stats: {
          currentStreak: Number(rawStats.currentStreak),
          longestStreak: Number(rawStats.longestStreak),
          totalLifts: Number(rawStats.totalLifts),
          totalPRs: Number(rawStats.totalPRs),
          trainingDays,
        },
        attested,
        badges: Number(rawBadges),
        challenge: {
          status: Number(rawCh.status),
          stakeEth: formatEther(rawCh.stake),
          beneficiary: rawCh.beneficiary,
          targetDays,
          progress: Math.max(0, Math.min(targetDays, trainingDays - Number(rawCh.startDays))),
          deadline: Number(rawCh.deadline),
        },
        pendingEth: formatEther(rawPending),
        now: Math.floor(Date.now() / 1000),
      }
    }

    if (seq !== loadSeq) return // stigao je noviji zahtjev
    lifts.value = next.lifts
    stats.value = next.stats
    attestedByMe.value = next.attested
    badges.value = next.badges
    challenge.value = next.challenge
    pendingEth.value = next.pendingEth
    chainNow.value = next.now
  } catch (error) {
    if (seq === loadSeq) walletError.value = displayError(error)
  } finally {
    if (seq === loadSeq) isLoading.value = false
  }
}

function handleAccountsChanged(accounts) {
  account.value = accounts[0] || ''
  txHash.value = ''
  successMsg.value = ''
}

function handleChainChanged(next) {
  chainId.value = next
}

async function refreshWallet() {
  if (!ethereum) return
  const [accounts, current] = await Promise.all([
    ethereum.request({ method: 'eth_accounts' }),
    ethereum.request({ method: 'eth_chainId' }),
  ])
  handleAccountsChanged(accounts)
  handleChainChanged(current)
}

onMounted(async () => {
  detectContract()
  if (!ethereum) return
  ethereum.on?.('accountsChanged', handleAccountsChanged)
  ethereum.on?.('chainChanged', handleChainChanged)
  try {
    await refreshWallet()
  } catch (error) {
    walletError.value = displayError(error)
  }
})

onUnmounted(() => {
  ethereum?.removeListener?.('accountsChanged', handleAccountsChanged)
  ethereum?.removeListener?.('chainChanged', handleChainChanged)
})

// Kad se promijeni moj identitet, gledani profil prati mene (osim ako gledam nekog drugog)
watch(
  me,
  (next, prev) => {
    if (!next) return
    if (!viewAddress.value || viewAddress.value.toLowerCase() === (prev || '').toLowerCase()) {
      viewAddress.value = next
    }
  },
  { immediate: true },
)
watch([viewAddress, chainId, account, contractLive, me], loadProfile)

async function connectWallet() {
  walletError.value = ''
  txHash.value = ''
  if (!ethereum) {
    walletError.value = 'MetaMask was not detected. Install the MetaMask browser extension and try again.'
    return
  }
  try {
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
    handleAccountsChanged(accounts)
    chainId.value = await ethereum.request({ method: 'eth_chainId' })
  } catch (error) {
    walletError.value = displayError(error)
  }
}

async function switchToSepolia() {
  walletError.value = ''
  if (!ethereum) return
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID }] })
  } catch (error) {
    if (error?.code !== 4902) {
      walletError.value = displayError(error)
      return
    }
    try {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: SEPOLIA_CHAIN_ID,
          chainName: 'Sepolia',
          nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://rpc.sepolia.org'],
          blockExplorerUrls: ['https://sepolia.etherscan.io'],
        }],
      })
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID }] })
    } catch (addError) {
      walletError.value = displayError(addError)
    }
  }
}

function openLookup() {
  walletError.value = ''
  const target = lookupInput.value.trim()
  if (!isAddress(target)) {
    walletError.value = 'Enter a valid wallet address to spot.'
    return
  }
  viewAddress.value = target
}

function openDemoFriend() {
  lookupInput.value = DEMO_FRIEND
  viewAddress.value = DEMO_FRIEND
}

function backToMe() {
  lookupInput.value = ''
  viewAddress.value = me.value
}

function resetDemoData() {
  resetDemo()
  walletError.value = ''
  successMsg.value = 'Demo data reset.'
  loadProfile()
}

async function demoSkipDay() {
  await demoApi.skipDay()
  successMsg.value = 'Demo clock moved forward one day.'
  await loadProfile()
}

async function copyProfileLink() {
  const url = `${window.location.origin}${window.location.pathname}?spot=${viewAddress.value}`
  try {
    await navigator.clipboard.writeText(url)
    successMsg.value = 'Profile link copied. Anyone can verify it without a wallet.'
  } catch {
    successMsg.value = url
  }
}

// Zajednicki tok za sve write akcije (demo ili on-chain)
async function runTx(okMsg, demoFn, chainFn) {
  walletError.value = ''
  txHash.value = ''
  successMsg.value = ''
  isSending.value = true
  try {
    if (demoMode.value) {
      await demoFn()
    } else {
      const contract = await getWriteContract()
      const tx = await chainFn(contract)
      txHash.value = tx.hash
      await tx.wait()
    }
    successMsg.value = okMsg
    await loadProfile()
    return true
  } catch (error) {
    txHash.value = ''
    walletError.value = displayError(error)
    return false
  } finally {
    isSending.value = false
  }
}

async function logLift() {
  if (!ready.value) {
    walletError.value = 'Connect your wallet on Sepolia first.'
    return
  }

  const name = exercise.value.trim().toLowerCase()
  const kg = Number(String(weight.value).replace(',', '.'))
  const repCount = Number(reps.value)

  if (!name || new TextEncoder().encode(name).length > 32) {
    walletError.value = 'Exercise name must be 1-32 characters.'
    return
  }
  if (!Number.isFinite(kg) || kg <= 0 || kg > 1000) {
    walletError.value = 'Enter a weight between 0.1 and 1000 kg.'
    return
  }
  if (!Number.isInteger(repCount) || repCount < 1 || repCount > 100) {
    walletError.value = 'Reps must be a whole number from 1 to 100.'
    return
  }

  const weight10 = Math.round(kg * 10)
  const ok = await runTx(
    demoMode.value ? 'Set saved locally (demo mode).' : 'Set confirmed on-chain.',
    () => demoApi.logLift(me.value, name, weight10, repCount),
    (c) => c.logLift(name, weight10, repCount),
  )
  if (ok) {
    weight.value = ''
    reps.value = ''
  }
}

async function attest(lift) {
  attestingIndex.value = lift.index
  await runTx(
    'Lift vouched.',
    () => demoApi.attest(me.value, viewAddress.value, lift.index),
    (c) => c.attest(viewAddress.value, lift.index),
  )
  attestingIndex.value = -1
}

async function createChallenge() {
  walletError.value = ''
  const target = Number(chTarget.value)
  const duration = Number(chDuration.value)
  const beneficiary = chBeneficiary.value.trim()
  const stake = chStake.value.trim().replace(',', '.')

  if (!Number.isInteger(target) || !Number.isInteger(duration) || target < 1 || target > duration || duration > 90) {
    walletError.value = 'Target days must be at least 1 and not more than the duration (max 90 days).'
    return
  }
  if (!isAddress(beneficiary) || beneficiary.toLowerCase() === me.value.toLowerCase()) {
    walletError.value = 'Beneficiary must be a valid address that is not your own.'
    return
  }
  if (!/^\d+(?:\.\d{1,18})?$/.test(stake) || Number(stake) <= 0) {
    walletError.value = 'Enter a stake greater than zero.'
    return
  }

  const ok = await runTx(
    demoMode.value ? 'Challenge started (demo).' : 'Challenge started - your stake is locked in the contract.',
    () => demoApi.createChallenge(me.value, target, duration, beneficiary, stake),
    (c) => c.createChallenge(target, duration, beneficiary, { value: parseEther(stake) }),
  )
  if (ok) chStake.value = ''
}

async function forfeitChallenge() {
  await runTx(
    'Challenge closed. The stake went to the beneficiary.',
    () => demoApi.forfeit(viewAddress.value),
    (c) => c.forfeit(viewAddress.value),
  )
}

async function withdraw() {
  await runTx(
    demoMode.value ? 'Withdrawn (demo ETH).' : 'Withdrawal confirmed.',
    () => demoApi.withdraw(me.value),
    (c) => c.withdraw(),
  )
}
</script>

<template>
  <main class="page-shell">
    <section class="wallet-card" aria-labelledby="page-title">
      <div class="brand-mark" aria-hidden="true">I</div>
      <p class="eyebrow">IRONCHAIN</p>
      <h1 id="page-title">Lift it. Log it. Prove it.</h1>
      <p class="intro">
        Every set is stored on Sepolia. PRs, streaks and badges are decided by the contract, spotters can vouch for your
        lifts, and you can put real stake behind your goals.
      </p>

      <p v-if="contractLive === null" class="feedback feedback-info" role="status">Checking for the contract on Sepolia...</p>
      <div v-else-if="demoMode" class="feedback feedback-info" role="status">
        <p><strong>DEMO MODE</strong> - no IronChain contract found on Sepolia, so data lives in this browser only.</p>
        <p class="muted">Deploy the contract and set its address in src/contract.js to go on-chain.</p>
        <div class="inline-actions">
          <button class="link-button" type="button" @click="demoSkipDay">Skip a day (demo clock)</button>
          <button class="link-button" type="button" @click="resetDemoData">Reset demo data</button>
        </div>
      </div>

      <div class="connection-panel">
        <div class="connection-details">
          <span class="status-dot" :class="{ connected: ready }" aria-hidden="true"></span>
          <div>
            <p class="detail-label">Wallet</p>
            <p class="detail-value">
              {{ me ? shortAddr(me) : 'Not connected' }}<span v-if="demoMode && !isConnected"> (demo)</span>
            </p>
          </div>
        </div>
        <div class="network-detail">
          <p class="detail-label">Network</p>
          <p class="detail-value">{{ networkName }}</p>
        </div>
      </div>

      <template v-if="contractLive === true">
        <button v-if="!isConnected" class="button button-primary" type="button" @click="connectWallet">
          Connect MetaMask
        </button>
        <button v-else-if="!isOnSepolia" class="button button-primary" type="button" @click="switchToSepolia">
          Switch to Sepolia
        </button>
      </template>
      <button
        v-else-if="demoMode && !isConnected && ethereum"
        class="button button-small"
        type="button"
        @click="connectWallet"
      >
        Use my MetaMask address (optional)
      </button>

      <!-- WITHDRAW (vracen ulog ili ulog od prijatelja koji je odustao) -->
      <div v-if="ready && Number(pendingEth) > 0" class="feedback feedback-success pending-box" role="status">
        <p>
          <strong>{{ fmtEth(pendingEth) }} ETH</strong> ready to withdraw<span v-if="demoMode"> (demo ETH)</span>.
        </p>
        <button class="button button-small" type="button" :disabled="isSending" @click="withdraw">Withdraw</button>
      </div>

      <template v-if="canRead && viewAddress">
        <!-- STATS -->
        <div class="profile-bar">
          <p class="detail-label">
            {{ isOwnProfile ? 'Your profile' : `Spotting ${shortAddr(viewAddress)}` }}
          </p>
          <div class="inline-actions">
            <button v-if="!demoMode" class="link-button" type="button" @click="copyProfileLink">Copy profile link</button>
            <button v-if="!isOwnProfile && me" class="link-button" type="button" @click="backToMe">Back to me</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat"><span class="stat-value">{{ stats.currentStreak }}🔥</span><span class="stat-label">Day streak</span></div>
          <div class="stat"><span class="stat-value">{{ stats.longestStreak }}</span><span class="stat-label">Best streak</span></div>
          <div class="stat"><span class="stat-value">{{ stats.totalLifts }}</span><span class="stat-label">Sets logged</span></div>
          <div class="stat"><span class="stat-value">{{ stats.totalPRs }}</span><span class="stat-label">PRs</span></div>
        </div>

        <!-- BADGES -->
        <div class="panel">
          <div class="section-heading">
            <h2>Badges</h2>
            <span class="network-tag">{{ badgeCount }}/{{ badgeList.length }} · SOULBOUND</span>
          </div>
          <div class="badges-grid">
            <div
              v-for="b in badgeList"
              :key="b.id"
              class="badge"
              :class="{ locked: !b.earned }"
              :title="b.desc"
            >
              <span class="badge-icon" aria-hidden="true">{{ b.earned ? b.icon : '🔒' }}</span>
              <span class="badge-name">{{ b.name }}</span>
              <span class="badge-desc">{{ b.desc }}</span>
            </div>
          </div>
          <p class="muted small">Awarded by the contract itself. They can't be bought, sent or edited.</p>
        </div>

        <!-- LOG FORM (samo na vlastitom profilu) -->
        <form v-if="isOwnProfile && ready" class="send-form" @submit.prevent="logLift">
          <div class="section-heading">
            <h2>Log a set</h2>
            <span class="network-tag">{{ demoMode ? 'DEMO' : 'SEPOLIA' }}</span>
          </div>

          <label for="exercise">Exercise</label>
          <input id="exercise" v-model="exercise" list="exercise-list" autocomplete="off" maxlength="32" required />
          <datalist id="exercise-list">
            <option v-for="e in EXERCISES" :key="e" :value="e" />
          </datalist>

          <div class="row">
            <div>
              <label for="weight">Weight</label>
              <div class="amount-input">
                <input id="weight" v-model="weight" inputmode="decimal" placeholder="82.5" required />
                <span>KG</span>
              </div>
            </div>
            <div>
              <label for="reps">Reps</label>
              <div class="amount-input">
                <input id="reps" v-model="reps" inputmode="numeric" placeholder="5" required />
                <span>×</span>
              </div>
            </div>
          </div>

          <button class="button button-primary" type="submit" :disabled="isSending">
            {{ isSending ? (demoMode ? 'Saving...' : 'Confirm in MetaMask...') : demoMode ? 'Save set (demo)' : 'Write set to chain' }}
          </button>
        </form>

        <!-- STAKE CHALLENGE -->
        <div class="panel">
          <div class="section-heading">
            <h2>Stake challenge</h2>
            <span class="network-tag">{{ demoMode ? 'DEMO ETH' : 'REAL STAKE' }}</span>
          </div>

          <template v-if="challenge.status === 1">
            <p class="challenge-line">
              <strong>{{ fmtEth(challenge.stakeEth) }} ETH</strong> locked: train
              <strong>{{ challenge.targetDays }}</strong> days before the deadline, or it goes to
              <strong>{{ shortAddr(challenge.beneficiary) }}</strong>.
            </p>
            <div class="progress" role="progressbar" :aria-valuenow="challenge.progress" :aria-valuemax="challenge.targetDays">
              <div class="progress-bar" :style="{ width: progressPct + '%' }"></div>
            </div>
            <p class="muted">
              {{ challenge.progress }}/{{ challenge.targetDays }} training days · {{ timeLeft }}
            </p>
            <button
              v-if="challengeExpired && ready"
              class="button button-small align-left"
              type="button"
              :disabled="isSending"
              @click="forfeitChallenge"
            >
              Close expired challenge (stake goes to beneficiary)
            </button>
          </template>
          <p v-else-if="challenge.status === 2" class="muted">
            Last challenge: <strong class="ok">won</strong>. The {{ fmtEth(challenge.stakeEth) }} ETH stake went back to the lifter.
          </p>
          <p v-else-if="challenge.status === 3" class="muted">
            Last challenge: <strong class="bad">lost</strong>. {{ fmtEth(challenge.stakeEth) }} ETH went to
            {{ shortAddr(challenge.beneficiary) }}.
          </p>
          <p v-else class="muted">No challenge yet.</p>

          <form v-if="canCreateChallenge" class="challenge-form" @submit.prevent="createChallenge">
            <p class="detail-label">New challenge</p>
            <div class="row">
              <div>
                <label for="ch-target">Training days</label>
                <input id="ch-target" v-model="chTarget" inputmode="numeric" placeholder="4" required />
              </div>
              <div>
                <label for="ch-duration">Within (days)</label>
                <input id="ch-duration" v-model="chDuration" inputmode="numeric" placeholder="7" required />
              </div>
            </div>
            <label for="ch-stake">Stake</label>
            <div class="amount-input">
              <input id="ch-stake" v-model="chStake" inputmode="decimal" placeholder="0.01" required />
              <span>ETH</span>
            </div>
            <label for="ch-beneficiary">If I fail, send it to</label>
            <input
              id="ch-beneficiary"
              v-model="chBeneficiary"
              autocomplete="off"
              spellcheck="false"
              placeholder="Friend or charity address 0x..."
              required
            />
            <button v-if="demoMode" class="link-button align-left" type="button" @click="chBeneficiary = DEMO_FRIEND">
              Use the demo friend
            </button>
            <p class="muted small">
              Days count from your next training day. Win: you withdraw your stake. Lose: anyone can close the challenge
              after the deadline and the stake goes to the address above.
            </p>
            <button class="button button-primary" type="submit" :disabled="isSending">
              {{ isSending ? (demoMode ? 'Saving...' : 'Confirm in MetaMask...') : demoMode ? 'Start challenge (demo)' : 'Lock stake & start' }}
            </button>
          </form>
        </div>

        <!-- PR BOARD -->
        <div v-if="prBoard.length" class="panel">
          <div class="section-heading"><h2>PR board</h2><span class="network-tag">EST. 1RM</span></div>
          <ul class="list">
            <li v-for="l in prBoard" :key="l.exercise" class="list-item">
              <span class="cap">{{ l.exercise }}</span>
              <strong>{{ fmtKg(l.est1RM10) }} kg</strong>
            </li>
          </ul>
        </div>

        <!-- HISTORY -->
        <div class="panel">
          <div class="section-heading">
            <h2>History</h2>
            <span v-if="isLoading" class="network-tag">LOADING</span>
          </div>
          <p v-if="!historyDesc.length && !isLoading" class="muted">No sets logged yet.</p>
          <ul class="list">
            <li v-for="l in historyDesc" :key="l.index" class="list-item history-item">
              <div>
                <p class="cap lift-title">
                  {{ l.exercise }}
                  <span v-if="l.isPR" class="pr-badge">PR</span>
                </p>
                <p class="muted">{{ fmtKg(l.weight10) }} kg × {{ l.reps }} · 1RM ≈ {{ fmtKg(l.est1RM10) }} kg · {{ fmtDate(l.timestamp) }}</p>
              </div>
              <div class="spot">
                <span class="spot-count" :title="'Spotter confirmations'">✓ {{ l.attestations }}</span>
                <button
                  v-if="!isOwnProfile && ready"
                  class="button button-small"
                  type="button"
                  :disabled="attestedByMe[l.index] || attestingIndex === l.index"
                  @click="attest(l)"
                >
                  {{ attestedByMe[l.index] ? 'Vouched' : attestingIndex === l.index ? '...' : 'Vouch' }}
                </button>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <!-- SPOTTER MODE -->
      <form v-if="canRead" class="panel spot-form" @submit.prevent="openLookup">
        <div class="section-heading"><h2>Spot a friend</h2></div>
        <div class="row-inline">
          <input v-model="lookupInput" autocomplete="off" spellcheck="false" placeholder="Friend's address 0x..." />
          <button class="button button-small" type="submit">Open</button>
        </div>
        <button v-if="demoMode" class="link-button align-left" type="button" @click="openDemoFriend">
          Try the demo friend (7-day streak)
        </button>
      </form>

      <p v-if="walletError" class="feedback feedback-error" role="alert">{{ walletError }}</p>
      <div v-if="txHash" class="feedback feedback-success" role="status">
        <p>{{ isSending ? 'Transaction submitted, waiting for confirmation...' : successMsg || 'Confirmed on-chain.' }}</p>
        <a :href="`https://sepolia.etherscan.io/tx/${txHash}`" target="_blank" rel="noopener noreferrer">
          View transaction
        </a>
      </div>
      <p v-else-if="successMsg" class="feedback feedback-success" role="status">{{ successMsg }}</p>

      <p class="security-note">
        {{ demoMode ? 'Demo mode never touches a wallet or any funds.' : 'Transactions are signed in MetaMask. Never share your recovery phrase or private keys.' }}
      </p>
    </section>
  </main>
</template>

<style scoped>
.page-shell { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: #0b0d10; color: #e8ecef; font-family: system-ui, sans-serif; }
.wallet-card { width: 100%; max-width: 520px; background: #14181d; border: 1px solid #232a32; border-radius: 20px; padding: 28px 24px; display: flex; flex-direction: column; gap: 16px; }
.brand-mark { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: #c6ff3d; color: #0b0d10; font-weight: 900; font-size: 22px; }
.eyebrow { margin: 0; letter-spacing: .2em; font-size: 12px; color: #c6ff3d; }
h1 { margin: 0; font-size: 28px; line-height: 1.15; }
h2 { margin: 0; font-size: 16px; }
.intro, .muted { margin: 0; color: #8d98a4; font-size: 14px; }
.small { font-size: 12px; }
.ok { color: #a6f0ad; }
.bad { color: #ff9aa8; }

.connection-panel { display: flex; justify-content: space-between; gap: 12px; padding: 14px; background: #0f1317; border: 1px solid #232a32; border-radius: 14px; }
.connection-details { display: flex; align-items: center; gap: 10px; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; background: #5a6470; }
.status-dot.connected { background: #c6ff3d; box-shadow: 0 0 8px #c6ff3d; }
.detail-label { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #8d98a4; }
.detail-value { margin: 2px 0 0; font-weight: 600; font-size: 14px; }

.button { border: 0; cursor: pointer; border-radius: 12px; padding: 13px 16px; font-weight: 700; font-size: 15px; }
.button-primary { background: #c6ff3d; color: #0b0d10; }
.button-small { padding: 8px 12px; font-size: 13px; background: #232a32; color: #e8ecef; }
.button:disabled { opacity: .5; cursor: not-allowed; }
.link-button { background: none; border: 0; color: #c6ff3d; cursor: pointer; font-size: 13px; padding: 0; }
.align-left { align-self: flex-start; }
.inline-actions { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }

.profile-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.stat { background: #0f1317; border: 1px solid #232a32; border-radius: 12px; padding: 12px 6px; text-align: center; display: flex; flex-direction: column; gap: 4px; }
.stat-value { font-size: 20px; font-weight: 800; }
.stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #8d98a4; }

.send-form, .panel { display: flex; flex-direction: column; gap: 10px; padding: 16px; background: #0f1317; border: 1px solid #232a32; border-radius: 14px; }
.challenge-form { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid #232a32; }
.section-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.network-tag { font-size: 10px; letter-spacing: .12em; padding: 3px 8px; border-radius: 999px; background: #1d2530; color: #c6ff3d; white-space: nowrap; }
label { font-size: 12px; color: #8d98a4; }
input { width: 100%; box-sizing: border-box; background: #14181d; border: 1px solid #2c353f; color: #e8ecef; border-radius: 10px; padding: 12px; font-size: 15px; }
input:focus { outline: 2px solid #c6ff3d55; border-color: #c6ff3d; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.row-inline { display: flex; gap: 8px; }
.amount-input { position: relative; }
.amount-input span { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 12px; color: #8d98a4; }

.badges-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.badge { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 3px; padding: 10px 6px; background: #14181d; border: 1px solid #2d3a1f; border-radius: 12px; }
.badge.locked { border-color: #232a32; opacity: .45; }
.badge-icon { font-size: 24px; line-height: 1; }
.badge-name { font-size: 12px; font-weight: 700; }
.badge-desc { font-size: 10px; color: #8d98a4; line-height: 1.25; }

.challenge-line { margin: 0; font-size: 14px; line-height: 1.4; }
.progress { height: 10px; background: #1d2530; border-radius: 999px; overflow: hidden; }
.progress-bar { height: 100%; background: #c6ff3d; border-radius: 999px; transition: width .3s; }
.pending-box { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.pending-box p { margin: 0; }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.list-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; background: #14181d; border-radius: 10px; }
.history-item { align-items: flex-start; }
.cap { text-transform: capitalize; margin: 0; }
.lift-title { font-weight: 700; display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.pr-badge { font-size: 10px; background: #c6ff3d; color: #0b0d10; border-radius: 6px; padding: 2px 6px; font-weight: 800; }
.spot { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.spot-count { font-size: 13px; color: #c6ff3d; }

.feedback { margin: 0; padding: 12px 14px; border-radius: 12px; font-size: 14px; }
.feedback p { margin: 0 0 4px; }
.feedback-error { background: #2a1519; border: 1px solid #5c2630; color: #ff9aa8; }
.feedback-success { background: #162417; border: 1px solid #2d5a31; color: #a6f0ad; }
.feedback-info { background: #1d2530; border: 1px solid #2c3a4d; color: #b9c9dd; }
.feedback a { color: inherit; font-weight: 600; }
.security-note { margin: 0; font-size: 12px; color: #6b7682; }
</style>
