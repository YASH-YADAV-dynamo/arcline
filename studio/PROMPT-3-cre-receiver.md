# Turn 3: deploy CreReceiver (small, contracts only)

Context: the Chainlink CRE forwarder on Arc Testnet (`0x6e9ee680ef59ef64aa8c7371279c27e496b5edc1`) only delivers reports to receivers that implement ERC-165 `supportsInterface(IReceiver)`. Our deployed `AssetRegistry` (`0x79E37808c2187B949D36c0295C7947154CD85A47`) does not, so reports are dropped. Do NOT redeploy or modify AssetRegistry or any other existing contract; buckets depend on them.

`contracts/CreReceiver.sol` is already in place (final code, keep its logic as-is). Do exactly this and stop:

1. Add `contracts/test/CreReceiver.t.sol` (forge-std) with a tiny mock registry that records the last (metadata, report). Tests:
   - `supportsInterface(0x805f2132)` and `supportsInterface(0x01ffc9a7)` are true; `0xffffffff` is false.
   - forwarder call relays the exact bytes to the registry and emits `Relayed(kind, len)` (kind from the first ABI word, e.g. abi.encode(uint8(1), bytes("x"))).
   - non-forwarder call reverts `NotForwarder`; zero constructor args revert `ZeroAddress`.
2. `forge build` and `forge test --match-contract CreReceiver`. Fix only real errors.
3. Deploy `CreReceiver` to Arc Testnet with constructor args
   `(0x6e9ee680ef59ef64aa8c7371279c27e496b5edc1, 0x79E37808c2187B949D36c0295C7947154CD85A47)` and report the address.
4. Add one line to README.md under contracts: "CreReceiver — ERC-165 adapter that relays Chainlink CRE forwarder reports into AssetRegistry.onReport (registry owner authorizes it via setReporter)."

No frontend changes, no other contracts, keep the turn short.
