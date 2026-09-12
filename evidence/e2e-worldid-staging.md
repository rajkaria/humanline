# End-to-end: World ID (staging, simulator) → Creditcoin CC3 — 2026-09-12 09:27 UTC

- Request: IDKit 4.2 `IDKit.request({... allow_legacy_proofs: true, environment: "staging"}).preset(orbLegacy({ signal: wallet }))`, rp_context signed with the Humanline RP key (rp_84b02642423cadf5).
- Identity: World simulator "Identity #0" (Orb level). Response protocol_version 3.0, fields identifier / merkle_root / nullifier / proof / signal_hash (see e2e-worldid-staging-result.json).
- merkle_root 0x0de7c26c4679912f801c48db0dc1907f6b0ecfacad4e6c1f2b4ad203e9d9fca9 = the Sepolia staging root relayed by Attestcoin into AttestedWorldIDSepolia 0x3a7c3cc67034197208923587b8dc5c4674cbcef7 (isValidRoot → true).
- HumanRegistry.register on CC3: tx 0x930a22ebeb19e5c46609c3ab67a073f7c8dc6501c5ab33735e8ea1fe588f6ebf, status 1, gas 336,396 (Groth16 verification on bn128 + binding).
- Result: isHuman(0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3) = true, humanOf = 0x06d6d24ba1cb97b3d3456e9a3bdfc4f707072ecd96e79998dfb7dce49529b6d4.
- Script: web/scripts/e2e-worldid.ts
