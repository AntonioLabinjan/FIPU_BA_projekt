// Nakon deploya IronChain.sol na Sepoliju, zalijepi adresu ovdje.
export const IRONCHAIN_ADDRESS = '0xYOUR_DEPLOYED_CONTRACT_ADDRESS'

export const IRONCHAIN_ABI = [
  'function logLift(string exercise, uint32 weight10, uint16 reps)',
  'function attest(address lifter, uint256 index)',
  'function getLifts(address lifter) view returns (tuple(string exercise, uint32 weight10, uint16 reps, uint64 timestamp, uint32 est1RM10, bool isPR, uint32 attestations)[])',
  'function getStats(address lifter) view returns (tuple(uint32 currentStreak, uint32 longestStreak, uint32 totalLifts, uint32 totalPRs, uint64 lastDay))',
  'function hasAttested(address lifter, uint256 index, address spotter) view returns (bool)',
]
