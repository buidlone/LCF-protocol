// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

// Superfluid imports
import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";

// Openzepelin imports
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Arrays} from "./utils/Arrays.sol";
import {IInitializableInvestmentPool, IInvestmentPool} from "./interfaces/IInvestmentPool.sol";
import {AbstractInvestmentPool} from "./abstracts/AInvestmentPool.sol";

// Buidl1 imports
import {IGovernancePool} from "./interfaces/IGovernancePool.sol";
import {IDistributionPool} from "./interfaces/IDistributionPool.sol";
import "./interfaces/GelatoTypes.sol";

/// @notice Superfluid ERRORS for callbacks
/// @dev Thrown when the wrong token is streamed to the contract.
error InvestmentPool__InvalidToken();
/// @dev Thrown when the `msg.sender` of the app callbacks is not the Superfluid host.
error InvestmentPool__Unauthorized();

/// @notice InvestmentPool ERRORS
error InvestmentPool__NotCreator();
error InvestmentPool__NotGovernancePoolOrGelato();
error InvestmentPool__NotGovernancePool();
error InvestmentPool__MilestoneStillLocked();
error InvestmentPool__MilestoneStreamTerminationUnavailable();
error InvestmentPool__GelatoMilestoneStreamTerminationUnavailable();
error InvestmentPool__NoMoneyInvested();
error InvestmentPool__AlreadyStreamingForMilestone(uint256 milestone);
error InvestmentPool__AlreadyPaidForMilestone(uint256 milestone);
error InvestmentPool__CannotInvestAboveHardCap();
error InvestmentPool__ZeroAmountProvided();
error InvestmentPool__CurrentStateIsNotAllowed(uint256 currentStateByteValue);
error InvestmentPool__NoSeedAmountDedicated();
error InvestmentPool__NotInFirstMilestonePeriod();
error InvestmentPool__NoEthLeftToWithdraw();
error InvestmentPool__SuperTokenTransferFailed();
error InvestmentPool__GelatoTaskAlreadyStarted();
error InvestmentPool__EthTransferFailed();
error InvestmentPool__NotGelatoDedicatedSender();

contract InvestmentPool is AbstractInvestmentPool, SuperAppBase, Context, Initializable {
    using CFAv1Library for CFAv1Library.InitData;
    using Arrays for uint16[];

    /** STATE VARIABLES */
    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    bytes32 internal constant CFA_ID =
        keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");

    // Contains addresses of superfluid's host and ConstanFlowAgreement
    CFAv1Library.InitData public cfaV1Lib;

    // Contains the address of accepted investment token
    ISuperToken internal acceptedToken;

    address internal creator;
    IGovernancePool internal governancePool;
    IDistributionPool internal distributionPool;

    // Gelato variables
    IOps internal gelatoOps;
    address payable internal gelato;
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    bytes32 internal gelatoTask;
    bool internal gelatoTaskCreated = false;

    // TODO: validate that uint96 for soft cap is enough
    uint96 internal softCap;
    uint96 internal hardCap;
    uint48 internal fundraiserStartAt;
    uint48 internal fundraiserEndAt;
    uint48 internal totalStreamingDuration;
    uint48 internal terminationWindow;
    uint48 internal automatedTerminationWindow;
    uint48 internal emergencyTerminationTimestamp;

    /// @dev Investment data
    uint256 internal totalInvestedAmount;
    /**
     * @dev Mapping holds amoun of tokens, which was invested in the milestone only.
     * @dev It doesn't hold the total invested amount.
     * @dev Mapping from investor => milestone Id => amount invested
     */
    mapping(address => mapping(uint16 => uint256)) internal investedAmount;
    /**
     * @dev Mapping holds milestone ids, in which investor invested size increased.
     * @dev It will be used with memInvestorInvestments data to find the right nubmer
     * @dev Mapping from invstor => list of milestone ids
     */
    mapping(address => uint16[]) internal milestonesWithInvestment;
    /**
     * @dev It's a memoization mapping for milestone Investments for each investor
     * @dev n-th element describes how much money is invested into the project
     * @dev It doesn't hold real money value, but a value, which will be used in other formulas.
     * @dev Memoization will never be used on it's own, to get invested value.
     * @dev Mapping investor => milestone Id => amount
     */
    mapping(address => mapping(uint16 => uint256)) internal memInvestorInvestments;

    /// @dev Milestone data
    uint16 internal milestoneCount;
    uint16 internal currentMilestone;
    // TODO: Look into, maybe an array would be better, since we have a fixed amount?
    mapping(uint16 => Milestone) internal milestones;

    uint32 internal investmentWithdrawFee;
    uint16 internal softCapMultiplier;
    uint16 internal hardCapMultiplier;

    /**
     * @dev It's a memoization mapping for milestone Portions
     * @dev n-th element describes how much of a project is "left"
     * @dev all values are divided later by PERCENTAGE_DIVIDER
     * @dev in other words, 10% would be PERCENTAGE_DIVIDER / 10
     * @dev milestone -> portion left
     */
    mapping(uint16 => uint48) internal memMilestonePortions;
    /**
     * @dev It's a memoization mapping for milestone Investments
     * @dev n-th element describes how much money is invested into the project
     * @dev It doesn't hold real money value, but a value, which will be used in other formulas.
     * @dev Memoization will never be used on it's own, to get invested value.
     * @dev milestone -> memoized investment value
     */
    mapping(uint16 => uint256) internal memMilestoneInvestments;

    /** EVENTS */

    event Cancel();
    event Invest(address indexed caller, uint16 indexed milestoneId, uint256 amount);
    event Unpledge(address indexed caller, uint16 indexed milestoneId, uint256 amount);
    event ClaimFunds(
        uint16 indexed milestoneId,
        bool gotSeedFunds,
        bool gotStreamAmount,
        bool openedStream
    );
    event Refund(address indexed caller, uint256 amount);
    event TerminateStream(uint16 indexed milestoneId);
    event GelatoFeeTransfer(uint256 fee, address feeToken);

    /** MODIFIERS */

    /**
     * @dev Checks every callback to validate inputs. MUST be called by the host.
     * @param _token The Super Token streamed in. MUST be the in-token.
     */
    modifier validCallback(ISuperToken _token) {
        if (_token != acceptedToken) revert InvestmentPool__InvalidToken();

        /**
         * @dev Checking msg.sender here instead of _msgSender()
         * @dev because it's supposed to be called by the Superfluid host only
         */
        if (msg.sender != address(cfaV1Lib.host)) revert InvestmentPool__Unauthorized();
        _;
    }

    /// @notice Ensures that the message sender is the fundraiser creator
    modifier onlyCreator() {
        if (getCreator() != _msgSender()) revert InvestmentPool__NotCreator();
        _;
    }

    modifier onlyGovernancePool() {
        if (getGovernancePool() != _msgSender()) revert InvestmentPool__NotGovernancePool();
        _;
    }

    /// @notice Ensures that given amount is not zero
    modifier notZeroAmount(uint256 _amount) {
        if (_amount == 0) revert InvestmentPool__ZeroAmountProvided();
        _;
    }

    /// @notice Ensures that the milestone stream can be terminated
    modifier canTerminateMilestoneFinal(uint16 _index) {
        if (!canTerminateMilestoneStream(_index))
            revert InvestmentPool__MilestoneStreamTerminationUnavailable();
        _;
    }

    /// @notice Ensures that the milestone stream can be terminated by gelato
    modifier canGelatoTerminateMilestoneFinal(uint16 _index) {
        if (!canGelatoTerminateMilestoneStream(_index))
            revert InvestmentPool__GelatoMilestoneStreamTerminationUnavailable();
        _;
    }

    /// @notice Ensures that provided current project state is one of the provided. It uses bitwise operations in condition
    modifier allowedProjectStates(uint24 _states) {
        uint24 currentState = getProjectStateValue();
        if (_states & currentState == 0)
            revert InvestmentPool__CurrentStateIsNotAllowed(currentState);
        _;
    }

    /// @notice allow investment pool to receive funds from other accounts
    receive() external payable {}

    /** EXTERNAL FUNCTIONS */

    /**
     * @notice This function is like contructor. It defines all the important variables for further processes.
     * @dev This function is called by INVESTMENT POOL FACTORY on new project creation
     * @param _host superfluid contract, which is responsible for most of interactions with streams
     * @param _gelatoOps gelato ops address, which is responsible for creating automated tasks and accepting fee
     * @param _projectInfo information about the project milestones, fundraiser, termination.
     * @param _multipliers numbers, which are going to be used for calculating the voting tokens amount for minting
     * @param _investmentWithdrawFee fee, which is going to be used when unpledging investment
     * @param _milestones details about each milestone
     * @param _governancePool contract, which is used for managing voting system
     */
    function initialize(
        ISuperfluid _host,
        address payable _gelatoOps,
        IInvestmentPool.ProjectInfo calldata _projectInfo,
        IInvestmentPool.VotingTokensMultipliers calldata _multipliers,
        uint32 _investmentWithdrawFee,
        MilestoneInterval[] calldata _milestones,
        IGovernancePool _governancePool,
        IDistributionPool _distributionPool
    ) external payable initializer {
        /// @dev Parameter validation was already done for us by the Factory, so it's safe to use "as is" and save gas

        // Resolve the agreement address and initialize the lib
        cfaV1Lib = CFAv1Library.InitData(
            _host,
            IConstantFlowAgreementV1(address(_host.getAgreementClass(getCfaId())))
        );

        acceptedToken = _projectInfo.acceptedToken;
        creator = _projectInfo.creator;
        softCap = _projectInfo.softCap;
        hardCap = _projectInfo.hardCap;
        fundraiserStartAt = _projectInfo.fundraiserStartAt;
        fundraiserEndAt = _projectInfo.fundraiserEndAt;
        terminationWindow = _projectInfo.terminationWindow;
        automatedTerminationWindow = _projectInfo.automatedTerminationWindow;

        softCapMultiplier = _multipliers.softCapMultiplier;
        hardCapMultiplier = _multipliers.hardCapMultiplier;

        investmentWithdrawFee = _investmentWithdrawFee;
        milestoneCount = uint16(_milestones.length);
        currentMilestone = 0;
        governancePool = _governancePool;
        distributionPool = _distributionPool;

        gelatoOps = IOps(_gelatoOps);
        gelato = IOps(_gelatoOps).gelato();

        MilestoneInterval memory interval;
        uint48 streamDurationsTotal = 0;

        // 100% of the project is "left" at the start
        memMilestonePortions[0] = getPercentageDivider();
        for (uint16 i = 0; i < uint16(_milestones.length); ++i) {
            interval = _milestones[i];
            milestones[i] = Milestone({
                startDate: interval.startDate,
                endDate: interval.endDate,
                paid: false,
                seedAmountPaid: false,
                streamOngoing: false,
                paidAmount: 0,
                intervalSeedPortion: interval.intervalSeedPortion,
                intervalStreamingPortion: interval.intervalStreamingPortion
            });

            // This memoization array describes how much of the "project" is left at the start
            // of n-th milestone. For milestone idx: 0, the index in the array is also 0
            memMilestonePortions[i + 1] =
                memMilestonePortions[i] -
                (_milestones[i].intervalSeedPortion + _milestones[i].intervalStreamingPortion);

            streamDurationsTotal += (_milestones[i].endDate - _milestones[i].startDate);
        }

        totalStreamingDuration = streamDurationsTotal;

        // Register gelato's automation task
        startGelatoTask();
    }

    /**
     * @notice Allows to invest a specified amount of funds if fundraiser or not last milestone is active
     * @dev Prior approval from _msgSender() to this contract is required
     * @param _amount Amount of tokens to invest, must be <= approved amount
     * @param _strict true -> if too large amount should revert; false -> if smaller amount should be accepted
     */
    function invest(
        uint256 _amount,
        bool _strict
    )
        external
        notZeroAmount(_amount)
        allowedProjectStates(
            getFundraiserOngoingStateValue() | getMilestonesOngoingBeforeLastStateValue()
        )
    {
        uint256 untilHardcap = getHardCap() - getTotalInvestedAmount();
        uint256 votingTokensToMint = getVotingTokensToMint(_amount);
        uint256 investmentWeight = getInvestmentWeight(_amount);

        if (untilHardcap < _amount) {
            // Edge case, trying to invest, when hard cap is reached or almost reached
            if (_strict || untilHardcap == 0) {
                revert InvestmentPool__CannotInvestAboveHardCap();
            } else {
                // Non-strict mode, allow a smaller investment to go through
                _amount = untilHardcap;
            }
        }

        uint16 investToMilestoneId = isTimeWithinFundraiser() ? 0 : getCurrentMilestoneId() + 1;
        _investToMilestone(_msgSender(), investToMilestoneId, _amount);

        // Call governance and distribution pools
        governancePool.mintVotingTokens(investToMilestoneId, _msgSender(), votingTokensToMint);
        distributionPool.allocateTokens(
            investToMilestoneId,
            _msgSender(),
            investmentWeight,
            getMaximumWeightDivisor(),
            memMilestonePortions[investToMilestoneId]
        );

        emit Invest(_msgSender(), investToMilestoneId, _amount);
    }

    /**
     * @notice Allows investors to change their mind during the ongoing fundraiser or ongoing milestone.
     * @notice Funds are transfered back if milestone hasn't started yet. Unpledge all at once, or just a specified amount
     */
    function unpledge()
        external
        allowedProjectStates(
            getFundraiserOngoingStateValue() | getMilestonesOngoingBeforeLastStateValue()
        )
    {
        uint16 unpledgeFromMilestoneId = isTimeWithinFundraiser()
            ? 0
            : getCurrentMilestoneId() + 1;
        uint256 amount = getInvestedAmount(_msgSender(), unpledgeFromMilestoneId);

        if (amount == 0) revert InvestmentPool__NoMoneyInvested();

        _unpledgeFromMilestone(_msgSender(), unpledgeFromMilestoneId, amount);

        // Call governance and distribution pools
        governancePool.burnVotes(unpledgeFromMilestoneId, _msgSender());
        distributionPool.removeTokensAllocation(unpledgeFromMilestoneId, _msgSender());

        emit Unpledge(_msgSender(), unpledgeFromMilestoneId, amount);
    }

    /**
     * @notice Allows investors to withdraw all locked funds for a failed project
     * @notice if the soft cap has not been raised by the fundraiser end date or project was terminated.
     */
    function refund()
        external
        allowedProjectStates(
            getFailedFundraiserStateValue() |
                getTerminatedByVotingStateValue() |
                getTerminatedByGelatoStateValue()
        )
    {
        // If fundraiser failed, transfer back total amount that investor invested
        if (isFailedFundraiser()) {
            uint256 investment = getInvestedAmount(_msgSender(), 0);
            if (investment == 0) revert InvestmentPool__NoMoneyInvested();

            investedAmount[_msgSender()][0] = 0;

            bool successfulTransfer1 = acceptedToken.transfer(_msgSender(), investment);
            if (!successfulTransfer1) revert InvestmentPool__SuperTokenTransferFailed();

            emit Refund(_msgSender(), investment);
            return;
        }

        uint16 currentMilestoneId = getCurrentMilestoneId();
        uint256 tokensOwned = _totalRefundAmount(_msgSender(), currentMilestoneId);

        bool successfulTransfer2 = acceptedToken.transfer(_msgSender(), tokensOwned);
        if (!successfulTransfer2) revert InvestmentPool__SuperTokenTransferFailed();

        emit Refund(_msgSender(), tokensOwned);
    }

    /**
     * @notice Function is called only once, for the first milestone to start. Can be called only in milestone id 0
     * @notice If project is terminated so fast that even first funds stream was not opened yet,
     * @notice allow creator to get a seed funds.
     */
    function startFirstFundsStream()
        external
        onlyCreator
        allowedProjectStates(
            getAnyMilestoneOngoingStateValue() | getTerminatedByVotingStateValue()
        )
    {
        if (!isTimeWithinMilestone(0)) revert InvestmentPool__NotInFirstMilestonePeriod();

        _claim(0);
    }

    /**
     * @notice Creator can cancel the project before fundraiser start
     */
    function cancelBeforeFundraiserStart()
        external
        onlyCreator
        allowedProjectStates(getBeforeFundraiserStateValue())
    {
        emergencyTerminationTimestamp = uint48(_getNow());
        _cancelTask(getGelatoTask());
        emit Cancel();
    }

    /**
     * @notice Allows creator to terminate stream and claim next milestone's funds.
     * @notice If it is a last milestone, only terminate the stream and cancel gelato tasks.
     */
    function advanceToNextMilestone()
        external
        onlyCreator
        allowedProjectStates(getAnyMilestoneOngoingStateValue())
    {
        uint16 curMil = getCurrentMilestoneId();
        _terminateMilestoneStream(curMil);

        if (!isTimeWithinLastMilestone()) {
            currentMilestone++;
            _claim(curMil + 1);
        } else {
            _cancelTask(getGelatoTask());
        }
    }

    /**
     * @notice Creator deposits gelato fee amount on project creation (which is 0.1 ETH for now)
     * @notice If project was canceled or terminated in any way
     */
    function withdrawEther()
        external
        onlyCreator
        allowedProjectStates(
            getCanceledProjectStateValue() |
                getFailedFundraiserStateValue() |
                getTerminatedByVotingStateValue() |
                getTerminatedByGelatoStateValue() |
                getSuccessfullyEndedStateValue()
        )
    {
        if (address(this).balance == 0) revert InvestmentPool__NoEthLeftToWithdraw();

        (bool success, ) = getCreator().call{value: address(this).balance}("");
        if (!success) revert InvestmentPool__EthTransferFailed();
    }

    /**
     * @notice Cancel project during milestone periods.
     * @notice Should only be called by the governane pool or gelato
     */
    function cancelDuringMilestones()
        external
        onlyGovernancePool
        allowedProjectStates(getAnyMilestoneOngoingStateValue())
    {
        _cancelDuringMilestones();
    }

    /** PUBLIC FUNCTIONS */

    /// @notice Checks if project was canceled
    function isEmergencyTerminated() public view returns (bool) {
        return getEmergencyTerminationTimestamp() != 0;
    }

    /// @notice Checks if project was canceled before fundraiser start
    function isCanceledBeforeFundraiserStart() public view returns (bool) {
        return
            isEmergencyTerminated() &&
            getEmergencyTerminationTimestamp() < getFundraiserStartTime();
    }

    /// @notice Checks if project was canceled during milestones period
    function isCanceledDuringMilestones() public view returns (bool) {
        return
            isEmergencyTerminated() &&
            getEmergencyTerminationTimestamp() >= getMilestone(0).startDate;
    }

    /// @notice Check if the fundraiser has raised enough invested funds to reach soft cap
    function isSoftCapReached() public view returns (bool) {
        return getSoftCap() <= getTotalInvestedAmount();
    }

    /// @notice Check if the fundraiser period has ended
    function isTimeAfterFundraiser() public view returns (bool) {
        return _getNow() >= getFundraiserEndTime();
    }

    /// @notice Check if the fundraiser period has not started
    function isTimeBeforeFundraiser() public view returns (bool) {
        return _getNow() < getFundraiserStartTime();
    }

    /// @notice Check if in fundraiser period
    function isTimeWithinFundraiser() public view returns (bool) {
        return _getNow() >= getFundraiserStartTime() && _getNow() < getFundraiserEndTime();
    }

    /// @notice Check if fundraiser has ended but 0 milestone has not started yet. Gap between fundraiser and 0 milestone
    function isTimeBetweenFundraiserAndMilestones() public view returns (bool) {
        return isTimeAfterFundraiser() && _getNow() < getMilestone(0).startDate;
    }

    /// @notice Check if currently in milestone period
    /// @param _id Milestone id
    function isTimeWithinMilestone(uint16 _id) public view returns (bool) {
        Milestone memory milestone = getMilestone(_id);
        return _getNow() >= milestone.startDate && _getNow() < milestone.endDate;
    }

    /// @notice Check if any milestone is ongoing now
    /// @notice Checking if currently in defined milestone because milestone jump happens before next milestone start date
    function isTimeWithinAnyMilestone() public view returns (bool) {
        return
            _getNow() >= getMilestone(0).startDate &&
            _getNow() < getMilestone(getMilestonesCount() - 1).endDate;
    }

    /// @notice Check if last milestone is ongoing now
    function isTimeWithinLastMilestone() public view returns (bool) {
        return isTimeWithinMilestone(getMilestonesCount() - 1);
    }

    /// @notice Check if fundraiser has failed (didn't raise >= soft cap && ended)
    function isFailedFundraiser() public view returns (bool) {
        return isTimeAfterFundraiser() && !isSoftCapReached();
    }

    function isProjectCompleted() public view returns (bool) {
        return
            _getNow() > getMilestone(getMilestonesCount() - 1).endDate &&
            getCurrentMilestoneId() == getMilestonesCount() - 1;
    }

    /**
     * @notice Complete multiple checks and determine project state
     * @return stateNumber -> that is power of 2 from 2^0 to 2^7.
     * @dev It will be used in modifier to check if current state is allowed for function execution
     */
    function getProjectStateValue() public view returns (uint24 stateNumber) {
        if (isCanceledBeforeFundraiserStart()) {
            return getCanceledProjectStateValue();
        } else if (isTimeBeforeFundraiser() && !isEmergencyTerminated()) {
            return getBeforeFundraiserStateValue();
        } else if (
            (isFailedFundraiser() || !distributionPool.didCreatorLockTokens()) &&
            !isEmergencyTerminated()
        ) {
            return getFailedFundraiserStateValue();
        } else if (isTimeWithinFundraiser() && !isEmergencyTerminated()) {
            return getFundraiserOngoingStateValue();
        } else if (
            isTimeBetweenFundraiserAndMilestones() &&
            !isEmergencyTerminated() &&
            !isFailedFundraiser()
        ) {
            return getFundraiserEndedNoMilestonesOngoingStateValue();
        } else if (
            isTimeWithinAnyMilestone() &&
            !isTimeWithinLastMilestone() &&
            !isEmergencyTerminated() &&
            !isFailedFundraiser()
        ) {
            return getMilestonesOngoingBeforeLastStateValue();
        } else if (
            isTimeWithinLastMilestone() && !isEmergencyTerminated() && !isFailedFundraiser()
        ) {
            return getLastMilestoneOngoingStateValue();
        } else if (
            getGelatoTask() != bytes32("") && isCanceledDuringMilestones() && !isFailedFundraiser()
        ) {
            return getTerminatedByVotingStateValue();
        } else if (
            getGelatoTask() == bytes32("") && isCanceledDuringMilestones() && !isFailedFundraiser()
        ) {
            return getTerminatedByGelatoStateValue();
        } else if (isProjectCompleted() && !isEmergencyTerminated() && !isFailedFundraiser()) {
            return getSuccessfullyEndedStateValue();
        } else {
            return getUnknownStateValue();
        }
    }

    /// @notice Check if milestone can be terminated
    function canTerminateMilestoneStream(uint16 _milestoneId) public view returns (bool) {
        Milestone memory milestone = getMilestone(_milestoneId);
        return milestone.streamOngoing && milestone.endDate - getTerminationWindow() <= _getNow();
    }

    /// @notice Check if milestone can be terminated by Gelato automation
    function canGelatoTerminateMilestoneStream(uint16 _milestoneId) public view returns (bool) {
        Milestone memory milestone = getMilestone(_milestoneId);
        return
            milestone.streamOngoing &&
            milestone.endDate - getAutomatedTerminationWindow() <= _getNow() &&
            getGelatoTask() != bytes32("");
    }

    /// @notice get seed amount dedicated to the milestone
    function getMilestoneSeedAmount(uint16 _milestoneId) public view returns (uint256) {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];
        return
            (memInvAmount * getMilestone(_milestoneId).intervalSeedPortion) /
            getPercentageDivider();
    }

    /// @notice Calculate the real funds allocation for the milestone
    function getMilestoneTotalAllocation(uint16 _milestoneId) public view returns (uint256) {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];
        uint48 totalPercentage = getMilestone(_milestoneId).intervalSeedPortion +
            getMilestone(_milestoneId).intervalStreamingPortion;
        uint256 subt = memInvAmount * totalPercentage;
        return subt / getPercentageDivider();
    }

    /**
     * @notice Function calculates the amount that is used by the creator
     */
    function getFundsUsed() public view returns (uint256) {
        uint16 milestoneId = getCurrentMilestoneId();
        uint24 currentState = getProjectStateValue();

        if (
            currentState == getCanceledProjectStateValue() ||
            currentState == getBeforeFundraiserStateValue() ||
            currentState == getFundraiserOngoingStateValue() ||
            currentState == getFailedFundraiserStateValue() ||
            currentState == getFundraiserEndedNoMilestonesOngoingStateValue()
        ) {
            return 0;
        } else if (
            isStateAnyMilestoneOngoing() ||
            currentState == getTerminatedByVotingStateValue() ||
            currentState == getTerminatedByGelatoStateValue()
        ) {
            uint256 creatorFunds = 0;
            for (uint16 i = 0; i <= milestoneId; i++) {
                creatorFunds += getMilestone(i).paidAmount;
            }
            return creatorFunds;
        } else if (currentState == getSuccessfullyEndedStateValue()) {
            return getTotalInvestedAmount();
        } else {
            return 0;
        }
    }

    function getMilestoneDuration(uint16 _milestoneId) public view returns (uint256) {
        Milestone memory milestone = getMilestone(_milestoneId);
        return milestone.endDate - milestone.startDate;
    }

    function getMilestonesWithInvestment(address _investor) public view returns (uint16[] memory) {
        return milestonesWithInvestment[_investor];
    }

    function getInvestorTokensAllocation(
        address _investor,
        uint16 _milestoneId
    ) public view returns (uint256) {
        return
            (_getMemoizedInvestorInvestment(_investor, _milestoneId) *
                (getMilestone(_milestoneId).intervalSeedPortion +
                    getMilestone(_milestoneId).intervalStreamingPortion)) / getPercentageDivider();
    }

    /**
     * @dev Function returns the amount of funds that were already streamed and the flow rate of current milestoness
     * @dev Will be used by frontend
     */
    function getUsedInvestmentsData(
        address _investor
    ) public view returns (uint256 alreadyAllocated, uint256 allocationFlowRate) {
        uint16 milestoneId = getCurrentMilestoneId();
        uint24 currentState = getProjectStateValue();

        // If no milestone is ongoing, always return 0
        if (
            currentState == getCanceledProjectStateValue() ||
            currentState == getBeforeFundraiserStateValue() ||
            currentState == getFundraiserOngoingStateValue() ||
            currentState == getFailedFundraiserStateValue() ||
            currentState == getFundraiserEndedNoMilestonesOngoingStateValue()
        ) {
            // Milestones haven't started, so return 0;
            return (0, 0);
        } else if (isStateAnyMilestoneOngoing()) {
            uint256 previousMilestonesAllocation = 0;
            for (uint16 i = 0; i < milestoneId; i++) {
                previousMilestonesAllocation += getInvestorTokensAllocation(_investor, i);
            }

            uint256 allocationPerSecond = getInvestorTokensAllocation(_investor, milestoneId) /
                getMilestoneDuration(milestoneId);

            return (previousMilestonesAllocation, allocationPerSecond);
        } else if (
            currentState == getTerminatedByVotingStateValue() ||
            currentState == getTerminatedByGelatoStateValue()
        ) {
            uint48 milestoneStartDate = getMilestone(milestoneId).startDate;
            uint256 previousMilestonesAllocation = 0;
            for (uint16 i = 0; i < milestoneId; i++) {
                previousMilestonesAllocation += getInvestorTokensAllocation(_investor, i);
            }

            // There is and edge case, where project is terminated during the previous milestone period.
            // Thats why we check if milestone started before emergency termination.
            if (getEmergencyTerminationTimestamp() > milestoneStartDate) {
                uint48 timePassed = getEmergencyTerminationTimestamp() - milestoneStartDate;
                uint256 allocationPerSecond = getInvestorTokensAllocation(_investor, milestoneId) /
                    getMilestoneDuration(milestoneId);
                previousMilestonesAllocation += uint256(timePassed) * allocationPerSecond;
            }

            return (previousMilestonesAllocation, 0);
        } else if (currentState == getSuccessfullyEndedStateValue()) {
            // Return all investment
            uint16[] memory milestonesIds = getMilestonesWithInvestment(_investor);
            uint256 totalInvestment = 0;
            for (uint16 i = 0; i < milestonesIds.length; i++) {
                uint16 milestone = milestonesIds[i];
                totalInvestment += getInvestedAmount(_investor, milestone);
            }
            return (totalInvestment, 0);
        } else {
            return (0, 0);
        }
    }

    function isStateAnyMilestoneOngoing() public view returns (bool) {
        return getProjectStateValue() & getAnyMilestoneOngoingStateValue() != 0;
    }

    function getCurrentMilestoneId() public view virtual returns (uint16) {
        return currentMilestone;
    }

    function getCfaId() public pure returns (bytes32) {
        return CFA_ID;
    }

    function getEthAddress() public pure returns (address) {
        return ETH;
    }

    function getAcceptedToken() public view returns (address) {
        return address(acceptedToken);
    }

    function getCreator() public view returns (address) {
        return creator;
    }

    function getGelatoTaskCreated() public view returns (bool) {
        return gelatoTaskCreated;
    }

    function getGelatoOps() public view returns (address) {
        return address(gelatoOps);
    }

    function getGelato() public view returns (address payable) {
        return gelato;
    }

    function getGelatoTask() public view returns (bytes32) {
        return gelatoTask;
    }

    function getGovernancePool() public view returns (address) {
        return address(governancePool);
    }

    function getDistributionPool() public view returns (address) {
        return address(distributionPool);
    }

    function getSoftCap() public view returns (uint96) {
        return softCap;
    }

    function getHardCap() public view returns (uint96) {
        return hardCap;
    }

    function getFundraiserStartTime() public view returns (uint48) {
        return fundraiserStartAt;
    }

    function getFundraiserEndTime() public view returns (uint48) {
        return fundraiserEndAt;
    }

    function getTotalStreamingDuration() public view returns (uint48) {
        return totalStreamingDuration;
    }

    function getTerminationWindow() public view returns (uint48) {
        return terminationWindow;
    }

    function getAutomatedTerminationWindow() public view returns (uint48) {
        return automatedTerminationWindow;
    }

    function getEmergencyTerminationTimestamp() public view returns (uint48) {
        return emergencyTerminationTimestamp;
    }

    function getTotalInvestedAmount() public view returns (uint256) {
        return totalInvestedAmount;
    }

    function getInvestedAmount(
        address _investor,
        uint16 _milestoneId
    ) public view returns (uint256) {
        return investedAmount[_investor][_milestoneId];
    }

    function getMilestonesCount() public view returns (uint16) {
        return milestoneCount;
    }

    function getMilestone(uint16 _milestoneId) public view returns (Milestone memory) {
        return milestones[_milestoneId];
    }

    function getInvestmentWithdrawPercentageFee() public view returns (uint32) {
        return investmentWithdrawFee;
    }

    function getSoftCapMultiplier() public view returns (uint16) {
        return softCapMultiplier;
    }

    function getHardCapMultiplier() public view returns (uint16) {
        return hardCapMultiplier;
    }

    function getVotingTokensSupplyCap() public view returns (uint256) {
        return getMaximumWeightDivisor();
    }

    function getMilestonesPortionLeft(uint16 _milestoneId) public view returns (uint48) {
        return memMilestonePortions[_milestoneId];
    }

    /**
     * @notice Calculates the theoretical maximum weight, which is reached if investors invest enough money to reach hardcap.
     */
    function getMaximumWeightDivisor() public view returns (uint256) {
        uint256 onlyHardCapAmount = uint256(getHardCap()) - uint256(getSoftCap());
        uint256 softCapMaxWeight = uint256(getSoftCap()) * getSoftCapMultiplier();
        uint256 hardCapMaxWeight = onlyHardCapAmount * getHardCapMultiplier();
        uint256 maxWeight = softCapMaxWeight + hardCapMaxWeight;
        return maxWeight;
    }

    /**
     * @notice This function returns values that shouldn't be used on its own.
     * @notice The amount should be multiplied with the corresponding milestone's allocation percentage
     * @notice If list item is zero, percentage should be multiplied by the nearest value on the left that is not zero
     * @dev Used only by the frontend
     */
    function getMemoizedInvestmentsList() public view returns (uint256[] memory) {
        uint16 listValuesCount = getMilestonesCount();
        uint256[] memory investmentsList = new uint256[](listValuesCount);

        for (uint16 i = 0; i < listValuesCount; i++) {
            investmentsList[i] = memMilestoneInvestments[i];
        }
        return investmentsList;
    }

    function getVotingTokensToMint(uint256 _amount) public view returns (uint256) {
        return getInvestmentWeight(_amount);
    }

    function getInvestmentWeight(uint256 _amount) public view returns (uint256) {
        if (getTotalInvestedAmount() <= getSoftCap()) {
            // Private funding
            if (getTotalInvestedAmount() + _amount <= getSoftCap()) {
                // Multiplier will be the same for all voting tokens
                return _amount * getSoftCapMultiplier();
            } else if (getTotalInvestedAmount() + _amount <= getHardCap()) {
                // Multiplier is going to be different. That's why we need to calculate
                // the amount which is going to be invested in private funding and which in public funding.
                // Investor invested while in private funding. Remaining funds went to public funding.
                uint256 amountInSoftCap = getSoftCap() - getTotalInvestedAmount();
                uint256 maxWeightForSoftCap = amountInSoftCap * getSoftCapMultiplier();
                uint256 amountInHardCap = _amount - amountInSoftCap;
                uint256 maxWeightForHardCap = amountInHardCap * getHardCapMultiplier();

                return maxWeightForSoftCap + maxWeightForHardCap;
            }
        } else if (
            getTotalInvestedAmount() > getSoftCap() && getTotalInvestedAmount() <= getHardCap()
        ) {
            // Public limited funding
            if (getTotalInvestedAmount() + _amount <= getHardCap()) {
                // Multiplier will be the same for all voting tokens
                return _amount * getHardCapMultiplier();
            }
        }

        // For unexpected cases
        return 0;
    }

    /** INTERNAL FUNCTIONS */

    function _getMemoizedInvestorInvestment(
        address _investor,
        uint16 _milestoneId
    ) public view returns (uint256) {
        uint16[] memory milestonesIds = getMilestonesWithInvestment(_investor);

        // Calculate the real balance
        if (milestonesIds.length == 0) {
            // If milestonesIds array is empty that means that no investments were made.
            // Return zero.
            return 0;
        } else if (_milestoneId == 0 || memInvestorInvestments[_investor][_milestoneId] != 0) {
            // Return the value that mapping holds.
            // If milestone is zero, no matter the tokens amount (it can be 0 or more),
            // it is the correct one, as no investments were made before it.
            // If tokens amount is not zero, that means investor invested in that milestone,
            // that is why we can get the value immediately, without any additional step.
            return memInvestorInvestments[_investor][_milestoneId];
        } else if (memInvestorInvestments[_investor][_milestoneId] == 0) {
            // If tokens amount is zero, that means investment was MADE before it,
            // or was NOT MADE at all. It also means that investment definitely was not made in the current milestone.
            // Because those cases are already handled.

            // array.findUpperBound(element) searches a sorted array and returns the first index that contains a value greater or equal to element.
            // If no such index exists (i.e. all values in the array are strictly less than element), the array length is returned.
            // Because in previous condition we checked if investments were made to the milestone id,
            // we can be sure that findUpperBound function will return the value greater than element of length of the array,
            /// @dev not using milestonesIds variable because findUpperBound works only with storage variables.
            uint16 largerMilestoneIndex = milestonesIds.findUpperBound(_milestoneId);

            if (largerMilestoneIndex == milestonesIds.length) {
                // If length of an array was returned, it means
                // no milestone id in the array is greater than the current one.
                // Get the last value on milestonesIds array, because all the milestones after it
                // have the same tokens amount.
                uint16 lastMilestone = milestonesIds[milestonesIds.length - 1];
                return memInvestorInvestments[_investor][lastMilestone];
            } else if (
                largerMilestoneIndex == 0 && _milestoneId < milestonesIds[largerMilestoneIndex]
            ) {
                // If the index of milestone that was found is zero AND
                // current milestone is LESS than milestone retrieved from milestonesIds
                // it means no investments were made before the current milestone.
                // Thus, no voting tokens were minted at all.
                // This condition can be met when looking for tokens amount in past milestones
                return 0;
            } else if (milestonesIds.length > 1 && largerMilestoneIndex > 0) {
                // If more than 1 investment was made, nearestMilestoneIdFromTop will return
                // the index that is higher by 1 array element. That is we need to subtract 1, to get the right index
                // When we have the right index, we can return the tokens amount
                // This condition can be met when looking for tokens amount in past milestones
                uint16 milestoneIdWithInvestment = milestonesIds[largerMilestoneIndex - 1];
                return memInvestorInvestments[_investor][milestoneIdWithInvestment];
            }
        }

        // At this point all of the cases should be handled and value should already be returns
        // This part of code should never be reached, but for unknown cases we will return zero.
        return 0;
    }

    /// @notice Update value memMilestoneInvestments value, to make sure it doesn't return zero by mistake
    function _updateMemInvestment(uint16 _milestoneId) internal {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];
        if (memInvAmount == 0 && _milestoneId > 0) {
            memMilestoneInvestments[_milestoneId] = memMilestoneInvestments[_milestoneId - 1];
        }
    }

    /**
     * @notice Allows the pool creator to start streaming/receive funds for a certain milestone
     * @param _milestoneId Milestone index to claim funds for
     */
    function _claim(
        uint16 _milestoneId
    )
        internal
        onlyCreator
        allowedProjectStates(
            getAnyMilestoneOngoingStateValue() | getTerminatedByVotingStateValue()
        )
    {
        // Using variable as functions cannot return storage variables
        Milestone storage milestone = milestones[_milestoneId];

        if (_milestoneId > getCurrentMilestoneId()) revert InvestmentPool__MilestoneStillLocked();
        if (milestone.streamOngoing)
            revert InvestmentPool__AlreadyStreamingForMilestone(_milestoneId);
        if (milestone.paid) revert InvestmentPool__AlreadyPaidForMilestone(_milestoneId);

        _updateMemInvestment(_milestoneId);

        // Allow creator to claim only milestone seed funds if milestone was terminated by voting
        if (isCanceledDuringMilestones()) {
            if (
                !milestone.seedAmountPaid &&
                getEmergencyTerminationTimestamp() >= milestone.startDate &&
                getEmergencyTerminationTimestamp() < milestone.endDate
            ) {
                uint256 seedAmount = getMilestoneSeedAmount(_milestoneId);
                milestone.seedAmountPaid = true;
                milestone.paidAmount = seedAmount;

                bool successfulTransfer = acceptedToken.transfer(getCreator(), seedAmount);
                if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

                emit ClaimFunds(_milestoneId, true, false, false);
                return;
            } else {
                revert InvestmentPool__NoSeedAmountDedicated();
            }
        }

        // Seed amount was not paid yet, send seed funds instantly to the creator
        if (!milestone.seedAmountPaid) {
            uint256 amount = getMilestoneSeedAmount(_milestoneId);
            milestone.seedAmountPaid = true;
            milestone.paidAmount = amount;

            bool successfulTransfer = acceptedToken.transfer(getCreator(), amount);
            if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

            emit ClaimFunds(_milestoneId, true, false, false);
        }

        uint256 tokenPortion = getMilestoneTotalAllocation(_milestoneId);
        uint256 owedAmount = tokenPortion - milestone.paidAmount;

        // NOTE: we'll need to account for termination window here
        // in order to not create very high rate and short lived streams
        // that are difficult to terminate in time
        if (milestone.endDate - getTerminationWindow() <= _getNow()) {
            // Milestone has passed, we should pay immediately
            milestone.paid = true;
            milestone.paidAmount = tokenPortion;

            bool successfulTransfer = acceptedToken.transfer(getCreator(), owedAmount);
            if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

            emit ClaimFunds(_milestoneId, false, true, false);
        } else {
            milestone.streamOngoing = true;

            // TODO: Calculate the limits here, make sure there is no possibility of overflow

            // NOTE: we are not checking for existing flow here, because such existance would violate our contract rules
            // At this point, there should be no active stream to the creator's account so it's safe to open a new one
            uint256 leftStreamDuration = uint256(milestone.endDate) - _getNow();
            int96 flowRate = int96(int256(owedAmount / leftStreamDuration));

            cfaV1Lib.createFlow(getCreator(), acceptedToken, flowRate);
            emit ClaimFunds(_milestoneId, false, false, true);
        }
    }

    /** @notice Terminates the stream of funds from contract to creator.
        @dev Can only be called during the termination window for a particular milestone.
        @param _milestoneId Milestone index to terminate the stream for
     */
    function _terminateMilestoneStream(
        uint16 _milestoneId
    ) internal canTerminateMilestoneFinal(_milestoneId) {
        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlow(
            acceptedToken,
            address(this),
            getCreator()
        );

        if (timestamp != 0) {
            uint256 streamedAmount = (_getNow() - timestamp) * uint256(int256(flowRate));
            cfaV1Lib.deleteFlow(address(this), getCreator(), acceptedToken);

            // Perform final termination. Rest of the token buffer gets instantly sent
            _afterStreamTermination(_milestoneId, streamedAmount, true);
        }
    }

    /// @notice After stream was terminated, transfer left funds to the creator or only update paid amount value.
    function _afterStreamTermination(
        uint16 _milestoneId,
        uint256 streamedAmount,
        bool _finalTermination
    ) internal {
        // Using storage variable and not getter function as functions cannot return storage variables
        Milestone storage milestone = milestones[_milestoneId];
        // TODO: Handle overstream situations here, if it wasn't closed in time
        // TODO: Should probably transfer tokens using try/catch pattern with gas ensurance.
        // Even though the gas limit for a callback is large, something can still hapen in internal call to transfer
        // Consult with the 1 rule of App jailing
        // https://docs.superfluid.finance/superfluid/developers/developer-guides/super-apps/super-app#super-app-rules-jail-system
        milestone.streamOngoing = false;

        // If final, send all the left funds straight to the creator
        if (_finalTermination) {
            uint256 tokenPortion = getMilestoneTotalAllocation(_milestoneId);
            uint256 owedAmount = tokenPortion - milestone.paidAmount - streamedAmount;

            milestone.paidAmount = tokenPortion;
            milestone.paid = true;
            if (owedAmount > 0) {
                bool successfulTransfer = acceptedToken.transfer(getCreator(), owedAmount);
                if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();
            }
        } else {
            milestone.paidAmount += streamedAmount;
        }

        emit TerminateStream(_milestoneId);
    }

    /**
     * @notice Milestone id here is the milestone you are investing "FOR".
     * @notice Meaning, for initial fundraiser with the goal to achieve soft cap
     * @notice the index would be 0 and returned coefficient shall be 100% (PERCENTAGE_DIVIDER)
     */
    function _investToMilestone(address _investor, uint16 _milestoneId, uint256 _amount) internal {
        // Update memMilestoneInvestments mapping if investor invests before the stream is opened
        // All cases (except milestone 0) are handled in _claim() function because milestone 0
        // is the only milestone where investments can be made before stream is opened
        // Fundraiser doesn't count as stream is not opened there
        _updateMemInvestment(_milestoneId);

        uint48 investmentCoefficient = memMilestonePortions[_milestoneId];
        uint256 scaledInvestment = (_amount * getPercentageDivider()) / investmentCoefficient;

        memMilestoneInvestments[_milestoneId] += scaledInvestment;
        investedAmount[_investor][_milestoneId] += _amount;
        totalInvestedAmount += _amount;

        // This allows us to know the memoized amount of tokens that investor started owning from the provided milestone start.
        if (memInvestorInvestments[_investor][_milestoneId] == 0) {
            // If it's first investment for this milestone, add milestone id to the array.
            milestonesWithInvestment[_investor].push(_milestoneId);
        }

        // Add the the current scaled allocation to the previous allocation.
        memInvestorInvestments[_investor][_milestoneId] =
            _getMemoizedInvestorInvestment(_investor, _milestoneId) +
            scaledInvestment;

        bool successfulTransfer = acceptedToken.transferFrom(_investor, address(this), _amount);
        if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();
    }

    function _unpledgeFromMilestone(
        address _investor,
        uint16 _milestoneId,
        uint256 _amount
    ) internal {
        uint48 investmentCoefficient = memMilestonePortions[_milestoneId];

        // Update storage variables
        memMilestoneInvestments[_milestoneId] -=
            (_amount * getPercentageDivider()) /
            investmentCoefficient;
        investedAmount[_investor][_milestoneId] = 0;
        totalInvestedAmount -= _amount;

        milestonesWithInvestment[_investor].pop();
        memInvestorInvestments[_investor][_milestoneId] = 0;

        // Apply fee for withdrawal during the same period as invested (milestone or fundraiser)
        uint256 amountToTransfer = (_amount * (100 - getInvestmentWithdrawPercentageFee())) / 100;

        bool successfulTransfer = acceptedToken.transfer(_investor, amountToTransfer);
        if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();
    }

    function _totalRefundAmount(
        address _investor,
        uint16 _terminationMilestoneId
    ) internal returns (uint256) {
        uint256 tokensOwned;
        uint16[] memory milestonesIds = getMilestonesWithInvestment(_investor);
        // Total project portion that is left (Not amount for creator)
        uint48 actualProjectLeft = _getEarlyTerminationProjectLeftPortion(_terminationMilestoneId);

        for (uint16 i = 0; i < milestonesIds.length; i++) {
            uint16 milestoneId = milestonesIds[i];

            uint256 investment = getInvestedAmount(_investor, milestoneId);
            investedAmount[_investor][milestoneId] = 0;

            if (milestoneId > _terminationMilestoneId) {
                tokensOwned += investment;
            } else {
                // It means milestoneId <= currentMilestoneId
                // After project stop milestones don't change.
                uint48 investmentCoef = memMilestonePortions[milestoneId];

                uint256 investmentLeft = _getUnburnedAmountForInvestment(
                    investment,
                    actualProjectLeft,
                    investmentCoef
                );

                tokensOwned += investmentLeft;
            }
        }

        if (tokensOwned == 0) revert InvestmentPool__NoMoneyInvested();

        return tokensOwned;
    }

    /**
     * @notice Get the amount of voting tokens to mint. It is determined by the period (until soft cap or hard cap)
     */

    /// @notice Get the total project PORTION percentage. It shouldn't be confused with total investment percentage that is left.
    function _getEarlyTerminationProjectLeftPortion(
        uint16 _terminationMilestoneId
    ) internal view returns (uint48) {
        /**
         * @dev Creator always has rights to get the seed amount for the termination milestone,
         * @dev even after termination this is to prevent project kills by whale investors.
         * @dev This way - investor will still be at loss for seed amount for next milestone
         */

        Milestone memory terminationMilestone = getMilestone(_terminationMilestoneId);
        uint48 milestonePortion = memMilestonePortions[_terminationMilestoneId];
        uint256 tokensReserved;

        if (terminationMilestone.paidAmount > 0) {
            tokensReserved = terminationMilestone.paidAmount;
        } else {
            tokensReserved = getMilestoneSeedAmount(_terminationMilestoneId);
        }

        uint16 totalMilestones = getMilestonesCount();
        uint256 leftAllocation;
        for (uint16 i = _terminationMilestoneId; i < totalMilestones; i++) {
            leftAllocation += getMilestoneTotalAllocation(i);
        }

        /// @dev Example: 25% - (60$ * 25% / 300$) = 20%
        return milestonePortion - uint48((tokensReserved * milestonePortion) / leftAllocation);
    }

    function _getNow() internal view virtual returns (uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }

    /// @notice Get amount that belongs to the investor
    function _getUnburnedAmountForInvestment(
        uint256 _investmentAmount,
        uint48 _actualProjectLeft,
        uint48 _investmentCoef
    ) internal pure returns (uint256) {
        return (_investmentAmount * _actualProjectLeft) / _investmentCoef;
    }

    // @notice Terminate the project while the milestones are ongoing
    function _cancelDuringMilestones()
        internal
        allowedProjectStates(getAnyMilestoneOngoingStateValue())
    {
        emergencyTerminationTimestamp = uint48(_getNow());

        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlow(
            acceptedToken,
            address(this),
            getCreator()
        );

        // Flow exists, do bookkeeping
        if (timestamp != 0) {
            uint256 streamedAmount = (_getNow() - timestamp) * uint256(int256(flowRate));

            cfaV1Lib.deleteFlow(address(this), getCreator(), acceptedToken);

            // Update the milestone paid amount, don't transfer rest of the funds
            _afterStreamTermination(getCurrentMilestoneId(), streamedAmount, false);
        }

        _cancelTask(getGelatoTask());
        emit Cancel();
    }

    // //////////////////////////////////////////////////////////////
    // SUPER APP CALLBACKS
    // //////////////////////////////////////////////////////////////

    /// @dev Callback executed BEFORE a stream is TERMINATED.
    /// @dev Not called from our smart contract
    /// @param token Super Token being streamed in
    /// @param agreementId Unique stream ID for fetching the flowRate and timestamp.
    function beforeAgreementTerminated(
        ISuperToken token,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata,
        bytes calldata
    ) external view override(ISuperApp, SuperAppBase) returns (bytes memory) {
        if (agreementClass != address(cfaV1Lib.cfa)) return new bytes(0);

        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlowByID(token, agreementId);

        return abi.encode(timestamp, flowRate);
    }

    /// @dev Callback executed AFTER a stream is TERMINATED. This MUST NOT revert.
    /// @dev Not called from our smart contract
    /// @param token Super Token no longer being streamed in.
    /// @param agreementClass Agreement contract address.
    /// @param ctx Callback context.
    function afterAgreementTerminated(
        ISuperToken token,
        address agreementClass,
        bytes32,
        bytes calldata agreementData,
        bytes calldata cbdata,
        bytes calldata ctx
    ) external override(ISuperApp, SuperAppBase) validCallback(token) returns (bytes memory) {
        // MUST NOT revert. If agreement is not explicitly CFA, return context, DO NOT update state.
        // If this reverts, then no user can approve subscriptions.
        if (agreementClass != address(cfaV1Lib.cfa)) return ctx;

        (address sender, address receiver) = abi.decode(agreementData, (address, address));

        if (sender != address(this) || receiver != getCreator()) return ctx;

        // TODO: Rest of the callback goes here
        // at this point, money strem was terminated
        // ether by the CREATOR or Superfluid's 3P system
        // 3P system is special, it means that the APP became unsolvent
        // at this point - it's game over, not much we can do
        // We provide incentives for the CREATOR to terminate the stream early, even between milestones
        // termination window serves as such incentive, alowing to get a certain buffer of funds transferred faster
        // without waiting for the CFA streaming

        // during milestones in-between, INVESTORS have a financial incentive to terminate the stream early
        // to ensure that the CREATOR wouldn't get too much money

        (uint256 timestamp, int96 flowRate) = abi.decode(cbdata, (uint256, int96));
        uint16 currentMilestoneIndex = getCurrentMilestoneId();
        bool finalTermination = canTerminateMilestoneStream(currentMilestoneIndex);

        // TODO: handle overstream case in-between milestones
        // (if stream was not terminated in time)
        uint256 streamedAmount = (_getNow() - timestamp) * uint256(int256(flowRate));

        // At this point the stream itself was already terminated, just do some bookkeeping
        // NOTE: think about termination window edge cases here
        _afterStreamTermination(currentMilestoneIndex, streamedAmount, finalTermination);

        // By the Superfluid's rules, must return valid context, otherwise - app is jailed.
        return ctx;
    }

    // //////////////////////////////////////////////////////////////
    // GELATO AUTOMATED TERMINATION
    // //////////////////////////////////////////////////////////////

    /// @dev This function is called by Gelato network to check if automated termination is needed.
    /// @return canExec : whether Gelato should execute the task.
    /// @return execPayload :  data that executors should use for the execution.
    function gelatoChecker() public view returns (bool canExec, bytes memory execPayload) {
        uint16 milestoneId = getCurrentMilestoneId();
        canExec = canGelatoTerminateMilestoneStream(milestoneId);
        execPayload = abi.encodeCall(this.gelatoTerminateMilestoneStream, (milestoneId));
    }

    /// @notice Register gelato task, to make termination automated
    function startGelatoTask() public payable {
        if (getGelatoTaskCreated() == true) revert InvestmentPool__GelatoTaskAlreadyStarted();
        if (getGelatoTask() != bytes32("")) revert InvestmentPool__GelatoTaskAlreadyStarted();

        // Crafting ModuleData to create a task which utilise RESOLVER Module
        ModuleData memory moduleData = ModuleData({
            modules: new Module[](1),
            args: new bytes[](1)
        });
        moduleData.modules[0] = Module.RESOLVER;
        moduleData.args[0] = _resolverModuleArg(
            address(this),
            abi.encodeCall(this.gelatoChecker, ())
        );

        bytes32 id = gelatoOps.createTask(
            address(this),
            abi.encode(this.gelatoTerminateMilestoneStream.selector),
            moduleData,
            ETH
        );

        gelatoTask = id;
        gelatoTaskCreated = true;
    }

    /// @notice Function is called by gelato automation, when conditions are met
    /// @notice Function is not restricted to gelato ops sender, because it checks if conditions are met
    function gelatoTerminateMilestoneStream(
        uint16 _milestoneId
    ) public canGelatoTerminateMilestoneFinal(_milestoneId) {
        _cancelDuringMilestones();
        gelatoTask = bytes32("");

        // Pay for gelato automation service
        (uint256 fee, address feeToken) = _getGelatoFeeDetails();
        _gelatoTransfer(fee, feeToken);

        emit GelatoFeeTransfer(fee, feeToken);
    }

    function _cancelTask(bytes32 _taskId) internal {
        gelatoOps.cancelTask(_taskId);
    }

    function _gelatoTransfer(uint256 _fee, address _feeToken) internal {
        if (_feeToken == ETH) {
            (bool success, ) = gelato.call{value: _fee}("");
            if (!success) revert InvestmentPool__EthTransferFailed();
        } else {
            revert InvestmentPool__EthTransferFailed();
        }
    }

    function _getGelatoFeeDetails() internal view returns (uint256 fee, address feeToken) {
        (fee, feeToken) = gelatoOps.getFeeDetails();
    }

    function _resolverModuleArg(
        address _resolverAddress,
        bytes memory _resolverData
    ) internal pure returns (bytes memory) {
        return abi.encode(_resolverAddress, _resolverData);
    }
}
