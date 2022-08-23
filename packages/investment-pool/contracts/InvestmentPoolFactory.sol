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

error InvestmentPoolFactory__ImplementationContractAddressIsZero();
error InvestmentPoolFactory__HostAddressIsZero();
error InvestmentPoolFactory__GelatoOpsAddressIsZero();
error InvestmentPoolFactory__AcceptedTokenAddressIsZero();
error InvestmentPoolFactory__CreatorAddressIsZero();
error InvestmentPoolFactory__SoftCapIsGreaterThanHardCap(
    uint96 softCap,
    uint96 hardCap
);
error InvestmentPoolFactory__FundraiserStartIsInPast();
error InvestmentPoolFactory__FundraiserStartTimeIsGreaterThanEndTime();
error InvestmentPoolFactory__FundraiserExceedsMaxDuration();
error InvestmentPoolFactory__FundraiserDurationIsTooShort();
error InvestmentPoolFactory__NoMilestonesAdded();
error InvestmentPoolFactory__MilestonesCountExceedsMaxCount();
error InvestmentPoolFactory__MilestoneStartsBeforeFundraiserEnds();
error InvestmentPoolFactory__InvalidMilestoneInverval();
error InvestmentPoolFactory__PercentagesAreNotAddingUp();
error InvestmentPoolFactory__MilestonesAreNotAdjacentInTime(
    uint256 oldMilestoneEnd,
    uint256 newMilestoneStart
);

contract InvestmentPoolFactory is IInvestmentPoolFactory, Context {
    // Assign all Clones library functions to addresses
    using Clones for address;

    uint48 public constant VOTING_PERIOD = 7 days;
    uint48 public constant TERMINATION_WINDOW = 12 hours;
    uint48 public constant AUTOMATED_TERMINATION_WINDOW = 1 hours;
    uint public constant MILESTONE_MIN_DURATION = 30 days;
    uint public constant MILESTONE_MAX_DURATION = 90 days;
    uint public constant FUNDRAISER_MIN_DURATION = 30 days;
    uint public constant FUNDRAISER_MAX_DURATION = 90 days;

    uint256 public constant PERCENTAGE_DIVIDER = 10**6;

    // TODO: Arbitrary choice, set this later to something that makes sense
    uint32 public constant MAX_MILESTONE_COUNT = 10;

    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    ISuperfluid public immutable HOST;
    IGelatoOps public immutable GELATO_OPS;
    address public investmentPoolImplementation;

    constructor(
        ISuperfluid _host,
        IGelatoOps _gelatoOps,
        address _implementationContract
    ) {
        if (address(_host) == address(0))
            revert InvestmentPoolFactory__HostAddressIsZero();

        if (address(_gelatoOps) == address(0))
            revert InvestmentPoolFactory__GelatoOpsAddressIsZero();

        if (_implementationContract == address(0))
            revert InvestmentPoolFactory__ImplementationContractAddressIsZero();

        HOST = _host;
        GELATO_OPS = _gelatoOps;

        // Assign Investment Pool logic contract
        investmentPoolImplementation = _implementationContract;
    }

    function createInvestmentPool(
        ISuperToken _acceptedToken,
        uint96 _softCap,
        uint96 _hardCap,
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
            _hardCap,
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
            _hardCap,
            _fundraiserStartAt,
            _fundraiserEndAt,
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
        ISuperfluid, /*_host*/
        ISuperToken _superToken,
        address _creator,
        uint96 _softCap,
        uint96 _hardCap,
        uint96 _fundraiserStartAt,
        uint96 _fundraiserEndAt,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) internal view {
        if (address(_superToken) == address(0))
            revert InvestmentPoolFactory__AcceptedTokenAddressIsZero();

        if (address(_creator) == address(0))
            revert InvestmentPoolFactory__CreatorAddressIsZero();

        if (_softCap > _hardCap)
            revert InvestmentPoolFactory__SoftCapIsGreaterThanHardCap(
                _softCap,
                _hardCap
            );

        if (_fundraiserStartAt < _getNow())
            revert InvestmentPoolFactory__FundraiserStartIsInPast();

        if (_fundraiserEndAt < _fundraiserStartAt)
            revert InvestmentPoolFactory__FundraiserStartTimeIsGreaterThanEndTime();

        if (_fundraiserEndAt - _fundraiserStartAt > FUNDRAISER_MAX_DURATION)
            revert InvestmentPoolFactory__FundraiserExceedsMaxDuration();

        if (_fundraiserEndAt - _fundraiserStartAt < FUNDRAISER_MIN_DURATION)
            revert InvestmentPoolFactory__FundraiserDurationIsTooShort();

        if (_milestones.length == 0)
            revert InvestmentPoolFactory__NoMilestonesAdded();

        if (_milestones.length > MAX_MILESTONE_COUNT)
            revert InvestmentPoolFactory__MilestonesCountExceedsMaxCount();

        // Special case for the first milestone
        if (_milestones[0].startDate < _fundraiserEndAt)
            revert InvestmentPoolFactory__MilestoneStartsBeforeFundraiserEnds();

        if (!_validateMilestoneInterval(_milestones[0]))
            revert InvestmentPoolFactory__InvalidMilestoneInverval();

        uint totalPercentage = _milestones[0].intervalSeedPortion +
            _milestones[0].intervalStreamingPortion;

        // Starting at index 1, since the first milestone has been checked already
        for (uint32 i = 1; i < _milestones.length; ++i) {
            if (_milestones[i - 1].endDate != _milestones[i].startDate)
                revert InvestmentPoolFactory__MilestonesAreNotAdjacentInTime(
                    _milestones[i - 1].endDate,
                    _milestones[i].startDate
                );

            // TODO: Percentage limit validation for milestones
            // Meaning - limit max percentage of seeding, for each milestone
            totalPercentage +=
                _milestones[i].intervalSeedPortion +
                _milestones[i].intervalStreamingPortion;
        }

        if (totalPercentage != PERCENTAGE_DIVIDER)
            revert InvestmentPoolFactory__PercentagesAreNotAddingUp();
    }

    function _getNow() internal view virtual returns (uint256) {
        // TODO: ISuperfluid HOST can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }

    function _validateMilestoneInterval(
        IInvestmentPool.MilestoneInterval memory milestone
    ) internal pure returns (bool) {
        return (milestone.endDate > milestone.startDate &&
            (milestone.endDate - milestone.startDate >=
                MILESTONE_MIN_DURATION) &&
            (milestone.endDate - milestone.startDate <=
                MILESTONE_MAX_DURATION));
    }
}
