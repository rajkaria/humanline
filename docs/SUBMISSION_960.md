# Humanline: 960-character form answers

For DoraHacks fields capped at 960 characters. Counts include spaces and line breaks (`wc -m`). Longer versions are in `docs/SUBMISSION.md`.

## Project Description (924 characters)

```
One human, one credit line. Humanline gives a verified human an uncollateralized credit line on Creditcoin that follows the person, not the wallet.

Every credit design on Creditcoin scores a wallet, and wallets are free: open ten, repay yourself ten times, default on the eleventh. Humanline keys limits, repayments and defaults to a World ID nullifier instead, so a new wallet is not a new borrower and a default follows the person forever.

World ID's tree lives on Ethereum. USC (Attestcoin) proves each real root update to Creditcoin with no bridge or oracle, and HumanRegistry verifies the Semaphore ZK proof natively on CC3. CreditLine opens one line per human, capped by the attestors' bonded stake.

18 verified contracts, no owner, no pause, no upgrade. Anyone can relay. 12 live attacks refused on every load of humanline.credit/judge. Builders get @humanline/sdk and a public API.

Live: https://humanline.credit
```

## USC Integration Summary (943 characters)

```
USC is the only way a World ID root reaches Creditcoin. Without it: no human, no credit.

AttestedWorldID accepts a root only when the 0x0FD2 BlockProver verifies the real Ethereum registerIdentities transaction, singly via execute or up to 10 per continuity proof via executeBatch. EvmV1Decoder checks what USC does not: the receipt succeeded, it called World's identity manager, exactly one TreeChanged came from it, calldata matches the log, preRoot chains to a known root, no replay.

0x0FD3 ChainInfo enforces 32-block finality. 0x0FD4 AttestorStash enforces a 3-attestor floor and caps total lending at attestors x minimum bond, read on every draw.

The same path proves Aave V3 history, wallet links and USDC repayments from Ethereum. Mainnet and Sepolia run identical code. Local usc-sdk proofs match the hosted prover. 12 named attacks are refused live.

Details: github.com/rajkaria/humanline/blob/main/docs/ATTESTCOIN_INTEGRATION.md
```
