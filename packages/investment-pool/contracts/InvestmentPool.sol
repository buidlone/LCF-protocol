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

/// @notice Superfluid ERRORS for callbacks
/// @dev Thrown when the wrong token is streamed to the contract.
error InvestmentPool__InvalidToken();
/// @dev Thrown when the `msg.sender` of the app callbacks is not the Superfluid host.
error InvestmentPool__Unauthorized();

/// @notice InvestmentPool ERRORS
error InvestmentPool__NotCreator();
error InvestmentPool__NotGelatoOps();
error InvestmentPool__NotGovernancePool();
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

    bytes32 public constant CFA_ID =
        keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    uint256 public constant PERCENTAGE_DIVIDER = 10**6;

    /**
     * @dev Values are used for bitwise operations to determine current project state.
     * @dev Investment pool can't have multiple states at the same time.
     */
    uint256 public constant CANCELED_PROJECT_BYTE_VALUE = 1;
    uint256 public constant BEFORE_FUNDRAISER_BYTE_VALUE = 2;
    uint256 public constant ACTIVE_FUNDRAISER_BYTE_VALUE = 4;
    uint256 public constant FAILED_FUNDRAISER_BYTE_VALUE = 8;
    uint256 public constant FUNDRAISER_ENDED_NO_ACTIVE_MILESTONE_BYTE_VALUE = 16;
    uint256 public constant NOT_LAST_ACTIVE_MILESTONE_BYTE_VALUE = 32;
    uint256 public constant LAST_MILESTONE_BYTE_VALUE = 64;
    uint256 public constant TERMINATED_BY_VOTING_BYTE_VALUE = 128;
    uint256 public constant TERMINATED_BY_GELATO_BYTE_VALUE = 256;
    uint256 public constant SUCCESSFULLY_ENDED_BYTE_VALUE = 512;
    uint256 public constant NO_STATE_BYTE_VALUE = 1024;
    uint256 public constant ANY_ACTIVE_MILESTONE_BYTE_VALUE =
        NOT_LAST_ACTIVE_MILESTONE_BYTE_VALUE | LAST_MILESTONE_BYTE_VALUE;

    address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    // Contains addresses of superfluid's host and ConstanFlowAgreement
    CFAv1Library.InitData public cfaV1Lib;

    // Contains the address of accepted investment token
    ISuperToken public acceptedToken;

    address public creator;
    IGelatoOps public gelatoOps;
    address payable public gelato;
    bytes32 public gelatoTask;
    IGovernancePool public governancePool;

    // TODO: validate that uint96 for soft cap is enough
    uint96 public seedFundingLimit;
    uint96 public softCap;
    uint96 public hardCap;
    uint48 public fundraiserStartAt;
    uint48 public fundraiserEndAt;
    uint48 public totalStreamingDuration;
    uint48 public terminationWindow;
    uint48 public automatedTerminationWindow;
    uint48 public emergencyTerminationTimestamp;

    /// @dev Investment data
    uint256 public totalInvestedAmount;
    // Mapping from investor => milestoneId => amount invested
    mapping(address => mapping(uint256 => uint256)) public investedAmount;

    /// @dev Milestone data
    // Total amount of milestones in this investment pool
    uint256 public milestoneCount;
    // TODO: Look into, maybe an array would be better, since we have a fixed amount?
    mapping(uint256 => Milestone) public milestones;
    uint256 public currentMilestone;
    uint256 public investmentWithdrawFee;

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
        if (creator != _msgSender()) revert InvestmentPool__NotCreator();
        _;
    }

    /// @notice Ensures that the message sender is the gelato ops contract
    modifier onlyGelatoOps() {
        if (address(gelatoOps) != _msgSender()) revert InvestmentPool__NotGelatoOps();
        _;
    }

    modifier onlyGovernancePoolOrGelato() virtual {
        if (address(governancePool) != _msgSender() && address(gelatoOps) != _msgSender())
            revert InvestmentPool__NotGovernancePoolOrGelato();
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
        if (!canGelatoTerminateMilestoneStreamFinal(_index) || gelatoTask == bytes32(0))
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

    receive() external payable {}

    /** EXTERNAL FUNCTIONS */

    function initialize(
        ISuperfluid _host,
        ISuperToken _acceptedToken,
        address _creator,
        IGelatoOps _gelatoOps,
        ProjectInfo calldata _projectInfo,
        uint48 _terminationWindow,
        uint48 _automatedTerminationWindow,
        uint256 _investmentWithdrawFee,
        MilestoneInterval[] calldata _milestones,
        IGovernancePool _governancePool
    ) external payable initializer {
        /// @dev Parameter validation was already done for us by the Factory, so it's safe to use "as is" and save gas

        // Resolve the agreement address and initialize the lib
        cfaV1Lib = CFAv1Library.InitData(
            _host,
            IConstantFlowAgreementV1(address(_host.getAgreementClass(CFA_ID)))
        );

        acceptedToken = _acceptedToken;
        creator = _creator;
        gelatoOps = _gelatoOps;
        gelato = gelatoOps.gelato();
        seedFundingLimit = _projectInfo.seedFundingLimit;
        softCap = _projectInfo.softCap;
        hardCap = _projectInfo.hardCap;
        fundraiserStartAt = _projectInfo.fundraiserStartAt;
        fundraiserEndAt = _projectInfo.fundraiserEndAt;
        terminationWindow = _terminationWindow;
        automatedTerminationWindow = _automatedTerminationWindow;
        investmentWithdrawFee = _investmentWithdrawFee;
        milestoneCount = _milestones.length;
        currentMilestone = 0;
        governancePool = _governancePool;

        MilestoneInterval memory interval;
        uint48 streamDurationsTotal = 0;

        // 100% of the project is "left" at the start
        memMilestonePortions[0] = PERCENTAGE_DIVIDER;
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
        allowedProjectStates(ACTIVE_FUNDRAISER_BYTE_VALUE | NOT_LAST_ACTIVE_MILESTONE_BYTE_VALUE)
    {
        uint256 untilHardcap = hardCap - totalInvestedAmount;
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

        uint256 investToMilestoneId = isFundraiserOngoingNow()
            ? 0
            : _getCurrentMilestoneIndex() + 1;

        _investToMilestone(_msgSender(), investToMilestoneId, _amount);

        bool successfulTransfer = acceptedToken.transferFrom(_msgSender(), address(this), _amount);
        if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

        uint48 unlockTime = milestones[investToMilestoneId].startDate;

        // Mint voting tokens in governance pool
        governancePool.mintVotingTokens(
            investToMilestoneId,
            _msgSender(),
            votingTokensToMint,
            unlockTime
        );

        emit Invest(_msgSender(), _amount);
    }

    /**
     * @notice Allows investors to change their mind during the active fundraiser or not last milestone is active.
     * @notice Funds are transfered back if milestone hasn't started yet. Unpledge all at once, or just a specified amount
     * @param _amount Amount of funds to withdraw.
     */
    function unpledge(uint256 _amount)
        external
        notZeroAmount(_amount)
        allowedProjectStates(ACTIVE_FUNDRAISER_BYTE_VALUE | NOT_LAST_ACTIVE_MILESTONE_BYTE_VALUE)
    {
        uint256 unpledgeFromMilestoneId = isFundraiserOngoingNow()
            ? 0
            : _getCurrentMilestoneIndex() + 1;

        uint256 currentInvestedAmount = investedAmount[_msgSender()][unpledgeFromMilestoneId];

        // We only check amount and don't do any checks to see if milestone hasn't started because we are always getting milestone in future
        if (_amount > currentInvestedAmount)
            revert InvestmentPool__AmountIsGreaterThanInvested(_amount, currentInvestedAmount);

        uint256 investmentCoefficient = memMilestonePortions[unpledgeFromMilestoneId];

        memMilestoneInvestments[unpledgeFromMilestoneId] -=
            (_amount * PERCENTAGE_DIVIDER) /
            investmentCoefficient;
        investedAmount[_msgSender()][unpledgeFromMilestoneId] -= _amount;
        totalInvestedAmount -= _amount;

        // Apply fee for withdrawal during the same period as invested (milestone or fundraiser)
        uint256 amountToTransfer = (_amount * (100 - investmentWithdrawFee)) / 100;

        bool successfulTransfer = acceptedToken.transfer(_msgSender(), amountToTransfer);
        if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

        emit Unpledge(_msgSender(), _amount);
    }

    /**
     * @notice Allows investors to withdraw all locked funds for a failed project
     * @notice if the soft cap has not been raised by the fundraiser end date
     * @notice or project was terminated by investors votes
     */
    function refund()
        external
        allowedProjectStates(
            FAILED_FUNDRAISER_BYTE_VALUE |
                TERMINATED_BY_VOTING_BYTE_VALUE |
                TERMINATED_BY_GELATO_BYTE_VALUE
        )
    {
        // If fundraiser failed, transfer back total amount that investor invested
        if (isFailedFundraiser()) {
            uint investment = investedAmount[_msgSender()][0];
            if (investment == 0) revert InvestmentPool__NoMoneyInvested();

            investedAmount[_msgSender()][0] = 0;
            bool successfulTransfer1 = acceptedToken.transfer(_msgSender(), investment);
            if (!successfulTransfer1) revert InvestmentPool__SuperTokenTransferFailed();

            emit Refund(_msgSender(), investment);
            return;
        }

        uint256 currentMilestoneId = _getCurrentMilestoneIndex();
        uint256 tokensOwned;
        uint256 totalMilestones = milestoneCount;

        // Calculate, how much money is left for each investment
        for (uint256 i = 0; i < totalMilestones; i++) {
            // We'll just straight up delete the investment information for now. Maybe needed for bookkeeping reasons?
            uint256 investment = investedAmount[_msgSender()][i];

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

        bool successfulTransfer2 = acceptedToken.transfer(_msgSender(), tokensOwned);
        if (!successfulTransfer2) revert InvestmentPool__SuperTokenTransferFailed();

        emit Refund(_msgSender(), tokensOwned);
    }

    function startFirstFundsStream()
        external
        onlyCreator
        allowedProjectStates(ANY_ACTIVE_MILESTONE_BYTE_VALUE | TERMINATED_BY_VOTING_BYTE_VALUE)
    {
        if (!isMilestoneOngoingNow(0)) revert InvestmentPool__NotInFirstMilestonePeriod();

        _claim(0);
    }

    /**
     * @notice Cancel project before fundraiser start
     */
    function cancelBeforeFundraiserStart()
        external
        onlyCreator
        allowedProjectStates(BEFORE_FUNDRAISER_BYTE_VALUE)
    {
        emergencyTerminationTimestamp = uint48(_getNow());
        emit Cancel();
    }

    /**
     * @notice Allows creator to terminate stream and claim funds.
     * @notice If it is a last milestone, only terminate the stream.
     */
    function milestoneJumpOrFinalProjectTermination()
        external
        onlyCreator
        allowedProjectStates(ANY_ACTIVE_MILESTONE_BYTE_VALUE)
    {
        uint curMil = _getCurrentMilestoneIndex();
        _terminateMilestoneStreamFinal(curMil);

        if (!isLastMilestoneOngoing()) {
            currentMilestone++;
            _claim(curMil + 1);
        } else {
            gelatoOps.cancelTask(gelatoTask);
        }
    }

    function withdrawRemainingEth()
        external
        onlyCreator
        allowedProjectStates(
            CANCELED_PROJECT_BYTE_VALUE |
                FAILED_FUNDRAISER_BYTE_VALUE |
                TERMINATED_BY_VOTING_BYTE_VALUE |
                TERMINATED_BY_GELATO_BYTE_VALUE |
                SUCCESSFULLY_ENDED_BYTE_VALUE
        )
    {
        if (address(this).balance == 0) revert InvestmentPool__NoEthLeftToWithdraw();

        (bool success, ) = creator.call{value: address(this).balance}("");
        if (!success) revert InvestmentPool__EthTransferFailed();
    }

    /** PUBLIC FUNCTIONS */

    /**
     * @notice Cancel project during milestone periods.
     * @notice Should only be called by the governane pool
     */
    function cancelDuringMilestones()
        public
        onlyGovernancePoolOrGelato
        allowedProjectStates(ANY_ACTIVE_MILESTONE_BYTE_VALUE)
    {
        emergencyTerminationTimestamp = uint48(_getNow());

        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlow(
            acceptedToken,
            address(this),
            creator
        );

        // Flow exists, do bookkeeping
        if (timestamp != 0) {
            uint256 streamedAmount = (_getNow() - timestamp) * uint256(int256(flowRate));

            cfaV1Lib.deleteFlow(address(this), creator, acceptedToken);

            // Update the milestone paid amount, don't transfer rest of the funds
            _afterMilestoneStreamTermination(_getCurrentMilestoneIndex(), streamedAmount, false);
        }

        emit Cancel();
    }

    /// @notice Checks if project was canceled
    function isEmergencyTerminated() public view returns (bool) {
        return emergencyTerminationTimestamp != 0;
    }

    /// @notice Checks if project was canceled before fundraiser start
    function isCanceledBeforeFundraiserStart() public view returns (bool) {
        return isEmergencyTerminated() && emergencyTerminationTimestamp < fundraiserStartAt;
    }

    /// @notice Checks if project was canceled during milestones period
    function isCanceledDuringMilestones() public view returns (bool) {
        return isEmergencyTerminated() && emergencyTerminationTimestamp > milestones[0].startDate;
    }

    /// @notice Check if the fundraiser has raised enough invested funds to reach soft cap
    function isSoftCapReached() public view returns (bool) {
        return softCap <= totalInvestedAmount;
    }

    /// @notice Check if the fundraiser period has ended
    function didFundraiserPeriodEnd() public view returns (bool) {
        return _getNow() >= fundraiserEndAt;
    }

    /// @notice Check if the fundraiser period has not started
    function isFundraiserNotStarted() public view returns (bool) {
        return _getNow() < fundraiserStartAt;
    }

    /// @notice Check if in fundraiser period
    function isFundraiserOngoingNow() public view returns (bool) {
        return _getNow() >= fundraiserStartAt && _getNow() < fundraiserEndAt;
    }

    /// @notice Check if fundraiser has ended but 0 milestone has not started yet. Gap between fundraiser and 0 milestone
    function isFundraiserEndedButNoMilestoneIsActive() public view returns (bool) {
        return didFundraiserPeriodEnd() && _getNow() < milestones[0].startDate;
    }

    /// @notice Check if currently in milestone period
    /// @param _id Milestone id
    function isMilestoneOngoingNow(uint _id) public view returns (bool) {
        Milestone memory milestone = milestones[_id];
        return _getNow() >= milestone.startDate && _getNow() < milestone.endDate;
    }

    /// @notice Check if any milestone is ongoing now
    /// @notice Checking if currently in defined milestone because milestone jump happens before next milestone start date
    function isAnyMilestoneOngoing() public view returns (bool) {
        return
            _getNow() > milestones[0].startDate &&
            _getNow() < milestones[milestoneCount - 1].endDate;
    }

    /// @notice Check if last milestone is ongoing now
    function isLastMilestoneOngoing() public view returns (bool) {
        return isMilestoneOngoingNow(milestoneCount - 1);
    }

    /// @notice Check if fundraiser has failed (didn't raise >= soft cap && ended)
    function isFailedFundraiser() public view returns (bool) {
        return didFundraiserPeriodEnd() && !isSoftCapReached();
    }

    function didProjectEnd() public view returns (bool) {
        return
            _getNow() > milestones[milestoneCount - 1].endDate &&
            _getCurrentMilestoneIndex() == milestoneCount - 1;
    }

    /**
     * @notice Complete multiple checks and determine project state
     * @return stateNumber -> that is power of 2 from 2^0 to 2^7.
     * @dev It will be used in modifier to check if current state is allowed for function execution
     */
    function getProjectStateByteValue() public view returns (uint256 stateNumber) {
        if (isCanceledBeforeFundraiserStart()) {
            return CANCELED_PROJECT_BYTE_VALUE;
        } else if (isFundraiserNotStarted() && !isEmergencyTerminated()) {
            return BEFORE_FUNDRAISER_BYTE_VALUE;
        } else if (isFundraiserOngoingNow() && !isEmergencyTerminated()) {
            return ACTIVE_FUNDRAISER_BYTE_VALUE;
        } else if (isFailedFundraiser() && !isEmergencyTerminated()) {
            return FAILED_FUNDRAISER_BYTE_VALUE;
        } else if (
            isFundraiserEndedButNoMilestoneIsActive() &&
            !isEmergencyTerminated() &&
            !isFailedFundraiser()
        ) {
            return FUNDRAISER_ENDED_NO_ACTIVE_MILESTONE_BYTE_VALUE;
        } else if (
            isAnyMilestoneOngoing() &&
            !isLastMilestoneOngoing() &&
            !isEmergencyTerminated() &&
            !isFailedFundraiser()
        ) {
            return NOT_LAST_ACTIVE_MILESTONE_BYTE_VALUE;
        } else if (isLastMilestoneOngoing() && !isEmergencyTerminated() && !isFailedFundraiser()) {
            return LAST_MILESTONE_BYTE_VALUE;
        } else if (
            gelatoTask != bytes32(0) && isCanceledDuringMilestones() && !isFailedFundraiser()
        ) {
            return TERMINATED_BY_VOTING_BYTE_VALUE;
        } else if (
            gelatoTask == bytes32(0) && isCanceledDuringMilestones() && !isFailedFundraiser()
        ) {
            return TERMINATED_BY_GELATO_BYTE_VALUE;
        } else if (didProjectEnd() && !isEmergencyTerminated() && !isFailedFundraiser()) {
            return SUCCESSFULLY_ENDED_BYTE_VALUE;
        } else {
            return NO_STATE_BYTE_VALUE;
        }
    }

    /// @notice Check if milestone can be terminated
    function canTerminateMilestoneStreamFinal(uint256 _milestoneId) public view returns (bool) {
        Milestone storage milestone = milestones[_milestoneId];
        return milestone.streamOngoing && milestone.endDate - terminationWindow <= _getNow();
    }

    /// @notice Check if milestone can be terminated by Gelato automation
    function canGelatoTerminateMilestoneStreamFinal(uint256 _milestoneId)
        public
        view
        returns (bool)
    {
        Milestone storage milestone = milestones[_milestoneId];
        return
            milestone.streamOngoing && milestone.endDate - automatedTerminationWindow <= _getNow();
    }

    /// @notice get seed amount dedicated to the milestone
    function getMilestoneSeedAmount(uint256 _milestoneId) public view returns (uint256) {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];
        return (memInvAmount * milestones[_milestoneId].intervalSeedPortion) / PERCENTAGE_DIVIDER;
    }

    /// @notice Calculate the real funds allocation for the milestone
    function getTotalMilestoneTokenAllocation(uint _milestoneId) public returns (uint256) {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];
        if (memInvAmount == 0 && _milestoneId > 0) {
            memInvAmount = memMilestoneInvestments[_milestoneId - 1];
            memMilestoneInvestments[_milestoneId] = memInvAmount;
        }

        uint totalPercentage = milestones[_milestoneId].intervalSeedPortion +
            milestones[_milestoneId].intervalStreamingPortion;
        uint256 subt = memInvAmount * totalPercentage;
        return subt / PERCENTAGE_DIVIDER;
    }

    /** INTERNAL FUNCTIONS */

    /**
     * @notice Allows the pool creator to start streaming/receive funds for a certain milestone
     * @param _milestoneId Milestone index to claim funds for
     */
    function _claim(uint256 _milestoneId)
        internal
        onlyCreator
        allowedProjectStates(ANY_ACTIVE_MILESTONE_BYTE_VALUE | TERMINATED_BY_VOTING_BYTE_VALUE)
    {
        Milestone storage milestone = milestones[_milestoneId];

        if (_milestoneId > _getCurrentMilestoneIndex())
            revert InvestmentPool__MilestoneStillLocked();
        if (milestone.streamOngoing)
            revert InvestmentPool__AlreadyStreamingForMilestone(_milestoneId);
        if (milestone.paid) revert InvestmentPool__AlreadyPaidForMilestone(_milestoneId);

        // Allow creator to claim only milestone seed funds if milestone was terminated by voting
        if (isCanceledDuringMilestones()) {
            if (
                !milestone.seedAmountPaid &&
                emergencyTerminationTimestamp > milestone.startDate &&
                emergencyTerminationTimestamp < milestone.endDate
            ) {
                uint256 seedAmount = getMilestoneSeedAmount(_milestoneId);
                milestone.seedAmountPaid = true;
                milestone.paidAmount = seedAmount;

                bool successfulTransfer = acceptedToken.transfer(creator, seedAmount);
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

            bool successfulTransfer = acceptedToken.transfer(creator, amount);
            if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

            emit ClaimFunds(_milestoneId, true, false, false);
        }

        uint256 tokenPortion = getTotalMilestoneTokenAllocation(_milestoneId);
        uint256 owedAmount = tokenPortion - milestone.paidAmount;

        // NOTE: we'll need to account for termination window here
        // in order to not create very high rate and short lived streams
        // that are difficult to terminate in time
        if (milestone.endDate - terminationWindow <= _getNow()) {
            // Milestone has passed, we should pay immediately
            milestone.paid = true;
            milestone.paidAmount = tokenPortion;

            bool successfulTransfer = acceptedToken.transfer(creator, owedAmount);
            if (!successfulTransfer) revert InvestmentPool__SuperTokenTransferFailed();

            emit ClaimFunds(_milestoneId, false, true, false);
        } else {
            milestone.streamOngoing = true;

            // TODO: Calculate the limits here, make sure there is no possibility of overflow

            // NOTE: we are not checking for existing flow here, because such existance would violate our contract rules
            // At this point, there should be no active stream to the creator's account so it's safe to open a new one
            uint leftStreamDuration = milestone.endDate - _getNow();
            int96 flowRate = int96(int256(owedAmount / leftStreamDuration));

            cfaV1Lib.createFlow(creator, acceptedToken, flowRate);
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
            acceptedToken,
            address(this),
            creator
        );

        if (timestamp != 0) {
            uint256 streamedAmount = (_getNow() - timestamp) * uint256(int256(flowRate));
            cfaV1Lib.deleteFlow(address(this), creator, acceptedToken);

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
                bool successfulTransfer = acceptedToken.transfer(creator, owedAmount);
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

        uint256 scaledInvestment = (_amount * PERCENTAGE_DIVIDER) / investmentCoefficient;

        memMilestoneInvestments[_milestoneId] += scaledInvestment;
        investedAmount[_investor][_milestoneId] += _amount;
        totalInvestedAmount += _amount;
    }

    /**
     * @notice Get the multiplier for voting tokens to mint. It is determined by the period (seed/private/public)
     * @notice Multiplier for seed funding is 2,5; private - 1,9; public - 1.
     * @dev Multiplier is firstly multiplied by 10 to avoid decimal places rounding in solidity
     */
    function _getVotingTokensAmountToMint(uint256 _amount) internal view returns (uint256) {
        uint256 seedFundingMultiplier = 25;
        uint256 privateFundingMultiplier = 19;
        uint256 publicFundingMultiplier = 10;

        if (totalInvestedAmount < seedFundingLimit) {
            // Seed funding
            if (totalInvestedAmount + _amount <= seedFundingLimit) {
                // Multiplier will be the same for all voting tokens
                return _amount * seedFundingMultiplier;
            } else if (totalInvestedAmount + _amount <= softCap) {
                // Multiplier is going to be different. That's why we need to calculate
                // the amount which is going to be invested in seed funding and which in private funding
                uint256 amountInSeedFunding = (seedFundingLimit - totalInvestedAmount) *
                    seedFundingMultiplier;
                uint256 amountInPrivateFunding = (_amount - amountInSeedFunding) *
                    privateFundingMultiplier;
                return amountInSeedFunding + amountInPrivateFunding;
            } else if (totalInvestedAmount + _amount <= hardCap) {
                // Multiplier is going to be different. That's why we need to calculate
                // the amount which is going to be invested in seed funding, which in private funding and which in public funding
                uint256 amountInSeedFunding = (seedFundingLimit - totalInvestedAmount) *
                    seedFundingMultiplier;
                uint256 amountInPrivateFunding = (softCap - seedFundingLimit) *
                    privateFundingMultiplier;
                uint256 amountInPublicFunding = (_amount -
                    amountInSeedFunding -
                    amountInPrivateFunding) * publicFundingMultiplier;
                return amountInSeedFunding + amountInPrivateFunding + amountInPublicFunding;
            }
        } else if (totalInvestedAmount >= seedFundingLimit && totalInvestedAmount < softCap) {
            // Private funding
            if (totalInvestedAmount + _amount <= softCap) {
                // Multiplier will be the same for all voting tokens
                return _amount * privateFundingMultiplier;
            } else if (totalInvestedAmount + _amount <= hardCap) {
                // Multiplier is going to be different. That's why we need to calculate
                // the amount which is going to be invested in private funding and which in public funding
                uint256 amountInPrivateFunding = (softCap - totalInvestedAmount) *
                    privateFundingMultiplier;
                uint256 amountInPublicFunding = (_amount - amountInPrivateFunding) *
                    publicFundingMultiplier;
                return amountInPrivateFunding + amountInPublicFunding;
            }
        } else if (totalInvestedAmount >= softCap && totalInvestedAmount < hardCap) {
            // Public limited funding
            if (totalInvestedAmount + _amount <= hardCap) {
                // Multiplier will be the same for all voting tokens
                return _amount * publicFundingMultiplier;
            }
        }
    }

    /// @notice Get the total project PORTION percentage. It shouldn't be confused with total investment percentage that is left.
    function _getEarlyTerminationProjectLeftPortion(uint256 _terminationMilestoneId)
        internal
        returns (uint256)
    {
        /**
         * @dev Creator always has rights to get the seed amount for the termination milestone,
         * @dev even after termination this is to prevent project kills by whale investors.
         * @dev This way - investor will still be at loss for seed amount for next milestone
         */

        Milestone memory terminationMilestone = milestones[_terminationMilestoneId];
        uint256 milestonPortion = memMilestonePortions[_terminationMilestoneId];
        uint256 tokensReserved;

        if (terminationMilestone.paidAmount > 0) {
            tokensReserved = terminationMilestone.paidAmount;
        } else {
            tokensReserved = getMilestoneSeedAmount(_terminationMilestoneId);
        }

        uint256 totalMilestones = milestoneCount;
        uint256 leftAllocation;
        for (uint256 i = _getCurrentMilestoneIndex(); i < totalMilestones; i++) {
            leftAllocation += getTotalMilestoneTokenAllocation(i);
        }

        /// @dev Example: 25% - (60$ * 25% / 300$) = 20%
        return milestonPortion - (((tokensReserved * milestonPortion) / leftAllocation));
    }

    function _getCurrentMilestoneIndex() internal view virtual returns (uint256) {
        // NOTE: Use internal storage for now, later can swap for governance implementation
        return currentMilestone;
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

        if (sender != address(this) || receiver != creator) return ctx;

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
        uint256 currentMilestoneIndex = _getCurrentMilestoneIndex();
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
        if (gelatoTask != bytes32(0)) {
            // Check if gelato can terminate stream of current milestone
            canExec = canGelatoTerminateMilestoneStreamFinal(_getCurrentMilestoneIndex());
        } else {
            canExec = false;
        }

        execPayload = abi.encodeWithSelector(this.gelatoTerminateMilestoneStreamFinal.selector);
    }

    function startGelatoTask() public {
        // Register task to run it automatically
        bytes32 taskId = gelatoOps.createTaskNoPrepayment(
            address(this),
            this.gelatoTerminateMilestoneStreamFinal.selector,
            address(this),
            abi.encodeWithSelector(this.gelatoChecker.selector),
            ETH
        );

        gelatoTask = taskId;
    }

    function gelatoTerminateMilestoneStreamFinal(uint256 _milestoneId)
        public
        onlyGelatoOps
        canGelatoTerminateMilestoneFinal(_milestoneId)
    {
        cancelDuringMilestones();

        (uint256 fee, address feeToken) = gelatoOps.getFeeDetails();
        _gelatoTransfer(fee, feeToken);

        gelatoOps.cancelTask(gelatoTask);
        gelatoTask = bytes32(0);
    }

    // TODO: Ensure that this wouldn't clash with our logic
    // Introduce limits and checks to prevent gelato from taking too much
    function _gelatoTransfer(uint256 _amount, address _paymentToken) internal {
        if (_paymentToken == ETH) {
            // If ETH address
            (bool success, ) = gelato.call{value: _amount}("");
            if (!success) revert InvestmentPool__GelatoEthTransferFailed();
        }

        emit GelatoFeeTransfer(_amount, _paymentToken);
    }
}
