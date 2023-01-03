// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

// Superfluid imports
import {ISuperfluid, ISuperToken, ISuperApp, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

// Openzepelin imports
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInvestmentPool, IInitializableInvestmentPool} from "./interfaces/IInvestmentPool.sol";
import {IGovernancePool, IInitializableGovernancePool} from "./interfaces/IGovernancePool.sol";
import {IDistributionPool, IInitializableDistributionPool} from "./interfaces/IDistributionPool.sol";
import {IInvestmentPoolFactory} from "./interfaces/IInvestmentPoolFactory.sol";
import {IVotingToken} from "./interfaces/IVotingToken.sol";

error InvestmentPoolFactory__ImplementationContractAddressIsZero();
error InvestmentPoolFactory__HostAddressIsZero();
error InvestmentPoolFactory__GelatoOpsAddressIsZero();
error InvestmentPoolFactory__AcceptedTokenAddressIsZero();
error InvestmentPoolFactory__CreatorAddressIsZero();
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
error InvestmentPoolFactory__NotEnoughEthValue();
error InvestmentPoolFactory__FailedToSendEthToInvestmentPool();
error InvestmentPoolFactory__SeedFundsAllocationGreaterThanTotal();
error InvestmentPoolFactory__SeedFundsAllocationExceedsMax();
error InvestmentPoolFactory__SoftCapAndHardCapDifferenceIsTooLarge();
error InvestmentPoolFactory__ThresholdPercentageIsGreaterThan100();

contract InvestmentPoolFactory is IInvestmentPoolFactory, Context, Ownable {
    // Assign all Clones library functions to addresses
    using Clones for address;

    uint32 internal constant MAX_MILESTONE_COUNT = 10;
    uint48 internal constant TERMINATION_WINDOW = 3 days;
    uint48 internal constant AUTOMATED_TERMINATION_WINDOW = 1 hours;
    uint256 internal constant PERCENTAGE_DIVIDER = 10 ** 6;
    uint256 internal constant MILESTONE_MIN_DURATION = 30 days;
    uint256 internal constant MILESTONE_MAX_DURATION = 90 days;
    uint256 internal constant FUNDRAISER_MIN_DURATION = 30 days;
    uint256 internal constant FUNDRAISER_MAX_DURATION = 90 days;
    uint256 internal constant INVESTMENT_WITHDRAW_FEE = 1; // 1% out of 100%
    uint256 internal constant VOTES_WITHDRAW_FEE = 1; // 1% out of 100%
    uint8 internal constant VOTES_PERCENTAGE_THRESHOLD = 51;

    /// @notice Multiplier for soft cap - 1,9 | hard cap - 1.
    /// @dev Multiplier is firstly multiplied by 10 to avoid decimal places rounding in solidity
    uint256 internal constant SOFT_CAP_MULTIPLIER = 19;
    uint256 internal constant HARD_CAP_MULTIPLIER = 10;
    /// @notice Max difference between soft cap and hard cap in times. Hard cap can be 10 times bigger than soft cap.
    uint256 internal constant MAX_PROPORTIONAL_DIFFERENCE = 10;

    /**
     * @notice Amount that will be used to cover transaction fee for gelato automation
     * @dev 108,328 (gas used for calls inside gelato network)
     * @dev 353,912 (gas used for termination in investment pool)
     * @dev 108,328 + 353,912 = 462,240 (gas amount needed for gelato termination)
     * @dev If gas price is 200 Gwei, the total fee is 0,092448
     */
    uint256 internal gelatoFee = 0.1 ether;

    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    ISuperfluid internal immutable HOST;
    address payable internal immutable GELATO_OPS;
    address internal investmentPoolLogic;
    address internal governancePoolLogic;
    address internal distributionPoolLogic;
    IVotingToken internal votingToken;

    constructor(
        ISuperfluid _host,
        address payable _gelatoOps,
        address _ipLogic,
        address _gpLogic,
        address _dpLogic,
        IVotingToken _votingToken
    ) {
        if (address(_host) == address(0)) revert InvestmentPoolFactory__HostAddressIsZero();
        if (_gelatoOps == address(0)) revert InvestmentPoolFactory__GelatoOpsAddressIsZero();
        if (_ipLogic == address(0) || _gpLogic == address(0) || _dpLogic == address(0))
            revert InvestmentPoolFactory__ImplementationContractAddressIsZero();

        HOST = _host;
        GELATO_OPS = _gelatoOps;

        // Assign Investment Pool, Governance Pool logic contracts
        investmentPoolLogic = _ipLogic;
        governancePoolLogic = _gpLogic;
        distributionPoolLogic = _dpLogic;
        votingToken = _votingToken;
    }

    receive() external payable {}

    /** EXTERNAL FUNCTIONS */

    function createProjectPools(
        ProjectDetails calldata _projectDetails,
        ProxyType _proxyType,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) external payable returns (address) {
        if (msg.value < getGelatoFee()) revert InvestmentPoolFactory__NotEnoughEthValue();

        IInitializableInvestmentPool invPool;
        IInitializableGovernancePool govPool;
        IInitializableDistributionPool distPool;

        _assertPoolInitArguments(
            _projectDetails.acceptedToken,
            _msgSender(),
            getVotesPercentageThreshold(),
            _projectDetails.softCap,
            _projectDetails.hardCap,
            _projectDetails.fundraiserStartAt,
            _projectDetails.fundraiserEndAt,
            _milestones
        );

        if (_proxyType == ProxyType.CLONE_PROXY) {
            invPool = _deployInvestmentPoolClone();
            govPool = _deployGovernancePoolClone();
            distPool = _deployDistributionPoolClone();
        } else {
            revert("[IPF]: only CLONE_PROXY is supported");
        }

        /// @dev Using the struct to avoid error: "Stack too deep"
        IInvestmentPool.ProjectInfo memory projectInfo = IInvestmentPool.ProjectInfo(
            _projectDetails.acceptedToken,
            _msgSender(),
            _projectDetails.softCap,
            _projectDetails.hardCap,
            _projectDetails.fundraiserStartAt,
            _projectDetails.fundraiserEndAt,
            getTerminationWindow(),
            getAutomatedTerminationWindow()
        );

        IInvestmentPool.VotingTokensMultipliers memory multipliers = IInvestmentPool
            .VotingTokensMultipliers(getSoftCapMultiplier(), getHardCapMultiplier());

        invPool.initialize{value: msg.value}(
            HOST,
            getGelatoOps(),
            projectInfo,
            multipliers,
            getInvestmentWithdrawPercentageFee(),
            _milestones,
            govPool,
            distPool
        );

        govPool.initialize(
            getVotingToken(),
            invPool,
            getVotesPercentageThreshold(),
            getVotesWithdrawPercentageFee()
        );

        distPool.initialize(invPool, _projectDetails.projectToken, _projectDetails.tokenRewards);

        // Grant newly created governance pool access to mint voting tokens
        bytes32 governancePoolRole = votingToken.GOVERNANCE_POOL_ROLE();
        votingToken.grantRole(governancePoolRole, address(govPool));

        // Final level is required by the Superfluid's spec right now
        // We only really care about termination callbacks, others - noop
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL |
            SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP |
            SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP |
            SuperAppDefinitions.AFTER_AGREEMENT_CREATED_NOOP |
            SuperAppDefinitions.AFTER_AGREEMENT_UPDATED_NOOP;

        HOST.registerAppByFactory(invPool, configWord);

        emit Created(
            _msgSender(),
            address(invPool),
            address(govPool),
            address(distPool),
            _proxyType
        );

        return address(invPool);
    }

    function setGelatoFeeAllocation(uint256 _newAmount) external onlyOwner {
        gelatoFee = _newAmount;
    }

    /** PUBLIC FUNCTIONS */

    /** GETTERS */
    function getMaxMilestoneCount() public pure returns (uint32) {
        return MAX_MILESTONE_COUNT;
    }

    function getTerminationWindow() public pure virtual returns (uint48) {
        return TERMINATION_WINDOW;
    }

    function getAutomatedTerminationWindow() public pure virtual returns (uint48) {
        return AUTOMATED_TERMINATION_WINDOW;
    }

    function getPercentageDivider() public pure returns (uint256) {
        return PERCENTAGE_DIVIDER;
    }

    function getMilestoneMinDuration() public pure virtual returns (uint256) {
        return MILESTONE_MIN_DURATION;
    }

    function getMilestoneMaxDuration() public pure virtual returns (uint256) {
        return MILESTONE_MAX_DURATION;
    }

    function getFundraiserMinDuration() public pure virtual returns (uint256) {
        return FUNDRAISER_MIN_DURATION;
    }

    function getFundraiserMaxDuration() public pure virtual returns (uint256) {
        return FUNDRAISER_MAX_DURATION;
    }

    function getInvestmentWithdrawPercentageFee() public pure returns (uint256) {
        return INVESTMENT_WITHDRAW_FEE;
    }

    function getVotesWithdrawPercentageFee() public pure returns (uint256) {
        return VOTES_WITHDRAW_FEE;
    }

    function getVotesPercentageThreshold() public pure returns (uint8) {
        return VOTES_PERCENTAGE_THRESHOLD;
    }

    function getSoftCapMultiplier() public pure returns (uint256) {
        return SOFT_CAP_MULTIPLIER;
    }

    function getHardCapMultiplier() public pure returns (uint256) {
        return HARD_CAP_MULTIPLIER;
    }

    function getMaxProportionalDifference() public pure returns (uint256) {
        return MAX_PROPORTIONAL_DIFFERENCE;
    }

    function getGelatoFee() public view returns (uint256) {
        return gelatoFee;
    }

    function getSuperfluidHost() public view returns (address) {
        return address(HOST);
    }

    function getGelatoOps() public view returns (address payable) {
        return GELATO_OPS;
    }

    function getInvestmentPoolLogic() public view returns (address) {
        return investmentPoolLogic;
    }

    function getGovernancePoolLogic() public view returns (address) {
        return governancePoolLogic;
    }

    function getDistributionPoolLogic() public view returns (address) {
        return distributionPoolLogic;
    }

    function getVotingToken() public view returns (address) {
        return address(votingToken);
    }

    /** INTERNAL FUNCITONS */

    function _deployInvestmentPoolClone()
        internal
        virtual
        returns (IInitializableInvestmentPool pool)
    {
        pool = IInitializableInvestmentPool(payable(getInvestmentPoolLogic().clone()));
    }

    function _deployGovernancePoolClone() internal returns (IInitializableGovernancePool pool) {
        pool = IInitializableGovernancePool(payable(getGovernancePoolLogic().clone()));
    }

    function _deployDistributionPoolClone()
        internal
        returns (IInitializableDistributionPool pool)
    {
        pool = IInitializableDistributionPool(payable(getDistributionPoolLogic().clone()));
    }

    function _assertPoolInitArguments(
        ISuperToken _superToken,
        address _creator,
        uint8 _threshold,
        uint96 _softCap,
        uint96 _hardCap,
        uint96 _fundraiserStartAt,
        uint96 _fundraiserEndAt,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) internal view {
        if (address(_superToken) == address(0))
            revert InvestmentPoolFactory__AcceptedTokenAddressIsZero();

        if (address(_creator) == address(0)) revert InvestmentPoolFactory__CreatorAddressIsZero();

        if (_threshold > 100) revert InvestmentPoolFactory__ThresholdPercentageIsGreaterThan100();

        if (_softCap > _hardCap)
            revert InvestmentPoolFactory__SoftCapIsGreaterThanHardCap(_softCap, _hardCap);

        if (_softCap * getMaxProportionalDifference() < _hardCap)
            revert InvestmentPoolFactory__SoftCapAndHardCapDifferenceIsTooLarge();

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

    function _validateMilestoneInterval(
        IInvestmentPool.MilestoneInterval memory milestone
    ) internal pure returns (bool) {
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
