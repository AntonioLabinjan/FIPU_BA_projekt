# IRONCHAIN

Gym dnevnik na Sepolia blockchainu: logiranje setova, PR detekcija (Epley 1RM), streak i spotter potvrde.

## Brzi start (DEMO mode, bez ETH-a)
```
npm install
npm run dev
```
Dok u `src/contract.js` nema deployanog ugovora, app automatski radi u **demo modu**: ista pravila kao ugovor,
ali podaci su u localStorage i ne treba ti novčanik. Klikni "Try the demo friend" za spotter mode.

## On-chain mode
1. Otvori `contracts/IronChain.sol` u https://remix.ethereum.org, kompajliraj (0.8.24+), Deploy s "Injected Provider - MetaMask" na Sepoliji (treba Sepolia ETH iz faucet-a).
2. Adresu zalijepi u `src/contract.js` (`IRONCHAIN_ADDRESS`).
3. App pri učitavanju provjeri ima li koda na toj adresi na Sepoliji; ako ima, radi on-chain.
