# X thread (draft, not posted)

Tag @Creditcoin and @worldcoin on 1/. Attach the /judge "Live refusals" screenshot to 5/ and the
/vote screenshot to 7/.

---

1/ Every on-chain credit score scores a wallet.

A wallet is free. Open ten, repay yourself ten times, default on the eleventh at full size.

Humanline scores the person instead, on @Creditcoin, with @worldcoin proof of personhood. 🧵

2/ World ID's identity tree lives on Ethereum. The usual ways to bring it to another chain are a bridge
operator or an oracle signer.

Attestcoin lets Creditcoin verify the real Ethereum transaction that produced each root, with no one in
between.

3/ The precompile proves inclusion. The contract checks the rest: receipt status, the right contract,
exactly one genuine TreeChanged log, calldata that agrees with it, roots that chain, 32 attested blocks
of depth, and at least 3 bonded attestors.

4/ A human proves World ID membership with a zero-knowledge proof verified on Creditcoin itself. Their
nullifier, not their wallet, gets the credit line.

Repay on time: the limit grows. Default: frozen on every wallet they will ever hold.

5/ Don't trust the tests. Twelve attacks are fired at the deployed contracts every time the judge page
loads, no wallet needed: forged proof, decoy log, replay, wrong chain, oversize batch…

12/12 refused, by name. humanline.credit/judge

6/ The attestors' bonded stake also caps how much the pool can lend, read live on every draw. If the
attestor set thins, credit shrinks with it.

7/ Personhood is a primitive, so it ships as one: HumanGated.sol, an SDK, a public API, and /vote, a
one-person-one-vote poll where a second wallet does not buy a second ballot.

npm install @humanline/sdk viem
npmjs.com/package/@humanline/sdk

8/ Everything is open and measured: coverage, invariants, mutation score, gas regression, latency.

github.com/rajkaria/humanline
