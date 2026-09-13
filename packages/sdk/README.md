# @humanline/sdk

Sybil resistance on Creditcoin. Ask whether a wallet belongs to a verified human, read that human's
credit line, and gate your own contracts to one action per person.

Humanline mirrors World ID's identity tree onto Creditcoin through the Attestcoin Protocol, verifies
the World ID zero-knowledge proof on Creditcoin itself, and binds each human (a World ID nullifier) to
one wallet at a time. A person who moves to a new wallet keeps their history and cannot start over.

```bash
npm install @humanline/sdk viem
```

## Read from TypeScript

```ts
import { createHumanlineClient, isHuman, humanOf, lineOf, profileOf } from "@humanline/sdk";

const client = createHumanlineClient(); // CC3 testnet, no wallet needed

await isHuman(client, "0x…");            // true when the wallet is bound to a verified human
const human = await humanOf(client, "0x…"); // the nullifier, or 0n
const line = await lineOf(client, human);   // limit, principal, available, due date, repaid/late counts
const all = await profileOf(client, "0x…"); // everything above in one call
```

Every read takes `{ profile: "staging" | "production" }` (World's Sepolia staging tree, or the
Ethereum mainnet Orb tree) or `{ deployment }` with your own addresses. Any viem `PublicClient` works.

## React

```tsx
import { useHuman } from "@humanline/sdk/react";

function Gate({ address }: { address?: `0x${string}` }) {
  const { loading, isHuman, line } = useHuman(address, { refreshMs: 15_000 });
  if (loading) return <p>Checking…</p>;
  return isHuman ? <p>Verified human, {String(line?.available)} hUSD available</p> : <a href="https://humanline.credit/app">Verify once</a>;
}
```

No wagmi requirement: pass the address from whatever wallet library you use.

## Solidity

```solidity
import {HumanGated} from "@humanline/sdk/contracts/HumanGated.sol";

contract Airdrop is HumanGated {
    constructor(address registry) HumanGated(registry) {}

    function claim() external oncePerHuman("airdrop-1") {
        // one claim per human, from whichever wallet they hold today
    }

    function vote() external onlyHuman {}
}
```

Registry addresses: staging `0x62c2fd99ea587e4b466175ad248468782bd5298d`, production
`0x53fcba2cd9296b22635c67d5e73777b4e5db96af` (Creditcoin CC3 testnet, chainId 102031).

A complete consumer app built on this package is `HumanPoll`, one person one vote, at
[humanline.credit/vote](https://humanline.credit/vote).

## HTTP, if you are not on JavaScript

`GET https://humanline.credit/api/v1/human/{address}` and `GET https://humanline.credit/api/v1/line/{nullifier}`,
CORS open, documented at [humanline.credit/api](https://humanline.credit/api).

MIT licensed. Source: [github.com/rajkaria/humanline](https://github.com/rajkaria/humanline/tree/main/packages/sdk).
