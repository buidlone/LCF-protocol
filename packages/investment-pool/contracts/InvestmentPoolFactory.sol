// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

// Superfluid imports
import {ISuperfluid, ISuperToken, ISuperApp, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

// Openzepelin imports
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IInvestmentPool, IInitializableInvestmentPool} from "./interfaces/IInvestmentPool.sol";
import {IInvestmentPoolFactory} from "./interfaces/IInvestmentPoolFactory.sol";
import {IGelatoOps} from "./interfaces/IGelatoOps.sol";
import {IGovernancePool} from "./interfaces/IGovernancePool.sol";
import {InvestmentPool} from "./InvestmentPool.sol";

error InvestmentPoolFactory__ImplementationContractAddressIsZero();
error InvestmentPoolFactory__HostAddressIsZero();
error InvestmentPoolFactory__GelatoOpsAddressIsZero();
error InvestmentPoolFactory__AcceptedTokenAddressIsZero();
error InvestmentPoolFactory__CreatorAddressIsZero();
error InvestmentPoolFactory__SeedFundingLimitIsGreaterThanSoftCap(
    uint96 seedFundingLimit,
    uint96 softCap
);
error InvestmentPoolFactory__SoftCapIsGreaterThanHardCap(uint96 softCap, uint96 hardCap);
error InvestmentPoolFactory__FundraiserStartIsInPast();
error InvestmentPoolFactory__FundraiserStartTimeIsGreaterThanEndTime();
error InvestmentPoolFactory__FundraiserExceedsMaxDuration();
error InvestmentPoolFactory__FundraiserDurationIsTooShort();
error InvestmentPoolFactory__NoMilestonesAdded();
error InvestmentPoolFactory__MilestonesCountExceedsMaxCount();
error InvestmentPoolFactory__MilestoneStartsBeforeFundraiserEnds();
error InvestmentPoolFactory__InvalidMilestoneInverval();
error InvestmentPoolFactory__PercentagesAreNotAddingUp(
    uint256 totalPercentagesProvided,
    uint256 maxPercentages
);
error InvestmentPoolFactory__MilestonesAreNotAdjacentInTime(
    uint256 oldMilestoneEnd,
    uint256 newMilestoneStart
);
error InvestmentPoolFactory__GovernancePoolAlreadyDefined();
error InvestmentPoolFactory__GovernancePoolNotDefined();
error InvestmentPoolFactory__NotEnoughEthValue();
error InvestmentPoolFactory__FailedToSendEthToInvestmentPool();
error InvestmentPoolFactory__SeedFundsAllocationGreaterThanTotal();
error InvestmentPoolFactory__SeedFundsAllocationExceedsMax();

contract InvestmentPoolFactory is IInvestmentPoolFactory, Context, Ownable {
    // Assign all Clones library functions to addresses
    using Clones for address;

    uint32 internal constant MAX_MILESTONE_COUNT = 10;
    uint48 internal TERMINATION_WINDOW = 3 days;
    uint48 internal AUTOMATED_TERMINATION_WINDOW = 1 hours;
    uint256 internal constant PERCENTAGE_DIVIDER = 10**6;
    uint256 internal MILESTONE_MIN_DURATION = 30 days;
    uint256 internal MILESTONE_MAX_DURATION = 90 days;
    uint256 internal FUNDRAISER_MIN_DURATION = 30 days;
    uint256 internal FUNDRAISER_MAX_DURATION = 90 days;
    uint256 internal INVESTMENT_WITHDRAW_FEE = 1; // 1% out of 100%

    /// * @notice Multiplier for seed funding is 2,5; private - 1,9; public - 1.
    /// * @dev Multiplier is firstly multiplied by 10 to avoid decimal places rounding in solidity
    uint256 internal SEED_FUNDING_MULTIPLIER = 25;
    uint256 internal PRIVATE_FUNDING_MULTIPLIER = 19;
    uint256 internal PUBLIC_FUNDING_MULTIPLIER = 10;

    /**
     * @notice Amount that will be used to cover transaction fee for gelato automation
     * @dev 108,328 (gas used for calls inside gelato network)
     * @dev 353,912 (gas used for termination in investment pool)
     * @dev 108,328 + 353,912 = 462,240 (gas amount needed for gelato termination)
     * @dev If gas price is 200 Gwei, the total fee is 0,092448
     */
    uint256 internal gelatoFeeAllocationForProject = 0.1 ether;
    IGovernancePool internal governancePool;

    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    ISuperfluid internal immutable HOST;
    IGelatoOps internal immutable GELATO_OPS;
    address internal investmentPoolImplementation;

    constructor(
        ISuperfluid _host,
        IGelatoOps _gelatoOps,
        address _implementationContract
    ) {
        if (address(_host) == address(0)) revert InvestmentPoolFactory__HostAddressIsZero();

        if (address(_gelatoOps) == address(0))
            revert InvestmentPoolFactory__GelatoOpsAddressIsZero();

        if (_implementationContract == address(0))
            revert InvestmentPoolFactory__ImplementationContractAddressIsZero();

        HOST = _host;
        GELATO_OPS = _gelatoOps;

        // Assign Investment Pool logic contract
        investmentPoolImplementation = _implementationContract;
    }

    receive() external payable {}

    /** EXTERNAL FUNCTIONS */

    function createInvestmentPool(
        ISuperToken _acceptedToken,
        uint96 _seedFundingLimit,
        uint96 _softCap,
        uint96 _hardCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        ProxyType _proxyType,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) external payable returns (address) {
        if (msg.value < getGelatoFeeAllocationForProject())
            revert InvestmentPoolFactory__NotEnoughEthValue();

        IInitializableInvestmentPool invPool;

        _assertPoolInitArguments(
            HOST,
            _acceptedToken,
            _msgSender(),
            _seedFundingLimit,
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

        // Using the struct and then passing it to the initialize function because we don't want to get the error: "Stack too deep"
        IInvestmentPool.ProjectInfo memory projectDetails = IInvestmentPool.ProjectInfo(
            _acceptedToken,
            _msgSender(),
            _seedFundingLimit,
            _softCap,
            _hardCap,
            _fundraiserStartAt,
            _fundraiserEndAt,
            getTerminationWindow(),
            getAutomatedTerminationWindow()
        );

        IInvestmentPool.VotingTokensMultipliers memory multipliers = IInvestmentPool
            .VotingTokensMultipliers(
                getSeedFundingMultiplier(),
                getPrivateFundingMultiplier(),
                getPublicFundingMultiplier()
            );

        invPool.initialize{value: msg.value}(
            HOST,
            GELATO_OPS,
            projectDetails,
            multipliers,
            getInvestmentWithdrawPercentageFee(),
            _milestones,
            governancePool
        );

        // After creating investment pool, call governance pool with investment pool address
        governancePool.activateInvestmentPool(address(invPool));

        // Final level is required by the Superfluid's spec right now
        // We only really care about termination callbacks, others - noop
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL |
            SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP |
            SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP |
            SuperAppDefinitions.AFTER_AGREEMENT_CREATED_NOOP |
            SuperAppDefinitions.AFTER_AGREEMENT_UPDATED_NOOP;

        HOST.registerAppByFactory(invPool, configWord);

        emit Created(_msgSender(), address(invPool), _proxyType);

        return address(invPool);
    }

    function setGovernancePool(address _governancePool) external onlyOwner {
        if (getGovernancePool() == address(0)) {
            governancePool = IGovernancePool(_governancePool);
        } else {
            revert InvestmentPoolFactory__GovernancePoolAlreadyDefined();
        }
    }

    function setGelatoFeeAllocation(uint256 _newAmount) external onlyOwner {
        gelatoFeeAllocationForProject = _newAmount;
    }

    /** PUBLIC FUNCTIONS */

    /** GETTERS */
    function getMaxMilestoneCount() public pure returns (uint32) {
        return MAX_MILESTONE_COUNT;
    }

    function getTerminationWindow() public view returns (uint48) {
        return TERMINATION_WINDOW;
    }

    function getAutomatedTerminationWindow() public view returns (uint48) {
        return AUTOMATED_TERMINATION_WINDOW;
    }

    function getPercentageDivider() public pure returns (uint256) {
        return PERCENTAGE_DIVIDER;
    }

    function getMilestoneMinDuration() public view returns (uint256) {
        return MILESTONE_MIN_DURATION;
    }

    function getMilestoneMaxDuration() public view returns (uint256) {
        return MILESTONE_MAX_DURATION;
    }

    function getFundraiserMinDuration() public view returns (uint256) {
        return FUNDRAISER_MIN_DURATION;
    }

    function getFundraiserMaxDuration() public view returns (uint256) {
        return FUNDRAISER_MAX_DURATION;
    }

    function getInvestmentWithdrawPercentageFee() public view returns (uint256) {
        return INVESTMENT_WITHDRAW_FEE;
    }

    function getSeedFundingMultiplier() public view returns (uint256) {
        return SEED_FUNDING_MULTIPLIER;
    }

    function getPrivateFundingMultiplier() public view returns (uint256) {
        return PRIVATE_FUNDING_MULTIPLIER;
    }

    function getPublicFundingMultiplier() public view returns (uint256) {
        return PUBLIC_FUNDING_MULTIPLIER;
    }

    function getGelatoFeeAllocationForProject() public view returns (uint256) {
        return gelatoFeeAllocationForProject;
    }

    function getGovernancePool() public view returns (address) {
        return address(governancePool);
    }

    function getSuperfluidHost() public view returns (address) {
        return address(HOST);
    }

    function getGelatoOps() public view returns (address) {
        return address(GELATO_OPS);
    }

    function getInvestmentPoolImplementation() public view returns (address) {
        return investmentPoolImplementation;
    }

    /** INTERNAL FUNCITONS */

    function _deployClone() internal virtual returns (IInitializableInvestmentPool pool) {
        pool = IInitializableInvestmentPool(payable(getInvestmentPoolImplementation().clone()));
    }

    function _assertPoolInitArguments(
        // solhint-disable-next-line no-unused-vars
        ISuperfluid, /*_host*/
        ISuperToken _superToken,
        address _creator,
        uint96 _seedFundingLimit,
        uint96 _softCap,
        uint96 _hardCap,
        uint96 _fundraiserStartAt,
        uint96 _fundraiserEndAt,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) internal view {
        if (getGovernancePool() == address(0))
            revert InvestmentPoolFactory__GovernancePoolNotDefined();

        if (address(_superToken) == address(0))
            revert InvestmentPoolFactory__AcceptedTokenAddressIsZero();

        if (address(_creator) == address(0)) revert InvestmentPoolFactory__CreatorAddressIsZero();

        if (_seedFundingLimit >= _softCap)
            revert InvestmentPoolFactory__SeedFundingLimitIsGreaterThanSoftCap(
                _seedFundingLimit,
                _softCap
            );

        if (_softCap > _hardCap)
            revert InvestmentPoolFactory__SoftCapIsGreaterThanHardCap(_softCap, _hardCap);

        if (_fundraiserStartAt < _getNow())
            revert InvestmentPoolFactory__FundraiserStartIsInPast();

        if (_fundraiserEndAt < _fundraiserStartAt)
            revert InvestmentPoolFactory__FundraiserStartTimeIsGreaterThanEndTime();

        if (_fundraiserEndAt - _fundraiserStartAt > getFundraiserMaxDuration())
            revert InvestmentPoolFactory__FundraiserExceedsMaxDuration();

        if (_fundraiserEndAt - _fundraiserStartAt < getFundraiserMinDuration())
            revert InvestmentPoolFactory__FundraiserDurationIsTooShort();

        if (_milestones.length == 0) revert InvestmentPoolFactory__NoMilestonesAdded();

        if (_milestones.length > getMaxMilestoneCount())
            revert InvestmentPoolFactory__MilestonesCountExceedsMaxCount();

        // Special case for the first milestone
        if (_milestones[0].startDate < _fundraiserEndAt)
            revert InvestmentPoolFactory__MilestoneStartsBeforeFundraiserEnds();

        if (!_validateMilestoneInterval(_milestones[0]))
            revert InvestmentPoolFactory__InvalidMilestoneInverval();

        // In first milestone seed funds can be up to 50% of total milestone funds
        if (
            !_validateMilestonePercentageAllocation(
                _milestones[0],
                (50 * getPercentageDivider()) / 100
            )
        ) revert InvestmentPoolFactory__SeedFundsAllocationExceedsMax();

        uint256 totalPercentage = _milestones[0].intervalSeedPortion +
            _milestones[0].intervalStreamingPortion;

        // Starting at index 1, since the first milestone has been checked already
        for (uint32 i = 1; i < _milestones.length; ++i) {
            if (_milestones[i - 1].endDate != _milestones[i].startDate)
                revert InvestmentPoolFactory__MilestonesAreNotAdjacentInTime(
                    _milestones[i - 1].endDate,
                    _milestones[i].startDate
                );

            if (!_validateMilestoneInterval(_milestones[i]))
                revert InvestmentPoolFactory__InvalidMilestoneInverval();

            // In other milestones seed funds can be up to 10% of total milestone funds
            if (
                !_validateMilestonePercentageAllocation(
                    _milestones[0],
                    (10 * getPercentageDivider()) / 100
                )
            ) revert InvestmentPoolFactory__SeedFundsAllocationExceedsMax();

            // TODO: Percentage limit validation for milestones
            // Meaning - limit max percentage of seeding, for each milestone
            totalPercentage +=
                _milestones[i].intervalSeedPortion +
                _milestones[i].intervalStreamingPortion;
        }

        if (totalPercentage != getPercentageDivider())
            revert InvestmentPoolFactory__PercentagesAreNotAddingUp(
                totalPercentage,
                getPercentageDivider()
            );
    }

    function _getNow() internal view virtual returns (uint256) {
        // TODO: ISuperfluid HOST can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }

    function _validateMilestoneInterval(IInvestmentPool.MilestoneInterval memory milestone)
        internal
        view
        returns (bool)
    {
        return (milestone.endDate > milestone.startDate &&
            (milestone.endDate - milestone.startDate >= getMilestoneMinDuration()) &&
            (milestone.endDate - milestone.startDate <= getMilestoneMaxDuration()));
    }

    function _validateMilestonePercentageAllocation(
        IInvestmentPool.MilestoneInterval memory milestone,
        uint256 allowedSeedFundsAllocation
    ) internal pure returns (bool) {
        if (allowedSeedFundsAllocation > getPercentageDivider())
            revert InvestmentPoolFactory__SeedFundsAllocationGreaterThanTotal();
        uint milestoneMaxPercentages = milestone.intervalSeedPortion +
            milestone.intervalStreamingPortion;

        return
            (milestone.intervalSeedPortion * getPercentageDivider()) / milestoneMaxPercentages <=
            allowedSeedFundsAllocation;
    }
}
