<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BrowserProvider, Contract, JsonRpcProvider, isAddress } from 'ethers'
import { IRONCHAIN_ABI, IRONCHAIN_ADDRESS } from './contract'
import { DEMO_FRIEND, demoApi, getDemoAddress, resetDemo } from './demo'

const SEPOLIA_CHAIN_ID = '0xaa36a7'
const SEPOLIA_CHAIN_NUMBER = 11155111
const SEPOLIA_READ_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const EXERCISES = ['Bench press', 'Squat', 'Deadlift', 'Overhead press', 'Barbell row', 'Pull-up']

const account = ref('')
const chainId = ref('')
const viewAddress = ref('')
const lookupInput = ref('')

const exercise = ref(EXERCISES[0])
const weight = ref('')
const reps = ref('')

const lifts = ref([])
const stats = ref({ currentStreak: 0, longestStreak: 0, totalLifts: 0, totalPRs: 0 })
const attestedByMe = ref({})

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
const ready = computed(() => (demoMode.value ? true : contractLive.value === true && isConnected.value && isOnSepolia.value))
const isOwnProfile = computed(() => Boolean(me.value) && viewAddress.value.toLowerCase() === me.value.toLowerCase())
const networkName = computed(() => {
  if (demoMode.value) return 'Demo (local)'
  if (!chainId.value) return 'Not connected'
  return isOnSepolia.value ? 'Sepolia' : `Unsupported network (${chainId.value})`
})

const shortAddr = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '')
const fmtKg = (v10) => (v10 / 10).toFixed(1).replace(/\.0$/, '')
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

function displayError(error) {
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'The wallet request was rejected.'
  return error?.reason || error?.shortMessage || error?.message || 'Something went wrong. Please try again.'
}

// --- A/B odluka: postoji li legit ugovor na Sepoliji? ---
async function detectContract() {
  contractLive.value = null
  if (!isAddress(IRONCHAIN_ADDRESS)) {
    contractLive.value = false
    return
  }
  try {
    const provider = new JsonRpcProvider(SEPOLIA_READ_RPC, SEPOLIA_CHAIN_NUMBER, { staticNetwork: true })
    const code = await Promise.race([
      provider.getCode(IRONCHAIN_ADDRESS),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ])
    contractLive.value = code !== '0x'
  } catch {
    contractLive.value = false
  }
}

async function getContract(withSigner = false) {
  const provider = new BrowserProvider(ethereum)
  const runner = withSigner ? await provider.getSigner() : provider
  return new Contract(IRONCHAIN_ADDRESS, IRONCHAIN_ABI, runner)
}

async function loadProfile() {
  if (!ready.value || !isAddress(viewAddress.value) || !me.value) return
  isLoading.value = true
  try {
    if (demoMode.value) {
      const res = await demoApi.loadProfile(viewAddress.value, me.value)
      lifts.value = res.lifts
      stats.value = res.stats
      attestedByMe.value = res.attested
      return
    }

    const contract = await getContract()
    const [rawLifts, rawStats] = await Promise.all([
      contract.getLifts(viewAddress.value),
      contract.getStats(viewAddress.value),
    ])
    lifts.value = rawLifts.map((l, index) => ({
      index,
      exercise: l.exercise,
      weight10: Number(l.weight10),
      reps: Number(l.reps),
      timestamp: Number(l.timestamp),
      est1RM10: Number(l.est1RM10),
      isPR: l.isPR,
      attestations: Number(l.attestations),
    }))
    stats.value = {
      currentStreak: Number(rawStats.currentStreak),
      longestStreak: Number(rawStats.longestStreak),
      totalLifts: Number(rawStats.totalLifts),
      totalPRs: Number(rawStats.totalPRs),
    }

    attestedByMe.value = {}
    if (!isOwnProfile.value) {
      const flags = await Promise.all(
        lifts.value.map((l) => contract.hasAttested(viewAddress.value, l.index, me.value)),
      )
      flags.forEach((f, i) => (attestedByMe.value[i] = f))
    }
  } catch (error) {
    walletError.value = displayError(error)
  } finally {
    isLoading.value = false
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
    if (!viewAddress.value || viewAddress.value.toLowerCase() === (prev || '').toLowerCase()) {
      viewAddress.value = next
    }
  },
  { immediate: true },
)
watch([viewAddress, chainId, account, contractLive], loadProfile)

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
  successMsg.value = 'Demo data reset.'
  loadProfile()
}

async function logLift() {
  walletError.value = ''
  txHash.value = ''
  successMsg.value = ''

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
  isSending.value = true
  try {
    if (demoMode.value) {
      await demoApi.logLift(me.value, name, weight10, repCount)
      successMsg.value = 'Set saved locally (demo mode).'
    } else {
      const contract = await getContract(true)
      const tx = await contract.logLift(name, weight10, repCount)
      txHash.value = tx.hash
      await tx.wait()
      successMsg.value = 'Set confirmed on-chain.'
    }
    weight.value = ''
    reps.value = ''
    await loadProfile()
  } catch (error) {
    txHash.value = ''
    walletError.value = displayError(error)
  } finally {
    isSending.value = false
  }
}

async function attest(lift) {
  walletError.value = ''
  attestingIndex.value = lift.index
  try {
    if (demoMode.value) {
      await demoApi.attest(me.value, viewAddress.value, lift.index)
    } else {
      const contract = await getContract(true)
      const tx = await contract.attest(viewAddress.value, lift.index)
      await tx.wait()
    }
    await loadProfile()
  } catch (error) {
    walletError.value = displayError(error)
  } finally {
    attestingIndex.value = -1
  }
}
</script>

<template>
  <main class="page-shell">
    <section class="wallet-card" aria-labelledby="page-title">
      <div class="brand-mark" aria-hidden="true">I</div>
      <p class="eyebrow">IRONCHAIN</p>
      <h1 id="page-title">Lift it. Log it. Prove it.</h1>
      <p class="intro">
        Every set is stored on Sepolia. PRs are detected by the contract, and a spotter can vouch for your lifts.
      </p>

      <p v-if="contractLive === null" class="feedback feedback-info" role="status">Checking for the contract on Sepolia...</p>
      <div v-else-if="demoMode" class="feedback feedback-info" role="status">
        <p><strong>DEMO MODE</strong> - no IronChain contract found on Sepolia, so data lives in this browser only.</p>
        <p class="muted">Deploy the contract and set its address in src/contract.js to go on-chain.</p>
        <button class="link-button" type="button" @click="resetDemoData">Reset demo data</button>
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

      <template v-if="ready">
        <!-- STATS -->
        <div class="profile-bar">
          <p class="detail-label">
            {{ isOwnProfile ? 'Your profile' : `Spotting ${shortAddr(viewAddress)}` }}
          </p>
          <button v-if="!isOwnProfile" class="link-button" type="button" @click="backToMe">Back to me</button>
        </div>

        <div class="stats-grid">
          <div class="stat"><span class="stat-value">{{ stats.currentStreak }}🔥</span><span class="stat-label">Day streak</span></div>
          <div class="stat"><span class="stat-value">{{ stats.longestStreak }}</span><span class="stat-label">Best streak</span></div>
          <div class="stat"><span class="stat-value">{{ stats.totalLifts }}</span><span class="stat-label">Sets logged</span></div>
          <div class="stat"><span class="stat-value">{{ stats.totalPRs }}</span><span class="stat-label">PRs</span></div>
        </div>

        <!-- LOG FORM (samo na vlastitom profilu) -->
        <form v-if="isOwnProfile" class="send-form" @submit.prevent="logLift">
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
                  v-if="!isOwnProfile"
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

        <!-- SPOTTER MODE -->
        <form class="panel spot-form" @submit.prevent="openLookup">
          <div class="section-heading"><h2>Spot a friend</h2></div>
          <div class="row-inline">
            <input v-model="lookupInput" autocomplete="off" spellcheck="false" placeholder="Friend's address 0x..." />
            <button class="button button-small" type="submit">Open</button>
          </div>
          <button v-if="demoMode" class="link-button align-left" type="button" @click="openDemoFriend">
            Try the demo friend (7-day streak)
          </button>
        </form>
      </template>

      <p v-if="walletError" class="feedback feedback-error" role="alert">{{ walletError }}</p>
      <div v-if="txHash" class="feedback feedback-success" role="status">
        <p>{{ isSending ? 'Transaction submitted, waiting for confirmation...' : 'Set confirmed on-chain.' }}</p>
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

.profile-bar { display: flex; justify-content: space-between; align-items: center; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.stat { background: #0f1317; border: 1px solid #232a32; border-radius: 12px; padding: 12px 6px; text-align: center; display: flex; flex-direction: column; gap: 4px; }
.stat-value { font-size: 20px; font-weight: 800; }
.stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #8d98a4; }

.send-form, .panel { display: flex; flex-direction: column; gap: 10px; padding: 16px; background: #0f1317; border: 1px solid #232a32; border-radius: 14px; }
.section-heading { display: flex; justify-content: space-between; align-items: center; }
.network-tag { font-size: 10px; letter-spacing: .12em; padding: 3px 8px; border-radius: 999px; background: #1d2530; color: #c6ff3d; }
label { font-size: 12px; color: #8d98a4; }
input { width: 100%; box-sizing: border-box; background: #14181d; border: 1px solid #2c353f; color: #e8ecef; border-radius: 10px; padding: 12px; font-size: 15px; }
input:focus { outline: 2px solid #c6ff3d55; border-color: #c6ff3d; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.row-inline { display: flex; gap: 8px; }
.amount-input { position: relative; }
.amount-input span { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 12px; color: #8d98a4; }

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
