Resume the previous turn, which was cut off by a dropped connection. All 8 contracts already exist in `contracts/` (AssetRegistry, UniswapV4Venue, MirrorVenue, MirrorToken, TemplateRegistry, BucketAccount, BucketFactory, IArcTreasury). Don't rewrite them. Change them only where a test shows a bug.

Finish the remaining steps exactly as specified in the attached `context/.../PROMPT-1-contracts.md`, in order:
1. Write the Foundry tests listed under "Tests", run `forge test`, show the summary, and fix any failures.
2. Deploy to Arc Testnet with `maxFeePerGas` ≥ 20 gwei.
3. Seed as described: list the assets, fetch live prices once (never guess), add the 5 templates, set the roles, and transfer ownership.
4. Run the live smoke test, or skip it as described if the deployer has too little USDC.
5. Write `ARC.md`.

Don't ask questions. Don't build the frontend in this turn.
