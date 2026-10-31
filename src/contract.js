// Nakon deploya IronChain.sol na Sepoliju, zalijepi adresu ovdje.
export const IRONCHAIN_ADDRESS = '0xYOUR_DEPLOYED_CONTRACT_ADDRESS'

export const IRONCHAIN_ABI = [
  'function logLift(string exercise, uint32 weight10, uint16 reps)',
  'function attest(address lifter, uint256 index)',
  'function createChallenge(uint32 targetDays, uint32 durationDays, address beneficiary) payable',
  'function forfeit(address user)',
  'function withdraw()',
  'function getLifts(address lifter) view returns (tuple(string exercise, uint32 weight10, uint16 reps, uint64 timestamp, uint32 est1RM10, bool isPR, uint32 attestations)[])',
  'function getStats(address lifter) view returns (tuple(uint32 currentStreak, uint32 longestStreak, uint32 totalLifts, uint32 totalPRs, uint64 lastDay, uint32 trainingDays))',
  'function hasAttested(address lifter, uint256 index, address spotter) view returns (bool)',
  'function getBadges(address lifter) view returns (uint256)',
  'function getChallenge(address lifter) view returns (tuple(uint128 stake, address beneficiary, uint32 targetDays, uint32 startDays, uint64 deadline, uint8 status))',
  'function pendingOf(address account) view returns (uint256)',
]

// Soulbound badgevi: id = bit u maski koju vraca getBadges()
export const BADGES = [
  { id: 0, icon: '🏋️', name: 'First Rep', desc: 'Log your first set' },
  { id: 1, icon: '🏆', name: 'First PR', desc: 'Set your first personal record' },
  { id: 2, icon: '🔥', name: 'Week Warrior', desc: '7-day training streak' },
  { id: 3, icon: '🌋', name: 'Iron Month', desc: '30-day training streak' },
  { id: 4, icon: '💯', name: 'Centurion', desc: 'Log 100 sets' },
  { id: 5, icon: '⚡', name: 'PR Machine', desc: 'Hit 10 personal records' },
  { id: 6, icon: '🤝', name: 'Vouched', desc: 'Someone vouched for your lift' },
  { id: 7, icon: '👀', name: 'Spotter', desc: 'You vouched for someone else' },
  { id: 8, icon: '💎', name: 'Skin in the Game', desc: 'Win a stake challenge' },
]
