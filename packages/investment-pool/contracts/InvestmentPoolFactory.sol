// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

// Superfluid imports
import {ISuperfluid, ISuperToken, ISuperApp, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

// Openzepelin imports
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import {IInvestmentPool, IInitializableInvestmentPool} from "./interfaces/IInvestmentPool.sol";
import {IInvestmentPoolFactory} from "./interfaces/IInvestmentPoolFactory.sol";
import {IGelatoOps} from "./interfaces/IGelatoOps.sol";
import {InvestmentPool} from "./InvestmentPool.sol";

error InvestmentPoolFactory__addressIsZero();

contract InvestmentPoolFactory is IInvestmentPoolFactory, Context {
    // Assign all Clones library functions to addresses
    using Clones for address;

    uint48 public constant VOTING_PERIOD = 7 days;
    uint48 public constant TERMINATION_WINDOW = 12 hours;
    uint48 public constant AUTOMATED_TERMINATION_WINDOW = 1 hours;
    // TODO: Add min/max durations for fundraiser campaign and milestone respectively
    uint public constant MILESTONE_MIN_DURATION = 30 days;
    uint public constant FUNDRAISER_MAX_DURATION = 90 days;

    // TODO: Arbitrary choice, set this later to something that makes sense
    uint32 public constant MAX_MILESTONE_COUNT = 10;

    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    ISuperfluid public immutable HOST;
    IGelatoOps public immutable GELATO_OPS;
    address internal investmentPoolImplementation;

    constructor(
        ISuperfluid _host,
        IGelatoOps _gelatoOps,
        address _implementationContract
    ) {
        assert(address(_host) != address(0));
        if (address(0) == _implementationContract)
            revert InvestmentPoolFactory__addressIsZero();

        HOST = _host;
        GELATO_OPS = _gelatoOps;

        // Assign Investment Pool logic contract
        investmentPoolImplementation = _implementationContract;
    }

    function createInvestmentPool(
        ISuperToken _acceptedToken,
        uint96 _softCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        ProxyType _proxyType,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) external returns (IInvestmentPool) {
        IInitializableInvestmentPool invPool;
        _assertPoolInitArguments(
            HOST,
            _acceptedToken,
            _msgSender(),
            _softCap,
            _fundraiserStartAt,
            _fundraiserEndAt,
            _milestones
        );

        if (_proxyType == ProxyType.CLONE_PROXY) {
            invPool = _deployClone();
        } else {
            revert("[IPF]: only CLONE_PROXY is supported");
        }

        invPool.initialize(
            HOST,
            _acceptedToken,
            _msgSender(),
            GELATO_OPS,
            _softCap,
            _fundraiserStartAt,
            _fundraiserEndAt,
            VOTING_PERIOD,
            TERMINATION_WINDOW,
            AUTOMATED_TERMINATION_WINDOW,
            _milestones
        );

        // Final level is required by the Superfluid's spec right now
        // We only really care about termination callbacks, others - noop
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL |
            SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP |
            SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP |
            SuperAppDefinitions.AFTER_AGREEMENT_CREATED_NOOP |
            SuperAppDefinitions.AFTER_AGREEMENT_UPDATED_NOOP;

        HOST.registerAppByFactory(invPool, configWord);

        emit Created(_msgSender(), address(invPool), _proxyType);

        return invPool;
    }

    function _deployClone()
        internal
        virtual
        returns (IInitializableInvestmentPool pool)
    {
        pool = IInitializableInvestmentPool(
            investmentPoolImplementation.clone()
        );
    }

    function _assertPoolInitArguments(
        // solhint-disable-next-line no-unused-vars
        ISuperfluid _host,
        ISuperToken _superToken,
        address _creator,
        // solhint-disable-next-line no-unused-vars
        uint96 _softCap,
        uint96 _fundraiserStartAt,
        uint96 _fundraiserEndAt,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) internal view {
        require(
            address(_superToken) != address(0),
            "[IPF]: accepted token zero address"
        );
        require(address(_creator) != address(0), "[IPF]: creator zero address");

        require(
            _fundraiserStartAt >= _getNow(),
            "[IPF]: fundraiser start at < now"
        );
        require(
            _fundraiserEndAt > _fundraiserStartAt,
            "[IPF]:fundraiser end at < start at"
        );
        require(
            _fundraiserEndAt - _fundraiserStartAt <= FUNDRAISER_MAX_DURATION,
            "[IPF]: fundraiser duration exceeds max duration"
        );

        require(
            _milestones.length > 0,
            "[IPF]: must contain at least 1 milestone"
        );
        require(
            _milestones.length <= MAX_MILESTONE_COUNT,
            "[IPF]: milestone count > max count"
        );

        // Special case for the first milestone
        require(
            _milestones[0].startDate >= _fundraiserEndAt,
            "[IPF]: milestones can't start before fundraiser ends"
        );
        require(
            _validateMilestoneInterval(_milestones[0]),
            "[IPF]: invalid milestone interval"
        );

        // Starting at index 1, since the first milestone has been checked already
        for (uint32 i = 1; i < _milestones.length; ++i) {
            require(
                (_milestones[i - 1].endDate + VOTING_PERIOD) <=
                    _milestones[i].startDate,
                "[IPF]: milestones must not overlap, including voting period"
            );
        }
    }

    function _getNow() internal view virtual returns (uint256) {
        // TODO: ISuperfluid HOST can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }

    function _validateMilestoneInterval(
        IInvestmentPool.MilestoneInterval memory milestone
    ) internal pure returns (bool) {
        return
            milestone.endDate > milestone.startDate &&
            (milestone.endDate - milestone.startDate >= MILESTONE_MIN_DURATION);
    }
}
