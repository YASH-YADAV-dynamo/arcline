// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// OpenAlpha on Arc: the stable interfaces the web app (web/src/lib/integrations/arc.ts) codes against.
// Arc Studio must implement these exactly: names, argument order, return tuples and event shapes.
// Testnet only (Arc Testnet, chain id 5042002). Settlement asset: USDC via its ERC-20 interface at
// 0x3600000000000000000000000000000000000000 (6 decimals). Never mix native msg.value (18 decimals) with
// ERC-20 amounts (6 decimals): neither contract accepts native value.

/// @notice USDC bounty escrow per research issue. Funders escrow, a settler posts payees + basis points,
///         payees pull their share, funders take back what is unallocated (or everything after expiry).
interface IOpenAlphaBountyVault {
    // ---------- events ----------
    event SettlerSet(address indexed settler, bool allowed);
    /// @param total escrowed for this issue after this deposit (6 decimals)
    event BountyFunded(bytes32 indexed issueId, address indexed funder, uint256 amount, uint256 total, uint64 expiresAt);
    /// @param allocated USDC credited to payees (6 decimals); total - allocated stays refundable to funders
    event BountySettled(bytes32 indexed issueId, bytes32 evidenceHash, address[] payees, uint16[] bps, uint256 allocated);
    event Claimed(bytes32 indexed issueId, address indexed payee, uint256 amount);
    event Refunded(bytes32 indexed issueId, address indexed funder, uint256 amount);

    // ---------- errors ----------
    error NotSettler();
    error ZeroAmount();
    error BadExpiry();
    error AlreadySettled();
    error NotFunded();
    error Expired();
    error NotExpired();
    error BadSplit(); // empty / mismatched arrays, > 50 payees, zero or duplicate payee, zero bps, or sum > 10000
    error NothingToClaim();
    error NothingToRefund();

    // ---------- writes ----------
    /// @notice Escrow `amount` USDC (6 decimals) for `issueId`. Caller must approve this vault first.
    ///         The first deposit sets `expiresAt` (must be in the future); later deposits pass 0 or the same value.
    function fund(bytes32 issueId, uint256 amount, uint64 expiresAt) external;

    /// @notice Settler only, once per issue, before expiry. Credits total * bps[i] / 10000 to payees[i].
    ///         sum(bps) <= 10000; the rounding dust and any unallocated share stay refundable to funders.
    function settle(bytes32 issueId, address[] calldata payees, uint16[] calldata bps, bytes32 evidenceHash) external;

    /// @notice Pull payment of the caller's credited share for `issueId`.
    function claim(bytes32 issueId) external;

    /// @notice Unsettled + expired: the caller's full contribution. Settled: the caller's pro-rata part of the
    ///         unallocated remainder. Each funder can refund once per issue.
    function refund(bytes32 issueId) external;

    /// @notice Owner only.
    function setSettler(address settler, bool allowed) external;

    // ---------- views ----------
    function usdc() external view returns (address);
    function isSettler(address account) external view returns (bool);
    function bountyOf(bytes32 issueId)
        external
        view
        returns (uint256 total, uint64 expiresAt, bool settled, uint16 allocatedBps, bytes32 evidenceHash);
    function contributionOf(bytes32 issueId, address funder) external view returns (uint256);
    function claimable(bytes32 issueId, address payee) external view returns (uint256);
    function totalEscrowed() external view returns (uint256);
}

/// @notice Proof log of research-driven rebalances of the OpenAlpha PAPER basket. Holds no user funds.
interface IOpenAlphaBasketLedger {
    event RecorderSet(address indexed recorder, bool allowed);
    /// @param seq strictly lastSeq(basketId) + 1
    event Rebalanced(
        bytes32 indexed basketId,
        uint64 indexed seq,
        string[] symbols,
        uint16[] weightsBps,
        bytes32 researchHash,
        bytes32 findingsHash,
        address recorder
    );

    error NotRecorder();
    error BadSeq(uint64 expected, uint64 got);
    error BadWeights(); // empty / mismatched arrays, > 16 entries, symbol not 1..11 bytes, or sum != 10000

    /// @notice Recorder only. `weightsBps` sums to exactly 10000. `researchHash` commits to the research that
    ///         moved the basket; `findingsHash` = keccak256 of the accepted finding ids at that moment.
    function recordRebalance(
        bytes32 basketId,
        uint64 seq,
        string[] calldata symbols,
        uint16[] calldata weightsBps,
        bytes32 researchHash,
        bytes32 findingsHash
    ) external;

    /// @notice Owner only.
    function setRecorder(address recorder, bool allowed) external;

    function lastSeq(bytes32 basketId) external view returns (uint64);
    function latest(bytes32 basketId)
        external
        view
        returns (uint64 seq, bytes32 researchHash, bytes32 findingsHash, uint64 recordedAt);
    function weightsOf(bytes32 basketId) external view returns (string[] memory symbols, uint16[] memory weightsBps);
    function isRecorder(address account) external view returns (bool);
    /// @notice Always "paper/testnet: proof log only, holds no user funds".
    function LABEL() external view returns (string memory);
}
