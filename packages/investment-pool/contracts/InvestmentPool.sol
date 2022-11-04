// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

// Superfluid imports
import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";

// Openzepelin imports
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IInitializableInvestmentPool} from "./interfaces/IInvestmentPool.sol";
import {IGovernancePool} from "./interfaces/IGovernancePool.sol";
import {IGelatoOps} from "./interfaces/IGelatoOps.sol";

import "hardhat/console.sol";

/// @notice Superfluid ERRORS for callbacks
/// @dev Thrown when the wrong token is streamed to the contract.
error InvestmentPool__InvalidToken();
/// @dev Thrown when the `msg.sender` of the app callbacks is not the Superfluid host.
error InvestmentPool__Unauthorized();

/// @notice InvestmentPool ERRORS
error InvestmentPool__NotCreator();
error InvestmentPool__NotGelatoOps();
error InvestmentPool__NotGovernancePoolOrGelato();
error InvestmentPool__MilestoneStillLocked();
error InvestmentPool__MilestoneStreamTerminationUnavailable();
error InvestmentPool__GelatoMilestoneStreamTerminationUnavailable();
error InvestmentPool__NoMoneyInvested();
error InvestmentPool__AlreadyStreamingForMilestone(uint256 milestone);
error InvestmentPool__AlreadyPaidForMilestone(uint256 milestone);
error InvestmentPool__GelatoEthTransferFailed();
error InvestmentPool__CannotInvestAboveHardCap();
error InvestmentPool__ZeroAmountProvided();
error InvestmentPool__AmountIsGreaterThanInvested(uint256 givenAmount, uint256 investedAmount);
error InvestmentPool__CurrentStateIsNotAllowed(uint256 currentStateByteValue);
error InvestmentPool__NoSeedAmountDedicated();
error InvestmentPool__NotInFirstMilestonePeriod();
error InvestmentPool__EthTransferFailed();
error InvestmentPool__NoEthLeftToWithdraw();
error InvestmentPool__SuperTokenTransferFailed();

contract InvestmentPool is IInitializableInvestmentPool, SuperAppBase, Context, Initializable {
    using CFAv1Library for CFAv1Library.InitData;

    /** STATE VARIABLES */

    bytes32 internal constant CFA_ID =
        keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    uint256 internal constant PERCENTAGE_DIVIDER = 10**6;

    /**
     * @dev Values are used for bitwise operations to determine current project state.
     * @dev Investment pool can't have multiple states at the same time.
     */
    uint256 internal constant CANCELED_PROJECT_STATE_VALUE = 1;
    uint256 internal constant BEFORE_FUNDRAISER_STATE_VALUE = 2;
    uint256 internal constant FUNDRAISER_ONGOING_STATE_VALUE = 4;
    uint256 internal constant FAILED_FUNDRAISER_STATE_VALUE = 8;
    uint256 internal constant FUNDRAISER_ENDED_NO_MILESTONES_ONGOING_STATE_VALUE = 16;
    uint256 internal constant MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE = 32;
    uint256 internal constant LAST_MILESTONE_ONGOING_STATE_VALUE = 64;
    uint256 internal constant TERMINATED_BY_VOTING_STATE_VALUE = 128;
    uint256 internal constant TERMINATED_BY_GELATO_STATE_VALUE = 256;
    uint256 internal constant SUCCESSFULLY_ENDED_STATE_VALUE = 512;
    uint256 internal constant UNKNOWN_STATE_VALUE = 1024;
    uint256 internal ANY_MILESTONE_ONGOING_STATE_VALUE;

    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    // Contains addresses of superfluid's host and ConstanFlowAgreement
    CFAv1Library.InitData public cfaV1Lib;

    // Contains the address of accepted investment token
    ISuperToken internal acceptedToken;

    address internal creator;
    IGelatoOps internal gelatoOps;
    address payable internal gelato;
    bytes32 internal gelatoTask;
    IGovernancePool internal governancePool;

    // TODO: validate that uint96 for soft cap is enough
    uint96 internal seedFundingLimit;
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
    // Mapping from investor => milestoneId => amount invested
    mapping(address => mapping(uint256 => uint256)) internal investedAmount;

    /// @dev Milestone data
    // Total amount of milestones in this investment pool
    uint256 internal milestoneCount;
    // TODO: Look into, maybe an array would be better, since we have a fixed amount?
    mapping(uint256 => Milestone) internal milestones;
    uint256 internal currentMilestone;

    uint256 internal investmentWithdrawFee;
    uint256 internal seedFundingMultiplier;
    uint256 internal privateFundingMultiplier;
    uint256 internal publicFundingMultiplier;

    /**
     * @dev It's a memoization mapping for milestone Portions
     * @dev n-th element describes how much of a project is "left"
     * @dev all values are divided later by PERCENTAGE_DIVIDER
     * @dev in other words, 10% would be PERCENTAGE_DIVIDER / 10
     */
    mapping(uint256 => uint256) internal memMilestonePortions;
    /**
     * @dev It's a memoization mapping for milestone Investments
     * @dev n-th element describes how much money is invested into the project
     * @dev It doesn't hold real money value, but a value, which will be used in other formulas.
     * @dev Memoization will never be used on it's own, to get invested value.
     */
    mapping(uint256 => uint256) internal memMilestoneInvestments;

    /** EVENTS */

    event Cancel();
    event Invest(address indexed caller, uint256 amount);
    event Unpledge(address indexed caller, uint256 amount);
    event ClaimFunds(
        uint256 milestoneId,
        bool gotSeedFunds,
        bool gotStreamAmount,
        bool openedStream
    );
    event Refund(address indexed caller, uint256 amount);
    event TerminateStream(uint256 milestoneId);
    event GelatoFeeTransfer(uint256 fee, address feeToken);

    /** MODIFIERS */

    /**
     * @dev Checks every callback to validate inputs. MUST be called by the host.
     * @param _token The Super Token streamed in. MUST be the in-token.
     */
    modifier validCallback(ISuperToken _token) {
        if (_token != getAcceptedToken()) revert InvestmentPool__InvalidToken();

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

    /// @notice Ensures that the message sender is the gelato ops contract
    modifier onlyGelatoOps() {
        if (address(getGelatoOps()) != _msgSender()) revert InvestmentPool__NotGelatoOps();
        _;
    }

    modifier onlyGovernancePoolOrGelato() {
        if (
            address(getGovernancePool()) != _msgSender() && address(getGelatoOps()) != _msgSender()
        ) revert InvestmentPool__NotGovernancePoolOrGelato();
        _;
    }

    /// @notice Ensures that given amount is not zero
    modifier notZeroAmount(uint256 _amount) {
        if (_amount == 0) revert InvestmentPool__ZeroAmountProvided();
        _;
    }

    /// @notice Ensures that the milestone stream can be terminated
    modifier canTerminateMilestoneFinal(uint _index) {
        if (!canTerminateMilestoneStreamFinal(_index))
            revert InvestmentPool__MilestoneStreamTerminationUnavailable();
        _;
    }

    /// @notice Ensures that the milestone stream can be terminated by gelato
    modifier canGelatoTerminateMilestoneFinal(uint _index) {
        if (!canGelatoTerminateMilestoneStreamFinal(_index))
            revert InvestmentPool__GelatoMilestoneStreamTerminationUnavailable();
        _;
    }

    /// @notice Ensures that provided current project state is one of the provided. It uses bitwise operations in condition
    modifier allowedProjectStates(uint256 _states) {
        uint256 currentState = getProjectStateByteValue();
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
     * @param _gelatoOps gelato contract, which is responsible for creating automated tasks and accepting fee
     * @param _projectInfo information about the project milestones, fundraiser, termination.
     * @param _multipliers numbers, which are going to be used for calculating the voting tokens amount for minting
     * @param _investmentWithdrawFee fee, which is going to be used when unpledging investment
     * @param _milestones details about each milestone
     * @param _governancePool contract, which is used for managing voting system
     */
    function initialize(
        ISuperfluid _host,
        IGelatoOps _gelatoOps,
        ProjectInfo calldata _projectInfo,
        VotingTokensMultipliers calldata _multipliers,
        uint256 _investmentWithdrawFee,
        MilestoneInterval[] calldata _milestones,
        IGovernancePool _governancePool
    ) external payable initializer {
        /// @dev Parameter validation was already done for us by the Factory, so it's safe to use "as is" and save gas

        // Resolve the agreement address and initialize the lib
        cfaV1Lib = CFAv1Library.InitData(
            _host,
            IConstantFlowAgreementV1(address(_host.getAgreementClass(getCfaId())))
        );
        ANY_MILESTONE_ONGOING_STATE_VALUE =
            getMilestonesOngoingBeforeLastStateValue() |
            getLastMilestoneOngoingStateValue();

        gelatoOps = _gelatoOps;
        gelato = getGelatoOps().gelato();

        acceptedToken = _projectInfo.acceptedToken;
        creator = _projectInfo.creator;
        seedFundingLimit = _projectInfo.seedFundingLimit;
        softCap = _projectInfo.softCap;
        hardCap = _projectInfo.hardCap;
        fundraiserStartAt = _projectInfo.fundraiserStartAt;
        fundraiserEndAt = _projectInfo.fundraiserEndAt;
        terminationWindow = _projectInfo.terminationWindow;
        automatedTerminationWindow = _projectInfo.automatedTerminationWindow;

        seedFundingMultiplier = _multipliers.seedFundingMultiplier;
        privateFundingMultiplier = _multipliers.privateFundingMultiplier;
        publicFundingMultiplier = _multipliers.publicFundingMultiplier;

        investmentWithdrawFee = _investmentWithdrawFee;
        milestoneCount = _milestones.length;
        currentMilestone = 0;
        governancePool = _governancePool;

        MilestoneInterval memory interval;
        uint48 streamDurationsTotal = 0;

        // 100% of the project is "left" at the start
        memMilestonePortions[0] = getPercentageDivider();
        for (uint32 i = 0; i < _milestones.length; ++i) {
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
    function invest(uint256 _amount, bool _strict)
        external
        notZeroAmount(_amount)
        allowedProjectStates(
            getFundraiserOngoingStateValue() | getMilestonesOngoingBeforeLastStateValue()
        )
    {
        uint256 untilHardcap = getHardCap() - getTotalInvestedAmount();
        uint256 votingTokensToMint = _getVotingTokensAmountToMint(_amount);

        if (untilHardcap < _amount) {
            // Edge case, trying to invest, when hard cap is reached or almost reached
            if (_strict || untilHardcap == 0) {
                revert InvestmentPool__CannotInvestAboveHardCap();
            } else {
                // Non-strict mode, allow a smaller investment to go through
                _amount = untilHardcap;
            }
        }

        uint256 investToMilestoneId = isFundraiserOngoingNow() ? 0 : getCurrentMilestoneId() + 1;
        _investToMilestone(_msgSender(), investToMilestoneId, _amount);

        bool successfulTransfer = getAcceptedToken().transferFrom(
            _msgSender(),
            address(this),
            _amount
        );
        if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

        getGovernancePool().mintVotingTokens(
            investToMilestoneId,
            _msgSender(),
            votingTokensToMint
        );

        emit Invest(_msgSender(), _amount);
    }

    /**
     * @notice Allows investors to change their mind during the ongoing fundraiser or ongoing milestone.
     * @notice Funds are transfered back if milestone hasn't started yet. Unpledge all at once, or just a specified amount
     * @param _amount Amount of funds to withdraw.
     */
    function unpledge(uint256 _amount)
        external
        notZeroAmount(_amount)
        allowedProjectStates(
            getFundraiserOngoingStateValue() | getMilestonesOngoingBeforeLastStateValue()
        )
    {
        uint256 unpledgeFromMilestoneId = isFundraiserOngoingNow()
            ? 0
            : getCurrentMilestoneId() + 1;

        uint256 currentInvestedAmount = getInvestedAmount(_msgSender(), unpledgeFromMilestoneId);

        // We only check amount and don't do any checks to see if milestone hasn't started because we are always getting milestone in future
        if (_amount > currentInvestedAmount)
            revert InvestmentPool__AmountIsGreaterThanInvested(_amount, currentInvestedAmount);

        uint256 investmentCoefficient = memMilestonePortions[unpledgeFromMilestoneId];

        memMilestoneInvestments[unpledgeFromMilestoneId] -=
            (_amount * getPercentageDivider()) /
            investmentCoefficient;
        investedAmount[_msgSender()][unpledgeFromMilestoneId] -= _amount;
        totalInvestedAmount -= _amount;

        // Apply fee for withdrawal during the same period as invested (milestone or fundraiser)
        uint256 amountToTransfer = (_amount * (100 - getInvestmentWithdrawPercentageFee())) / 100;

        bool successfulTransfer = getAcceptedToken().transfer(_msgSender(), amountToTransfer);
        if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

        emit Unpledge(_msgSender(), _amount);
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
            uint investment = getInvestedAmount(_msgSender(), 0);
            if (investment == 0) revert InvestmentPool__NoMoneyInvested();

            investedAmount[_msgSender()][0] = 0;
            bool successfulTransfer1 = getAcceptedToken().transfer(_msgSender(), investment);
            if (!successfulTransfer1) revert InvestmentPool__SuperTokenTransferFailed();

            emit Refund(_msgSender(), investment);
            return;
        }

        uint256 currentMilestoneId = getCurrentMilestoneId();
        uint256 tokensOwned;
        uint256 totalMilestones = getMilestonesCount();

        // Calculate, how much money is left for each investment
        for (uint256 i = 0; i < totalMilestones; i++) {
            // We'll just straight up delete the investment information for now. Maybe needed for bookkeeping reasons?
            uint256 investment = getInvestedAmount(_msgSender(), i);

            if (investment != 0) {
                investedAmount[_msgSender()][i] = 0;

                if (i > currentMilestoneId) {
                    tokensOwned += investment;
                } else {
                    // It means i <= currentMilestoneId
                    // After project stop milestones don't change.
                    uint256 investmentCoef = memMilestonePortions[i];

                    // Total project portion that is left (Not amount for creator)
                    uint256 actualProjectLeft = _getEarlyTerminationProjectLeftPortion(
                        currentMilestoneId
                    );

                    // Get amount that was not used yet. This amount belongs to investor and should be transfered to him
                    uint256 investmentLeft = _getUnburnedAmountForInvestment(
                        investment,
                        actualProjectLeft,
                        investmentCoef
                    );

                    tokensOwned += investmentLeft;
                }
            }
        }

        if (tokensOwned == 0) revert InvestmentPool__NoMoneyInvested();

        bool successfulTransfer2 = getAcceptedToken().transfer(_msgSender(), tokensOwned);
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
        if (!isMilestoneOngoingNow(0)) revert InvestmentPool__NotInFirstMilestonePeriod();

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
        getGelatoOps().cancelTask(getGelatoTask());
        emit Cancel();
    }

    /**
     * @notice Allows creator to terminate stream and claim next milestone's funds.
     * @notice If it is a last milestone, only terminate the stream and cancel gelato tasks.
     */
    function milestoneJumpOrFinalProjectTermination()
        external
        onlyCreator
        allowedProjectStates(getAnyMilestoneOngoingStateValue())
    {
        uint curMil = getCurrentMilestoneId();
        _terminateMilestoneStreamFinal(curMil);

        if (!isLastMilestoneOngoing()) {
            currentMilestone++;
            _claim(curMil + 1);
        } else {
            getGelatoOps().cancelTask(getGelatoTask());
        }
    }

    /**
     * @notice Creator deposits gelato fee amount on project creation (which is 0.1 ETH for now)
     * @notice If project was canceled or terminated in any way
     */
    function withdrawRemainingEth()
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

    /** PUBLIC FUNCTIONS */

    /**
     * @notice Cancel project during milestone periods.
     * @notice Should only be called by the governane pool or gelato
     */
    function cancelDuringMilestones()
        public
        onlyGovernancePoolOrGelato
        allowedProjectStates(getAnyMilestoneOngoingStateValue())
    {
        emergencyTerminationTimestamp = uint48(_getNow());

        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlow(
            getAcceptedToken(),
            address(this),
            getCreator()
        );

        // Flow exists, do bookkeeping
        if (timestamp != 0) {
            uint256 streamedAmount = (_getNow() - timestamp) * uint256(int256(flowRate));

            cfaV1Lib.deleteFlow(address(this), getCreator(), getAcceptedToken());

            // Update the milestone paid amount, don't transfer rest of the funds
            _afterMilestoneStreamTermination(getCurrentMilestoneId(), streamedAmount, false);
        }

        getGelatoOps().cancelTask(getGelatoTask());
        emit Cancel();
    }

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
    function didFundraiserPeriodEnd() public view returns (bool) {
        return _getNow() >= getFundraiserEndTime();
    }

    /// @notice Check if the fundraiser period has not started
    function isFundraiserNotStarted() public view returns (bool) {
        return _getNow() < getFundraiserStartTime();
    }

    /// @notice Check if in fundraiser period
    function isFundraiserOngoingNow() public view returns (bool) {
        return _getNow() >= getFundraiserStartTime() && _getNow() < getFundraiserEndTime();
    }

    /// @notice Check if fundraiser has ended but 0 milestone has not started yet. Gap between fundraiser and 0 milestone
    function isFundraiserEndedButNoMilestoneIsActive() public view returns (bool) {
        return didFundraiserPeriodEnd() && _getNow() < getMilestone(0).startDate;
    }

    /// @notice Check if currently in milestone period
    /// @param _id Milestone id
    function isMilestoneOngoingNow(uint _id) public view returns (bool) {
        Milestone memory milestone = getMilestone(_id);
        return _getNow() >= milestone.startDate && _getNow() < milestone.endDate;
    }

    /// @notice Check if any milestone is ongoing now
    /// @notice Checking if currently in defined milestone because milestone jump happens before next milestone start date
    function isAnyMilestoneOngoing() public view returns (bool) {
        return
            _getNow() >= getMilestone(0).startDate &&
            _getNow() < getMilestone(getMilestonesCount() - 1).endDate;
    }

    /// @notice Check if last milestone is ongoing now
    function isLastMilestoneOngoing() public view returns (bool) {
        return isMilestoneOngoingNow(getMilestonesCount() - 1);
    }

    /// @notice Check if fundraiser has failed (didn't raise >= soft cap && ended)
    function isFailedFundraiser() public view returns (bool) {
        return didFundraiserPeriodEnd() && !isSoftCapReached();
    }

    function didProjectEnd() public view returns (bool) {
        return
            _getNow() > getMilestone(getMilestonesCount() - 1).endDate &&
            getCurrentMilestoneId() == getMilestonesCount() - 1;
    }

    /**
     * @notice Complete multiple checks and determine project state
     * @return stateNumber -> that is power of 2 from 2^0 to 2^7.
     * @dev It will be used in modifier to check if current state is allowed for function execution
     */
    function getProjectStateByteValue() public view returns (uint256 stateNumber) {
        if (isCanceledBeforeFundraiserStart()) {
            return getCanceledProjectStateValue();
        } else if (isFundraiserNotStarted() && !isEmergencyTerminated()) {
            return getBeforeFundraiserStateValue();
        } else if (isFundraiserOngoingNow() && !isEmergencyTerminated()) {
            return getFundraiserOngoingStateValue();
        } else if (isFailedFundraiser() && !isEmergencyTerminated()) {
            return getFailedFundraiserStateValue();
        } else if (
            isFundraiserEndedButNoMilestoneIsActive() &&
            !isEmergencyTerminated() &&
            !isFailedFundraiser()
        ) {
            return getFundraiserEndedNoMilestonesOngoingStateValue();
        } else if (
            isAnyMilestoneOngoing() &&
            !isLastMilestoneOngoing() &&
            !isEmergencyTerminated() &&
            !isFailedFundraiser()
        ) {
            return getMilestonesOngoingBeforeLastStateValue();
        } else if (isLastMilestoneOngoing() && !isEmergencyTerminated() && !isFailedFundraiser()) {
            return getLastMilestoneOngoingStateValue();
        } else if (
            getGelatoTask() != bytes32(0) && isCanceledDuringMilestones() && !isFailedFundraiser()
        ) {
            return getTerminatedByVotingStateValue();
        } else if (
            getGelatoTask() == bytes32(0) && isCanceledDuringMilestones() && !isFailedFundraiser()
        ) {
            return getTerminatedByGelatoStateValue();
        } else if (didProjectEnd() && !isEmergencyTerminated() && !isFailedFundraiser()) {
            return getSuccessfullyEndedStateValue();
        } else {
            return getUnknownStateValue();
        }
    }

    /// @notice Check if milestone can be terminated
    function canTerminateMilestoneStreamFinal(uint256 _milestoneId) public view returns (bool) {
        Milestone memory milestone = getMilestone(_milestoneId);
        return milestone.streamOngoing && milestone.endDate - getTerminationWindow() <= _getNow();
    }

    /// @notice Check if milestone can be terminated by Gelato automation
    function canGelatoTerminateMilestoneStreamFinal(uint256 _milestoneId)
        public
        view
        returns (bool)
    {
        Milestone memory milestone = getMilestone(_milestoneId);
        return
            milestone.streamOngoing &&
            milestone.endDate - getAutomatedTerminationWindow() <= _getNow() &&
            getGelatoTask() != bytes32(0);
    }

    /// @notice get seed amount dedicated to the milestone
    function getMilestoneSeedAmount(uint256 _milestoneId) public view returns (uint256) {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];
        return
            (memInvAmount * getMilestone(_milestoneId).intervalSeedPortion) /
            getPercentageDivider();
    }

    /// @notice Calculate the real funds allocation for the milestone
    function getTotalMilestoneTokenAllocation(uint _milestoneId) public view returns (uint256) {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];
        uint totalPercentage = getMilestone(_milestoneId).intervalSeedPortion +
            getMilestone(_milestoneId).intervalStreamingPortion;
        uint256 subt = memInvAmount * totalPercentage;
        return subt / getPercentageDivider();
    }

    /** GETTERS */

    /// @notice get current milestone id
    function getCurrentMilestoneId() public view virtual returns (uint256) {
        return currentMilestone;
    }

    function getCfaId() public pure returns (bytes32) {
        return CFA_ID;
    }

    function getPercentageDivider() public pure returns (uint256) {
        return PERCENTAGE_DIVIDER;
    }

    function getCanceledProjectStateValue() public pure returns (uint256) {
        return CANCELED_PROJECT_STATE_VALUE;
    }

    function getBeforeFundraiserStateValue() public pure returns (uint256) {
        return BEFORE_FUNDRAISER_STATE_VALUE;
    }

    function getFundraiserOngoingStateValue() public pure returns (uint256) {
        return FUNDRAISER_ONGOING_STATE_VALUE;
    }

    function getFailedFundraiserStateValue() public pure returns (uint256) {
        return FAILED_FUNDRAISER_STATE_VALUE;
    }

    function getFundraiserEndedNoMilestonesOngoingStateValue() public pure returns (uint256) {
        return FUNDRAISER_ENDED_NO_MILESTONES_ONGOING_STATE_VALUE;
    }

    function getMilestonesOngoingBeforeLastStateValue() public pure returns (uint256) {
        return MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE;
    }

    function getLastMilestoneOngoingStateValue() public pure returns (uint256) {
        return LAST_MILESTONE_ONGOING_STATE_VALUE;
    }

    function getTerminatedByVotingStateValue() public pure returns (uint256) {
        return TERMINATED_BY_VOTING_STATE_VALUE;
    }

    function getTerminatedByGelatoStateValue() public pure returns (uint256) {
        return TERMINATED_BY_GELATO_STATE_VALUE;
    }

    function getSuccessfullyEndedStateValue() public pure returns (uint256) {
        return SUCCESSFULLY_ENDED_STATE_VALUE;
    }

    function getUnknownStateValue() public pure returns (uint256) {
        return UNKNOWN_STATE_VALUE;
    }

    function getAnyMilestoneOngoingStateValue() public view returns (uint256) {
        return ANY_MILESTONE_ONGOING_STATE_VALUE;
    }

    function getEthAddress() public pure returns (address) {
        return ETH;
    }

    function getAcceptedToken() public view returns (ISuperToken) {
        return acceptedToken;
    }

    function getCreator() public view returns (address) {
        return creator;
    }

    function getGelatoOps() public view returns (IGelatoOps) {
        return gelatoOps;
    }

    function getGelato() public view returns (address payable) {
        return gelato;
    }

    function getGelatoTask() public view returns (bytes32) {
        return gelatoTask;
    }

    function getGovernancePool() public view returns (IGovernancePool) {
        return governancePool;
    }

    function getSeedFundingLimit() public view returns (uint96) {
        return seedFundingLimit;
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

    function getInvestedAmount(address _investor, uint256 _milestoneId)
        public
        view
        returns (uint256)
    {
        return investedAmount[_investor][_milestoneId];
    }

    function getMilestonesCount() public view returns (uint256) {
        return milestoneCount;
    }

    function getMilestone(uint256 _milestoneId) public view returns (Milestone memory) {
        return milestones[_milestoneId];
    }

    function getInvestmentWithdrawPercentageFee() public view returns (uint256) {
        return investmentWithdrawFee;
    }

    function getSeedFundingMultiplier() public view returns (uint256) {
        return seedFundingMultiplier;
    }

    function getPrivateFundingMultiplier() public view returns (uint256) {
        return privateFundingMultiplier;
    }

    function getPublicFundingMultiplier() public view returns (uint256) {
        return publicFundingMultiplier;
    }

    /**
     * @notice This function returns values that shouldn't be used on its own.
     * @notice The amount should be multiplied with the corresponding milestone's allocation percentage
     * @notice If list item is zero, percentage should be multiplied by the nearest value on the left that is not zero
     * @dev Used only by the frontend
     */
    function getMilestonesInvestmentsListForFormula() public view returns (uint256[] memory) {
        uint256 listValuesCount = getMilestonesCount();
        uint256[] memory investmentsList = new uint256[](listValuesCount);

        for (uint i = 0; i < listValuesCount; i++) {
            investmentsList[i] = memMilestoneInvestments[i];
        }
        return investmentsList;
    }

    /** INTERNAL FUNCTIONS */

    /// @notice Update value memMilestoneInvestments value, to make sure it doesn't return zero by mistake
    function _ifNeededUpdateMemInvestmentValue(uint256 _milestoneId) internal {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];
        if (memInvAmount == 0 && _milestoneId > 0) {
            memMilestoneInvestments[_milestoneId] = memMilestoneInvestments[_milestoneId - 1];
        }
    }

    /**
     * @notice Allows the pool creator to start streaming/receive funds for a certain milestone
     * @param _milestoneId Milestone index to claim funds for
     */
    function _claim(uint256 _milestoneId)
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

        _ifNeededUpdateMemInvestmentValue(_milestoneId);

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

                bool successfulTransfer = getAcceptedToken().transfer(getCreator(), seedAmount);
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

            bool successfulTransfer = getAcceptedToken().transfer(getCreator(), amount);
            if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

            emit ClaimFunds(_milestoneId, true, false, false);
        }

        uint256 tokenPortion = getTotalMilestoneTokenAllocation(_milestoneId);
        uint256 owedAmount = tokenPortion - milestone.paidAmount;

        // NOTE: we'll need to account for termination window here
        // in order to not create very high rate and short lived streams
        // that are difficult to terminate in time
        if (milestone.endDate - getTerminationWindow() <= _getNow()) {
            // Milestone has passed, we should pay immediately
            milestone.paid = true;
            milestone.paidAmount = tokenPortion;

            bool successfulTransfer = getAcceptedToken().transfer(getCreator(), owedAmount);
            if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

            emit ClaimFunds(_milestoneId, false, true, false);
        } else {
            milestone.streamOngoing = true;

            // TODO: Calculate the limits here, make sure there is no possibility of overflow

            // NOTE: we are not checking for existing flow here, because such existance would violate our contract rules
            // At this point, there should be no active stream to the creator's account so it's safe to open a new one
            uint leftStreamDuration = milestone.endDate - _getNow();
            int96 flowRate = int96(int256(owedAmount / leftStreamDuration));

            cfaV1Lib.createFlow(getCreator(), getAcceptedToken(), flowRate);
            emit ClaimFunds(_milestoneId, false, false, true);
        }
    }

    /** @notice Terminates the stream of funds from contract to creator.
        @dev Can only be called during the termination window for a particular milestone.
        @param _milestoneId Milestone index to terminate the stream for
     */
    function _terminateMilestoneStreamFinal(uint256 _milestoneId)
        internal
        canTerminateMilestoneFinal(_milestoneId)
    {
        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlow(
            getAcceptedToken(),
            address(this),
            getCreator()
        );

        if (timestamp != 0) {
            uint256 streamedAmount = (_getNow() - timestamp) * uint256(int256(flowRate));
            cfaV1Lib.deleteFlow(address(this), getCreator(), getAcceptedToken());

            // Perform final termination. Rest of the token buffer gets instantly sent
            _afterMilestoneStreamTermination(_milestoneId, streamedAmount, true);
        }
    }

    /// @notice After stream was terminated, transfer left funds to the creator or only update paid amount value.
    function _afterMilestoneStreamTermination(
        uint256 _milestoneId,
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
            uint256 tokenPortion = getTotalMilestoneTokenAllocation(_milestoneId);
            uint256 owedAmount = tokenPortion - milestone.paidAmount - streamedAmount;

            milestone.paidAmount = tokenPortion;
            milestone.paid = true;
            if (owedAmount > 0) {
                bool successfulTransfer = getAcceptedToken().transfer(getCreator(), owedAmount);
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
    function _investToMilestone(
        address _investor,
        uint256 _milestoneId,
        uint256 _amount
    ) internal {
        uint256 investmentCoefficient = memMilestonePortions[_milestoneId];

        if (memMilestoneInvestments[_milestoneId] == 0 && _milestoneId > 0) {
            memMilestoneInvestments[_milestoneId] = memMilestoneInvestments[_milestoneId - 1];
        }

        uint256 scaledInvestment = (_amount * getPercentageDivider()) / investmentCoefficient;

        memMilestoneInvestments[_milestoneId] += scaledInvestment;
        investedAmount[_investor][_milestoneId] += _amount;
        totalInvestedAmount += _amount;
    }

    /**
     * @notice Get the amount of voting tokens to mint. It is determined by the period (seed/private/public)
     */
    function _getVotingTokensAmountToMint(uint256 _amount) internal view returns (uint256) {
        uint256 returnedValue;

        if (getTotalInvestedAmount() < getSeedFundingLimit()) {
            // Seed funding
            if (getTotalInvestedAmount() + _amount <= getSeedFundingLimit()) {
                // Seed funding was not reached that's why multiplier will be the same for all voting tokens
                returnedValue = _amount * getSeedFundingMultiplier();
            } else if (getTotalInvestedAmount() + _amount <= getSoftCap()) {
                // Multiplier is going to be different. That's why we need to calculate
                // the amount which is going to be invested in seed funding and which in private funding.
                // In this situation, investor invested while in seed funding, but investment was to big to fit only in seed, so
                // the remaining funds were dedicated to private funding

                uint256 amountInSeedFunding = getSeedFundingLimit() - getTotalInvestedAmount();
                uint256 ticketsForSeedFunding = amountInSeedFunding * getSeedFundingMultiplier();

                uint256 amountInPrivateFunding = _amount - amountInSeedFunding;
                uint256 ticketsForPrivateFunding = amountInPrivateFunding *
                    getPrivateFundingMultiplier();

                returnedValue = ticketsForSeedFunding + ticketsForPrivateFunding;
            } else if (getTotalInvestedAmount() + _amount <= getHardCap()) {
                // Multiplier is going to be different. That's why we need to calculate
                // the amount which is going to be invested in seed funding, which in private funding and which in public funding.
                // In this situation investor invested in seed funding, but because it was too large, funds were dedicated to
                // private and public fundings too.

                uint256 amountInSeedFunding = getSeedFundingLimit() - getTotalInvestedAmount();
                uint256 ticketsForSeedFunding = amountInSeedFunding * getSeedFundingMultiplier();

                uint256 amountInPrivateFunding = (getSoftCap() - getSeedFundingLimit());
                uint256 ticketsForPrivateFunding = amountInPrivateFunding *
                    getPrivateFundingMultiplier();

                uint256 amountInPublicFunding = _amount -
                    amountInSeedFunding -
                    amountInPrivateFunding;
                uint256 ticketsForPublicFunding = amountInPublicFunding *
                    getPublicFundingMultiplier();

                returnedValue =
                    ticketsForSeedFunding +
                    ticketsForPrivateFunding +
                    ticketsForPublicFunding;
            }
        } else if (
            getTotalInvestedAmount() >= getSeedFundingLimit() &&
            getTotalInvestedAmount() < getSoftCap()
        ) {
            // Private funding
            if (getTotalInvestedAmount() + _amount <= getSoftCap()) {
                // Multiplier will be the same for all voting tokens
                returnedValue = _amount * getPrivateFundingMultiplier();
            } else if (getTotalInvestedAmount() + _amount <= getHardCap()) {
                // Multiplier is going to be different. That's why we need to calculate
                // the amount which is going to be invested in private funding and which in public funding.
                // Investor invested while in private funding. Remaining funds went to public funding.

                uint256 amountInPrivateFunding = getSoftCap() - getTotalInvestedAmount();
                uint256 ticketsForPrivateFunding = amountInPrivateFunding *
                    getPrivateFundingMultiplier();

                uint256 amountInPublicFunding = _amount - amountInPrivateFunding;
                uint256 ticketsForPublicFunding = amountInPublicFunding *
                    getPublicFundingMultiplier();

                returnedValue = ticketsForPrivateFunding + ticketsForPublicFunding;
            }
        } else if (
            getTotalInvestedAmount() >= getSoftCap() && getTotalInvestedAmount() < getHardCap()
        ) {
            // Public limited funding
            if (getTotalInvestedAmount() + _amount <= getHardCap()) {
                // Multiplier will be the same for all voting tokens
                returnedValue = _amount * getPublicFundingMultiplier();
            }
        }

        return returnedValue;
    }

    /// @notice Get the total project PORTION percentage. It shouldn't be confused with total investment percentage that is left.
    function _getEarlyTerminationProjectLeftPortion(uint256 _terminationMilestoneId)
        internal
        view
        returns (uint256)
    {
        /**
         * @dev Creator always has rights to get the seed amount for the termination milestone,
         * @dev even after termination this is to prevent project kills by whale investors.
         * @dev This way - investor will still be at loss for seed amount for next milestone
         */

        Milestone memory terminationMilestone = getMilestone(_terminationMilestoneId);
        uint256 milestonPortion = memMilestonePortions[_terminationMilestoneId];
        uint256 tokensReserved;

        if (terminationMilestone.paidAmount > 0) {
            tokensReserved = terminationMilestone.paidAmount;
        } else {
            tokensReserved = getMilestoneSeedAmount(_terminationMilestoneId);
        }

        uint256 totalMilestones = getMilestonesCount();
        uint256 leftAllocation;
        for (uint256 i = getCurrentMilestoneId(); i < totalMilestones; i++) {
            leftAllocation += getTotalMilestoneTokenAllocation(i);
        }

        /// @dev Example: 25% - (60$ * 25% / 300$) = 20%
        return milestonPortion - (((tokensReserved * milestonPortion) / leftAllocation));
    }

    function _getNow() internal view virtual returns (uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }

    /// @notice Get amount that belongs to the investor
    function _getUnburnedAmountForInvestment(
        uint256 _investmentAmount,
        uint256 _actualProjectLeft,
        uint _investmentCoef
    ) internal pure returns (uint256) {
        return (_investmentAmount * _actualProjectLeft) / _investmentCoef;
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
        uint256 currentMilestoneIndex = getCurrentMilestoneId();
        bool finalTermination = canTerminateMilestoneStreamFinal(currentMilestoneIndex);

        // TODO: handle overstream case in-between milestones
        // (if stream was not terminated in time)
        uint256 streamedAmount = (_getNow() - timestamp) * uint256(int256(flowRate));

        // At this point the stream itself was already terminated, just do some bookkeeping
        // NOTE: think about termination window edge cases here
        _afterMilestoneStreamTermination(currentMilestoneIndex, streamedAmount, finalTermination);

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
        uint256 milestoneId = getCurrentMilestoneId();
        canExec = canGelatoTerminateMilestoneStreamFinal(milestoneId);

        execPayload = abi.encodeWithSelector(
            this.gelatoTerminateMilestoneStreamFinal.selector,
            milestoneId
        );
    }

    /// @notice Register gelato task, to make termination automated
    function startGelatoTask() public {
        // Register task to run it automatically
        bytes32 taskId = getGelatoOps().createTaskNoPrepayment(
            address(this),
            this.gelatoTerminateMilestoneStreamFinal.selector,
            address(this),
            abi.encodeWithSelector(this.gelatoChecker.selector),
            getEthAddress()
        );

        gelatoTask = taskId;
    }

    /// @notice Function is called by gelato automation, when conditions are met
    function gelatoTerminateMilestoneStreamFinal(uint256 _milestoneId)
        public
        onlyGelatoOps
        canGelatoTerminateMilestoneFinal(_milestoneId)
    {
        cancelDuringMilestones();

        (uint256 fee, address feeToken) = getGelatoOps().getFeeDetails();
        _gelatoTransfer(fee, feeToken);

        getGelatoOps().cancelTask(getGelatoTask());
        gelatoTask = bytes32(0);
    }

    // TODO: Ensure that this wouldn't clash with our logic
    // Introduce limits and checks to prevent gelato from taking too much
    function _gelatoTransfer(uint256 _amount, address _paymentToken) internal {
        if (_paymentToken == getEthAddress()) {
            // If ETH address
            (bool success, ) = getGelato().call{value: _amount}("");
            if (!success) revert InvestmentPool__GelatoEthTransferFailed();
        }

        emit GelatoFeeTransfer(_amount, _paymentToken);
    }
}
