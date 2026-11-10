// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAssetRegistry, ITemplateRegistry, IVenue, IBucketAccount, BucketParams} from "./IArcTreasury.sol";

/// @notice Individually owned, clone-initialized treasury with permissionless maintenance.
contract BucketAccount is IBucketAccount {
    using SafeERC20 for IERC20;

    uint256 public constant NO_TEMPLATE = type(uint256).max;
    uint256 public constant TIP_CAP = 50_000;
    uint256 public constant TIP_BPS = 10;
    uint256 public constant MAX_ASSETS = 12;
    uint256 public constant MAX_UNIVERSE = 16;
    uint256 private constant BPS = 10_000;
    /// A rebalance leg smaller than this share of the basket is skipped: its spread and gas cost more
    /// than the drift it would fix. 0.25%, well under the smallest allowed band (1%).
    uint256 public constant MIN_LEG_BPS = 25;
    /// Fee assumed for a venue that does not publish one.
    uint256 public constant DEFAULT_FEE_BPS = 30;

    error AlreadyInitialized();
    error BadParams();
    error TooManyAssets();
    error ReentrantCall();
    error SlippageExceeded(uint256 got, uint256 min);
    error IdOutOfRange();

    event PausedSet(bool paused);

    address public override owner;
    address public factory;
    IAssetRegistry public registry;
    ITemplateRegistry public templates;
    address public usdc;
    bool public initialized;
    bool public paused;
    bool private _entered;
    address[] private _tokens;
    uint16[] private _weights;
    BucketParams private _params;
    bool private _following;
    uint256 private _followId;
    uint32 private _followVersion;
    uint64 public lastRebalance;

    uint256 public sipAmount;
    uint32 public sipInterval;
    uint32 public sipRunsLeft;
    uint64 public sipNextAt;
    bool public sipActive;

    struct Position {
        address token;
        uint256 balance;
        uint256 value;
        uint16 weight;
        uint8 risk;
        int32 drift;
    }

    struct Snapshot {
        Position[] positions;
        uint256 total;
        uint16 maxDrift;
        bool exitHeld;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // Unlike constructor-initialized guards, zero is the unlocked state in every clone.
    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    constructor() {
        initialized = true;
    }

    function initialize(
        address owner_,
        IAssetRegistry registry_,
        ITemplateRegistry templates_,
        address[] calldata tokens,
        uint16[] calldata weightsBps,
        BucketParams calldata p,
        uint256 templateId,
        bool follow_
    ) external nonReentrant {
        if (initialized) revert AlreadyInitialized();
        if (owner_ == address(0) || address(registry_) == address(0) || address(templates_) == address(0)) {
            revert BadParams();
        }
        initialized = true;
        owner = owner_;
        factory = msg.sender;
        registry = registry_;
        templates = templates_;
        usdc = registry_.usdc();
        if (usdc == address(0)) revert BadParams();
        registry_.assetOf(usdc);
        _validateParams(p);
        _params = p;
        _followId = templateId;
        if (templateId != NO_TEMPLATE) {
            _followVersion = templates_.templateOf(templateId).version;
        } else if (follow_) {
            revert BadParams();
        }
        _following = follow_;
        _replaceTargets(tokens, weightsBps, templateId, _followVersion);
    }

    function deposit(uint256 usdcAmount) external override nonReentrant {
        if (usdcAmount == 0) revert BadParams();
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), usdcAmount);
        emit Deposited(msg.sender, usdcAmount);
    }

    function withdraw(address token, uint256 amount, address to) external override onlyOwner nonReentrant {
        if (to == address(0)) revert BadParams();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(to, token, amount);
    }

    function withdrawAll(address to) external override onlyOwner nonReentrant {
        if (to == address(0)) revert BadParams();
        // USDC is always a member of the universe, including when its target weight is zero.
        for (uint256 i; i < _tokens.length; ++i) {
            address token = _tokens[i];
            uint256 amount = IERC20(token).balanceOf(address(this));
            if (amount != 0) {
                IERC20(token).safeTransfer(to, amount);
                emit Withdrawn(to, token, amount);
            }
        }
    }

    function setTargets(address[] calldata tokens, uint16[] calldata weightsBps)
        external override onlyOwner nonReentrant
    {
        _following = false;
        _followId = NO_TEMPLATE;
        _followVersion = 0;
        _replaceTargets(tokens, weightsBps, NO_TEMPLATE, 0);
    }

    function followTemplate(uint256 templateId, bool follow_) external override onlyOwner nonReentrant {
        if (!follow_) {
            _following = false;
            return;
        }
        if (templateId >= templates.templateCount()) revert IdOutOfRange();
        ITemplateRegistry.Template memory t = templates.templateOf(templateId);
        _following = true;
        _followId = templateId;
        _followVersion = t.version;
        _replaceTargets(t.tokens, t.weightsBps, templateId, t.version);
    }

    function follow() external view returns (uint256 templateId, bool following, uint32 version) {
        return (_followId, _following, _followVersion);
    }

    function setParams(BucketParams calldata p) external override onlyOwner nonReentrant {
        _validateParams(p);
        _params = p;
    }

    function setPaused(bool p) external override onlyOwner nonReentrant {
        paused = p;
        emit PausedSet(p);
    }

    function targets() external view override returns (address[] memory tokens, uint16[] memory weightsBps) {
        return (_tokens, _weights);
    }

    function params() external view override returns (BucketParams memory) {
        return _params;
    }

    function holdings() external view override returns (
        address[] memory tokens, uint256[] memory amounts, uint256[] memory valuesE18, uint256 totalE18
    ) {
        tokens = _tokens;
        amounts = new uint256[](tokens.length);
        valuesE18 = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            amounts[i] = IERC20(tokens[i]).balanceOf(address(this));
            try registry.valueE18(tokens[i], amounts[i]) returns (uint256 value) {
                valuesE18[i] = value;
                totalE18 += value;
            } catch {
                // A missing or stale price must not make the holdings display unusable.
            }
        }
    }

    function driftBps() external view override returns (uint16 maxDriftBps, int32[] memory perAssetBps) {
        Snapshot memory s = _snapshot();
        perAssetBps = new int32[](s.positions.length);
        for (uint256 i; i < s.positions.length; ++i) {
            perAssetBps[i] = s.positions[i].drift;
        }
        return (s.maxDrift, perAssetBps);
    }

    function rebalance() external override nonReentrant returns (uint16 maxDriftBps) {
        if (paused) revert Paused_();
        _syncTemplate();
        Snapshot memory s = _snapshot();
        maxDriftBps = s.maxDrift;
        if (s.total == 0 || (maxDriftBps <= _params.bandBps && !s.exitHeld)) {
            revert NotNeeded(maxDriftBps);
        }
        uint64 readyAt = lastRebalance + uint64(_params.cooldown);
        if (block.timestamp < readyAt) revert Cooldown(readyAt);
        uint256 capValue = uint256(_params.maxTradeBps) * s.total / BPS;
        uint256 trades;
        // Cost aware, in two phases.
        // 1. Sell what is overweight (legs below MIN_LEG_BPS are skipped: their spread and gas cost
        //    more than the drift they fix). The venue's spread comes out of the proceeds.
        for (uint256 i; i < s.positions.length; ++i) {
            Position memory position = s.positions[i];
            // Exit-level assets are always sold, however small: the risk flag says get out.
            if (position.token != usdc && (position.drift > int32(int256(MIN_LEG_BPS))
                || (position.risk == 3 && position.balance != 0))) {
                if (_sell(position, s.total, capValue)) ++trades;
            }
        }
        // 2. Re-read the basket AFTER the sells, so buys are sized on the cash that actually arrived,
        //    then size them to land ON target once the buy spreads and the caller's tip are paid.
        uint256 tip = _min(TIP_CAP, (s.total / 1e12) * TIP_BPS / BPS); // USDC 6 dp, set aside before buying
        trades += _buyToTarget(capValue, tip);
        if (trades == 0) revert NotNeeded(maxDriftBps);
        lastRebalance = uint64(block.timestamp);
        tip = _payExact(tip);
        emit Rebalanced(msg.sender, s.total, _totalValue(), maxDriftBps, tip);
    }

    /// Buys toward target on the post-sell basket. The holdable value is what remains after the tip
    /// and the buy spreads: N = total - tip - sum(cost_i). Each underweight asset needs d_i = w_i*N - v_i
    /// of value, which costs d_i / (1 - fee_i) of USDC because the venue keeps fee_i. N depends on the
    /// costs and the costs on N, so it is solved with one fixed-point step (the error is fee squared,
    /// under 0.01% at a 0.3% spread). When cash is short every buy is scaled down pro rata, so no asset
    /// is starved just because it comes later in the list.
    function _buyToTarget(uint256 capValue, uint256 tipUsdc) private returns (uint256 trades) {
        Snapshot memory m = _snapshot();
        if (m.total == 0) return 0;
        uint256 tip = tipUsdc * 1e12; // E18, reserved for the caller
        uint256 n = m.total > tip ? m.total - tip : 0;
        uint256 len = m.positions.length;
        // If idle cash is itself outside the band, every buy goes ahead, however small: otherwise a
        // wide basket could hold extra cash forever with each leg under the dust floor.
        bool cashOut;
        for (uint256 i; i < len; ++i) {
            if (m.positions[i].token == usdc && m.positions[i].drift > int32(uint32(_params.bandBps))) cashOut = true;
        }
        uint256[] memory fee = new uint256[](len);
        uint256 cost;
        for (uint256 pass; pass < 2; ++pass) {
            uint256 holdable = n > cost ? n - cost : 0;
            cost = 0;
            for (uint256 i; i < len; ++i) {
                Position memory p = m.positions[i];
                if (p.token == usdc || p.risk >= 2) continue;
                uint256 want = uint256(p.weight) * holdable / BPS;
                if (want <= p.value) continue;
                if (pass == 0) fee[i] = _feeBps(registry.assetOf(p.token).venue);
                cost += (want - p.value) * fee[i] / (BPS - fee[i]);
            }
        }
        uint256 holdableFinal = n > cost ? n - cost : 0;
        uint256[] memory spend = new uint256[](len);
        uint256 total; // USDC, 6 decimals
        for (uint256 i; i < len; ++i) {
            Position memory p = m.positions[i];
            if (p.token == usdc || p.risk >= 2) continue;
            uint256 want = uint256(p.weight) * holdableFinal / BPS;
            if (want <= p.value) continue;
            uint256 gap = want - p.value;
            if (!cashOut && gap * BPS <= MIN_LEG_BPS * m.total) continue; // dust: not worth a trade
            uint256 s = _min(gap * BPS / (BPS - fee[i]), capValue) / 1e12;
            spend[i] = s;
            total += s;
        }
        if (total == 0) return 0;
        // Cash the buys may use: everything except the reserved tip and the basket's own cash target.
        uint256 cash = IERC20(usdc).balanceOf(address(this));
        uint256 keep = tip / 1e12;
        for (uint256 i; i < len; ++i) {
            if (m.positions[i].token == usdc) keep += uint256(m.positions[i].weight) * holdableFinal / BPS / 1e12;
        }
        uint256 avail = cash > keep ? cash - keep : 0;
        for (uint256 i; i < len; ++i) {
            uint256 s = spend[i];
            if (s == 0) continue;
            if (total > avail) s = s * avail / total; // pro rata when short
            if (s == 0) continue;
            _buy(m.positions[i].token, s);
            ++trades;
        }
    }

    /// The venue's posted fee in bps: MirrorVenue.spreadBps(), or a Uniswap v4 pool's fee from key()
    /// (pips, 100 pips = 1 bp). Unknown venues are assumed to charge DEFAULT_FEE_BPS. Capped at 3%.
    function _feeBps(address venue) private view returns (uint256 f) {
        f = DEFAULT_FEE_BPS;
        (bool ok, bytes memory out) = venue.staticcall(abi.encodeWithSignature("spreadBps()"));
        if (ok && out.length >= 32) {
            f = abi.decode(out, (uint256));
        } else {
            (ok, out) = venue.staticcall(abi.encodeWithSignature("key()"));
            if (ok && out.length >= 160) {
                (,, uint24 pips,,) = abi.decode(out, (address, address, uint24, int24, address));
                f = uint256(pips) / 100;
            }
        }
        if (f > 300) f = 300;
    }

    function setSip(uint256 amountUsdc, uint32 interval, uint32 runs) external override onlyOwner nonReentrant {
        if (amountUsdc == 0 || interval < 3600 || runs == 0 || runs > 520) revert BadParams();
        sipAmount = amountUsdc;
        sipInterval = interval;
        sipRunsLeft = runs;
        sipNextAt = uint64(block.timestamp + interval);
        sipActive = true;
        emit SipSet(amountUsdc, interval, runs);
    }

    function cancelSip() external override onlyOwner nonReentrant {
        sipActive = false;
        sipRunsLeft = 0;
        emit SipSet(0, 0, 0);
    }

    function sip() external view override returns (uint256 amountUsdc, uint32 interval, uint32 runsLeft, uint64 nextAt) {
        return (sipAmount, sipInterval, sipRunsLeft, sipNextAt);
    }

    function executeSip() external override nonReentrant {
        if (paused) revert Paused_();
        if (!sipActive || sipRunsLeft == 0) revert SipInactive();
        if (block.timestamp < sipNextAt) revert SipNotDue(sipNextAt);
        --sipRunsLeft;
        uint256 scheduled = uint256(sipNextAt) + sipInterval;
        sipNextAt = uint64(scheduled > block.timestamp ? scheduled : block.timestamp);
        if (sipRunsLeft == 0) sipActive = false;
        uint256 amount = sipAmount;
        IERC20(usdc).safeTransferFrom(owner, address(this), amount);
        // SIP uses stored targets, not risk-redistributed weights or an implicit template sync.
        for (uint256 i; i < _tokens.length; ++i) {
            address token = _tokens[i];
            if (token == usdc || _weights[i] == 0) continue;
            if (registry.riskOf(token) >= 2) continue;
            uint256 share = amount * _weights[i] / BPS;
            if (share != 0) _buy(token, share);
        }
        _payTip(_totalValue());
        emit SipExecuted(msg.sender, amount, sipRunsLeft);
    }

    function _validateParams(BucketParams memory p) private pure {
        if (p.bandBps < 100 || p.bandBps > 2000 || p.maxSlippageBps < 10 || p.maxSlippageBps > 300
            || p.maxTradeBps < 500 || p.maxTradeBps > 5000 || p.cooldown < 600) revert BadParams();
    }

    function _replaceTargets(address[] memory tokens, uint16[] memory weights, uint256 templateId, uint32 version)
        private
    {
        uint256 length = tokens.length;
        if (length == 0 || length > MAX_ASSETS || length != weights.length) revert BadWeights();
        address[] memory universe = new address[](MAX_UNIVERSE);
        uint16[] memory newWeights = new uint16[](MAX_UNIVERSE);
        uint256 sum;
        for (uint256 i; i < length; ++i) {
            if (weights[i] == 0) revert BadWeights();
            if (_contains(universe, i, tokens[i])) revert BadWeights();
            registry.assetOf(tokens[i]);
            universe[i] = tokens[i];
            newWeights[i] = weights[i];
            sum += weights[i];
        }
        if (sum != BPS) revert BadWeights();
        if (!_contains(universe, length, usdc)) universe[length++] = usdc;
        for (uint256 i; i < _tokens.length; ++i) {
            address token = _tokens[i];
            if (!_contains(universe, length, token) && IERC20(token).balanceOf(address(this)) != 0) {
                if (length == MAX_UNIVERSE) revert TooManyAssets();
                universe[length++] = token;
            }
        }
        delete _tokens;
        delete _weights;
        for (uint256 i; i < length; ++i) {
            _tokens.push(universe[i]);
            _weights.push(newWeights[i]);
        }
        emit TargetsSet(_tokens, _weights, templateId, version);
    }

    function _contains(address[] memory tokens, uint256 length, address token) private pure returns (bool) {
        for (uint256 i; i < length; ++i) {
            if (tokens[i] == token) return true;
        }
        return false;
    }

    function _syncTemplate() private {
        if (!_following) return;
        ITemplateRegistry.Template memory t = templates.templateOf(_followId);
        if (t.version > _followVersion) {
            _followVersion = t.version;
            _replaceTargets(t.tokens, t.weightsBps, _followId, t.version);
        }
    }

    function _snapshot() private view returns (Snapshot memory s) {
        uint256 length = _tokens.length;
        s.positions = new Position[](length);
        uint256 cashIndex;
        uint16 exitWeight;
        for (uint256 i; i < length; ++i) {
            Position memory p;
            p.token = _tokens[i];
            p.weight = _weights[i];
            p.balance = IERC20(p.token).balanceOf(address(this));
            p.value = registry.valueE18(p.token, p.balance);
            if (p.token == usdc) {
                cashIndex = i;
            } else {
                p.risk = registry.riskOf(p.token);
                if (p.risk == 3) {
                    exitWeight += p.weight;
                    p.weight = 0;
                    if (p.balance != 0 && p.value != 0) s.exitHeld = true;
                }
            }
            s.total += p.value;
            s.positions[i] = p;
        }
        if (length == 0) return s;
        s.positions[cashIndex].weight += exitWeight;
        if (s.total == 0) return s;
        for (uint256 i; i < length; ++i) {
            int32 drift = int32(int256(s.positions[i].value * BPS / s.total) - int256(uint256(s.positions[i].weight)));
            s.positions[i].drift = drift;
            uint16 magnitude = uint16(uint32(drift < 0 ? -drift : drift));
            if (magnitude > s.maxDrift) s.maxDrift = magnitude;
        }
    }

    function _sell(Position memory p, uint256 total, uint256 capValue) private returns (bool) {
        uint256 sellValue = _min(uint256(int256(p.drift)) * total / BPS, capValue);
        uint256 amount = _min(_amountForValue(p.token, sellValue), p.balance);
        if (amount == 0) return false;
        uint256 referenceOut = registry.valueE18(p.token, amount) / 1e12;
        address venue = registry.assetOf(p.token).venue;
        _swap(p.token, usdc, amount, _minOut(referenceOut, venue), venue);
        return true;
    }

    function _buy(address token, uint256 spend) private {
        uint256 referenceOut = _amountForValue(token, spend * 1e12);
        address venue = registry.assetOf(token).venue;
        _swap(usdc, token, spend, _minOut(referenceOut, venue), venue);
    }

    /// The least a trade may return: the oracle amount, less the venue's posted fee, less the owner's
    /// slippage bound. The fee is known in advance, so max slippage only has to cover real price impact
    /// and oracle lag (before, a 0.3% spread silently consumed most of a 1% bound, and anything under
    /// 0.3% could never fill). The fee comes from the venue the registry owner listed, capped at 3%.
    function _minOut(uint256 referenceOut, address venue) private view returns (uint256) {
        return referenceOut * (BPS - _feeBps(venue)) / BPS * (BPS - _params.maxSlippageBps) / BPS;
    }

    function _amountForValue(address token, uint256 value) private view returns (uint256) {
        IAssetRegistry.Asset memory asset = registry.assetOf(token);
        (uint256 price,) = registry.priceE8(token);
        return value * (10 ** uint256(asset.decimals)) / (price * 1e10);
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address venue) private {
        if (venue == address(0)) revert BadParams();
        uint256 beforeOut = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(venue, amountIn);
        IVenue(venue).swap(tokenIn, tokenOut, amountIn, minOut, address(this));
        IERC20(tokenIn).forceApprove(venue, 0);
        uint256 afterOut = IERC20(tokenOut).balanceOf(address(this));
        uint256 received = afterOut >= beforeOut ? afterOut - beforeOut : 0;
        if (received < minOut) revert SlippageExceeded(received, minOut);
        emit TradeExecuted(tokenIn, tokenOut, amountIn, received, venue);
    }

    function _totalValue() private view returns (uint256 total) {
        for (uint256 i; i < _tokens.length; ++i) {
            total += registry.valueE18(_tokens[i], IERC20(_tokens[i]).balanceOf(address(this)));
        }
    }

    /// Pays the caller the tip reserved before the buys (or whatever USDC is left, if less).
    function _payExact(uint256 tip) private returns (uint256) {
        uint256 cash = IERC20(usdc).balanceOf(address(this));
        if (tip > cash) tip = cash;
        if (tip != 0) IERC20(usdc).safeTransfer(msg.sender, tip);
        return tip;
    }

    function _payTip(uint256 valueE18) private returns (uint256 tip) {
        tip = _min(TIP_CAP, (valueE18 / 1e12) * TIP_BPS / BPS);
        if (tip != 0) {
            if (IERC20(usdc).balanceOf(address(this)) >= tip) {
                IERC20(usdc).safeTransfer(msg.sender, tip);
            } else {
                tip = 0;
            }
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
