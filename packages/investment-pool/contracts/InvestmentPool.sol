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
import {IGelatoOps} from "./interfaces/IGelatoOps.sol";

/// @notice Superfluid ERRORS for callbacks
/// @dev Thrown when the wrong token is streamed to the contract.
error InvestmentPool__InvalidToken();
/// @dev Thrown when the `msg.sender` of the app callbacks is not the Superfluid host.
error InvestmentPool__Unauthorized();
/// @notice InvestmentPool ERRORS
error InvestmentPool__CampaignCanceled();
error InvestmentPool__SoftCapNotReached();
error InvestmentPool__FundraiserAlreadyStarted();
error InvestmentPool__FundraiserNotStartedYet();
error InvestmentPool__NotInFundraiserPeriod();
error InvestmentPool__FundraiserNotFailed();
error InvestmentPool__FundraiserFailed();
error InvestmentPool__NotCreator();
error InvestmentPool__NotGelatoOps();
error InvestmentPool__MilestoneStillLocked();
error InvestmentPool__MilestoneStreamTerminationUnavailable();
error InvestmentPool__GelatoMilestoneStreamTerminationUnavailable();
error InvestmentPool__RefundNotAvailable();
error InvestmentPool__NoMoneyInvested();
error InvestmentPool__AlreadyStreamingForMilestone(uint256 milestone);
error InvestmentPool__GelatoEthTransferFailed();
error InvestmentPool__CannotInvestAboveHardCap();
error InvestmentPool__CannotUnpledgeInvestment();

contract InvestmentPool is
    IInitializableInvestmentPool,
    SuperAppBase,
    Context,
    Initializable
{
    using CFAv1Library for CFAv1Library.InitData;

    bytes32 public constant CFA_ID =
        keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");

    uint256 public constant PERCENTAGE_DIVIDER = 10**6;

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

    // TODO: validate that uint96 for soft cap is enough
    uint96 public softCap;

    uint96 public hardCap;

    uint48 public fundraiserStartAt;

    uint48 public fundraiserEndAt;

    uint48 public totalStreamingDuration;

    uint48 public terminationWindow;

    uint48 public automatedTerminationWindow;

    uint48 public emergencyTerminationTimestamp;

    // Investment data
    uint256 public totalInvestedAmount;
    // Mapping from pledger => milestoneId => amount invested
    mapping(address => mapping(uint256 => uint256)) public investedAmount;

    // Milestone data
    // Total amount of milestones in this investment pool
    uint256 public milestoneCount;
    // TODO: Look into, maybe an array would be better, since we have a fixed amount?
    mapping(uint256 => Milestone) public milestones;
    uint256 public currentMilestone;
    uint256 public maxUnlockedMilestone;

    // It's a memoization mapping for milestone Portions
    // n-th element describes how much of a project is "left"
    // all values are divided later by PERCENTAGE_DIVIDER
    // in other words, 10% would be PERCENTAGE_DIVIDER / 10
    mapping(uint256 => uint256) internal memMilestonePortions;
    mapping(uint256 => uint256) internal memMilestoneInvestments;

    event Cancel();
    event Invest(address indexed caller, uint256 amount);
    event Unpledge(address indexed caller, uint256 amount);
    event Claim(uint256 milestoneId);
    event Refund(address indexed caller, uint256 amount);

    /// @dev Checks every callback to validate inputs. MUST be called by the host.
    /// @param token The Super Token streamed in. MUST be the in-token.
    modifier validCallback(ISuperToken token) {
        if (token != acceptedToken) revert InvestmentPool__InvalidToken();

        // NOTE: Checking msg.sender here instead of _msgSender()
        // because it's supposed to be called by the Superfluid host only
        if (msg.sender != address(cfaV1Lib.host))
            revert InvestmentPool__Unauthorized();
        _;
    }

    modifier isNotCanceled() {
        if (emergencyTerminationTimestamp != 0)
            revert InvestmentPool__CampaignCanceled();
        _;
    }

    /** @notice Confirms that the fundraiser has reached a soft cap
     */
    modifier softCapReached() {
        if (!isSoftCapReached()) revert InvestmentPool__SoftCapNotReached();
        _;
    }

    /** @notice Ensures that the fundraiser is not started yet
     */
    modifier fundraiserNotStartedYet() {
        if (_getNow() > fundraiserStartAt)
            revert InvestmentPool__FundraiserAlreadyStarted();
        _;
    }

    /** @notice Ensures that the fundraiser is already started
     */
    modifier fundraiserAlreadyStarted() {
        if (_getNow() < fundraiserStartAt)
            revert InvestmentPool__FundraiserNotStartedYet();
        _;
    }

    /** @notice Ensures that the fundraiser period for a given campaign is ongoing
     */
    modifier fundraiserOngoingNow() {
        if (!isFundraiserOngoingNow())
            revert InvestmentPool__NotInFundraiserPeriod();
        _;
    }

    /** @notice Ensures that the fundraiser has failed and investors are eligible for refunds
     */
    modifier failedFundraiser() {
        if (!isFailedFundraiser()) revert InvestmentPool__FundraiserNotFailed();
        _;
    }

    /** @notice Ensures that the message sender is the fundraiser creator
     */
    modifier onlyCreator() {
        if (creator != _msgSender()) revert InvestmentPool__NotCreator();
        _;
    }

    /** @notice Ensures that the message sender is the gelato ops contract
     */
    modifier onlyGelatoOps() {
        if (address(gelatoOps) != _msgSender())
            revert InvestmentPool__NotGelatoOps();
        _;
    }

    modifier milestoneUnlocked(uint256 index) {
        if (index > _getMaxUnlockedMilestone())
            revert InvestmentPool__MilestoneStillLocked();
        _;
    }

    modifier canTerminateMilestoneFinal(uint index) {
        if (!canTerminateMilestoneStreamFinal(index))
            revert InvestmentPool__MilestoneStreamTerminationUnavailable();
        _;
    }

    modifier canGelatoTerminateMilestoneFinal(uint index) {
        if (!canGelatoTerminateMilestoneStreamFinal(index))
            revert InvestmentPool__GelatoMilestoneStreamTerminationUnavailable();
        _;
    }

    function isEmergencyTerminated() public view returns (bool) {
        return emergencyTerminationTimestamp != 0;
    }

    /** @notice Check if in fundraiser period
        @return true if currently accepting investments
     */
    function isFundraiserOngoingNow() public view returns (bool) {
        return _getNow() >= fundraiserStartAt && _getNow() < fundraiserEndAt;
    }

    /** @notice Check if in milestone period
        @param _id Milestone Id
        @return true if currently in milestone period
     */
    function isMilestoneOngoingNow(uint _id) public view returns (bool) {
        return
            _getNow() >= milestones[_id].startDate &&
            _getNow() < milestones[_id].endDate;
    }

    /** @notice Check if the fundraiser has raised enough invested funds to reach soft cap
        @return true if fundraiser has raised enough invested funds to reach soft cap
     */
    function isSoftCapReached() public view returns (bool) {
        return softCap <= totalInvestedAmount;
    }

    /** @notice Check if the fundraiser period has ended
     */
    function didFundraiserPeriodEnd() public view returns (bool) {
        return _getNow() >= fundraiserEndAt;
    }

    /** @notice Check if fundraiser has failed (didn't raise >= soft cap and ended)
        @return true if the fundraiser is considered failed and investors are eligible for refunds
     */
    function isFailedFundraiser() public view returns (bool) {
        return didFundraiserPeriodEnd() && !isSoftCapReached();
    }

    function calculateTokenPortionForMilestone(uint256 _milestoneId)
        public
        view
        returns (uint256)
    {
        return
            (totalInvestedAmount * totalStreamingDuration) /
            getMilestoneDuration(_milestoneId);
    }

    function getMilestoneDuration(uint256 _milestoneId)
        public
        view
        returns (uint256)
    {
        return
            milestones[_milestoneId].endDate -
            milestones[_milestoneId].startDate;
    }

    function canTerminateMilestoneStreamFinal(uint256 _milestoneId)
        public
        view
        returns (bool)
    {
        Milestone storage milestone = milestones[_milestoneId];

        return
            milestone.streamOngoing &&
            milestone.endDate - terminationWindow <= _getNow();
    }

    function canGelatoTerminateMilestoneStreamFinal(uint256 _milestoneId)
        public
        view
        returns (bool)
    {
        Milestone storage milestone = milestones[_milestoneId];

        return
            milestone.streamOngoing &&
            milestone.endDate - automatedTerminationWindow <= _getNow();
    }

    function initialize(
        ISuperfluid _host,
        ISuperToken _acceptedToken,
        address _creator,
        IGelatoOps _gelatoOps,
        uint96 _softCap,
        uint96 _hardCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        uint48 _terminationWindow,
        uint48 _automatedTerminationWindow,
        MilestoneInterval[] calldata _milestones
    ) public initializer {
        // NOTE: Parameter validation was already done for us by the Factory, so it's safe to use "as is" and save gas

        // Resolve the agreement address and initialize the lib
        cfaV1Lib = CFAv1Library.InitData(
            _host,
            IConstantFlowAgreementV1(address(_host.getAgreementClass(CFA_ID)))
        );

        acceptedToken = _acceptedToken;
        creator = _creator;
        gelatoOps = _gelatoOps;
        gelato = gelatoOps.gelato();
        softCap = _softCap;
        hardCap = _hardCap;
        fundraiserStartAt = _fundraiserStartAt;
        fundraiserEndAt = _fundraiserEndAt;
        terminationWindow = _terminationWindow;
        automatedTerminationWindow = _automatedTerminationWindow;
        milestoneCount = _milestones.length;
        currentMilestone = 0;

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
                (_milestones[i].intervalSeedPortion +
                    _milestones[i].intervalStreamingPortion);

            streamDurationsTotal += (_milestones[i].endDate -
                _milestones[i].startDate);
        }

        totalStreamingDuration = streamDurationsTotal;

        // Register gelato's automation task
        startGelatoTask();
    }

    /** @notice Allows to invest a specified amount of funds
        @dev Prior approval from _msgSender() to this contract is required
        @param _amount Amount of tokens to invest, must be <= approved amount
        @param _strict Does the transaction revert if amount too large? Or investment of a smaller amount is also accepted?
     */
    function invest(uint256 _amount, bool _strict)
        external
        //TODO: Maybe remove this, or alter logic?
        //fundraiserOngoingNow
        isNotCanceled
        fundraiserAlreadyStarted
    {
        uint256 untilHardcap = hardCap - totalInvestedAmount;

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
        acceptedToken.transferFrom(_msgSender(), address(this), _amount);

        // Add voting token mint here

        emit Invest(_msgSender(), _amount);
    }

    /** @notice Allows investors to change their mind during the fundraiser period and get their funds back. All at once, or just a specified portion
        @param _amount Amount of funds to withdraw.
     */
    function unpledge(uint256 _milestoneId, uint256 _amount) external {
        if (isFailedFundraiser()) revert InvestmentPool__FundraiserFailed();

        uint256 investmentCoefficient = memMilestonePortions[_milestoneId];

        if (
            investedAmount[_msgSender()][_milestoneId] >= _amount &&
            milestones[_milestoneId].startDate > _getNow()
        ) {
            totalInvestedAmount -= _amount;
            investedAmount[_msgSender()][_milestoneId] -= _amount;
            memMilestoneInvestments[_milestoneId] -=
                (_amount * investmentCoefficient) /
                PERCENTAGE_DIVIDER;

            acceptedToken.transfer(_msgSender(), _amount);

            emit Unpledge(_msgSender(), _amount);
        } else {
            revert InvestmentPool__CannotUnpledgeInvestment();
        }
    }

    /** @notice Allows investors to withdraw all locked funds for a failed campaign(if the soft cap has not been raised by the fundraiser end date)
     */
    function refund()
        external
    // failedFundraiser // TODO: Possible that after milestone voting is added, this needs to be changed
    // to account for milestone rejection
    {
        if (!(isFailedFundraiser() || isEmergencyTerminated()))
            revert InvestmentPool__RefundNotAvailable();

        if (isFailedFundraiser()) {
            uint investment = investedAmount[_msgSender()][0];
            investedAmount[_msgSender()][0] = 0;

            if (investment == 0) revert InvestmentPool__NoMoneyInvested();

            acceptedToken.transfer(_msgSender(), investment);

            emit Refund(_msgSender(), investment);
            return;
        }

        // TODO: go through all of the person's investments(for each milestone)
        // And calculate, how much money is lost for each investment

        // After project stop - milestones don't change
        uint256 actualProjectLeft = _getEarlyTerminationProjectLeftPortion(
            _getCurrentMilestoneIndex()
        );

        uint tokensOwed;
        for (uint i = 0; i < milestoneCount; i++) {
            // We'll just straight up delete the investment information for now
            // Maybe needed for bookkeeping reasons?

            uint256 investmentCoef = memMilestonePortions[i];
            uint256 investment = investedAmount[_msgSender()][i];

            uint256 investmentLeft = _getUnburnedAmountForInvestment(
                investment,
                actualProjectLeft,
                investmentCoef
            );

            tokensOwed += investmentLeft;

            investedAmount[_msgSender()][i] = 0;
        }

        if (tokensOwed == 0) revert InvestmentPool__NoMoneyInvested();

        acceptedToken.transfer(_msgSender(), tokensOwed);

        emit Refund(_msgSender(), tokensOwed);
    }

    /** @notice Allows the pool creator to start streaming/receive funds for a certain milestone
        @param _milestoneId Milestone index to claim funds for
     */
    function claim(uint256 _milestoneId)
        public
        onlyCreator
        milestoneUnlocked(_milestoneId)
        isNotCanceled
    {
        Milestone storage milestone = milestones[_milestoneId];

        if (!milestone.seedAmountPaid) {
            uint256 amount = getMilestoneSeedAmount(_milestoneId);
            milestone.seedAmountPaid = true;
            // TODO: maybe we can avoid sum here, cause paid should be 0 at this point
            milestone.paidAmount = milestone.paidAmount + amount;
            acceptedToken.transfer(creator, amount);
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
            acceptedToken.transfer(creator, owedAmount);
        } else {
            if (milestone.streamOngoing)
                revert InvestmentPool__AlreadyStreamingForMilestone(
                    _milestoneId
                );

            // Milestone is still ongoing, calculate the flowrate and stream
            uint leftStreamDuration = milestone.endDate - _getNow();

            // TODO: Calculate the limits here, make sure there is no possibility of overflow

            // NOTE: we are not checking for existing flow here, because such existance would violate our contract rules
            // At this point, there should be no active stream
            // to the creator's account
            // so it's safe to open a new one
            int96 flowRate = int96(int256(owedAmount / leftStreamDuration));
            cfaV1Lib.createFlow(creator, acceptedToken, flowRate);

            milestone.streamOngoing = true;
        }

        emit Claim(_milestoneId);
    }

    /** @notice Terminates the stream of funds from contract to creator
        @dev can only be called during the termination window for a particular milestone
        @param _milestoneId Milestone index to terminate the stream for
     */
    function terminateMilestoneStreamFinal(uint256 _milestoneId)
        public
        canTerminateMilestoneFinal(_milestoneId)
    {
        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlow(
            acceptedToken,
            address(this),
            creator
        );

        // TODO: handle overstream case in-between milestones
        // (if stream was not terminated in time)
        uint256 streamedAmount = (_getNow() - timestamp) *
            uint256(int256(flowRate));

        cfaV1Lib.deleteFlow(address(this), creator, acceptedToken);

        // Perform final termination. Rest of the token buffer gets instantly sent
        _afterMilestoneStreamTermination(_milestoneId, streamedAmount, true);
    }

    // TODO: Decide if needed
    /** @notice Stops fundraiser campaign
     */
    function cancel()
        external
        onlyCreator
        isNotCanceled
        fundraiserNotStartedYet
    {
        emergencyTerminationTimestamp = (uint48)(block.timestamp);
        emit Cancel();
    }

    // TODO: Decide if needed
    /** @notice Stops fundraiser campaign
     */
    function emergencyCancel() external isNotCanceled {
        emergencyTerminationTimestamp = (uint48)(block.timestamp);

        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlow(
            acceptedToken,
            address(this),
            creator
        );

        // Flow exists, do bookkeeping
        if (timestamp != 0) {
            uint256 streamedAmount = (_getNow() - timestamp) *
                (uint256)((int256)(flowRate));

            milestones[_getCurrentMilestoneIndex()]
                .paidAmount += streamedAmount;

            cfaV1Lib.cfa.deleteFlow(acceptedToken, address(this), creator, "");
        }

        emit Cancel();
    }

    function milestoneJump() external isNotCanceled {
        uint curMil = _getCurrentMilestoneIndex();
        terminateMilestoneStreamFinal(curMil);

        currentMilestone++;

        claim(curMil + 1);
    }

    function _afterMilestoneStreamTermination(
        uint256 _milestoneId,
        uint256 streamedAmount,
        bool finalTermination
    ) internal {
        Milestone storage milestone = milestones[_milestoneId];
        // TODO: Handle overstream situations here, if it wasn't closed in time
        // TODO: Should probably transfer tokens using try/catch pattern with gas ensurance.
        // Even though the gas limit for a callback is large, something can still hapen in internal call to transfer
        // Consult with the 1 rule of App jailing
        // https://docs.superfluid.finance/superfluid/developers/developer-guides/super-apps/super-app#super-app-rules-jail-system
        milestone.streamOngoing = false;

        if (finalTermination) {
            uint256 tokenPortion = calculateTokenPortionForMilestone(
                _milestoneId
            );

            uint256 owedAmount = tokenPortion -
                milestone.paidAmount -
                streamedAmount;

            milestone.paidAmount = tokenPortion;
            milestone.paid = true;
            if (owedAmount > 0) {
                acceptedToken.transfer(creator, owedAmount);
            }
        } else {
            milestone.paidAmount = milestone.paidAmount + streamedAmount;
        }
    }

    function _getMaxUnlockedMilestone()
        internal
        view
        virtual
        returns (uint256)
    {
        // NOTE: Use internal storage for now, later can swap for governance implementation
        return maxUnlockedMilestone;
    }

    function _getCurrentMilestoneIndex()
        internal
        view
        virtual
        returns (uint256)
    {
        // NOTE: Use internal storage for now, later can swap for governance implementation
        return currentMilestone;
    }

    function _getNow() internal view virtual returns (uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }

    // //////////////////////////////////////////////////////////////
    // SUPER APP CALLBACKS
    // //////////////////////////////////////////////////////////////

    /// @dev Callback executed BEFORE a stream is TERMINATED.
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

        (uint256 timestamp, int96 flowRate, , ) = cfaV1Lib.cfa.getFlowByID(
            token,
            agreementId
        );

        return abi.encode(timestamp, flowRate);
    }

    /// @dev Callback executed AFTER a stream is TERMINATED. This MUST NOT revert.
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
    )
        external
        override(ISuperApp, SuperAppBase)
        validCallback(token)
        returns (bytes memory)
    {
        // MUST NOT revert. If agreement is not explicitly CFA, return context, DO NOT update state.
        // If this reverts, then no user can approve subscriptions.
        if (agreementClass != address(cfaV1Lib.cfa)) return ctx;

        (address sender, address receiver) = abi.decode(
            agreementData,
            (address, address)
        );

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

        (uint256 timestamp, int96 flowRate) = abi.decode(
            cbdata,
            (uint256, int96)
        );
        uint256 currentMilestoneIndex = _getCurrentMilestoneIndex();
        bool finalTermination = canTerminateMilestoneStreamFinal(
            currentMilestoneIndex
        );

        // TODO: handle overstream case in-between milestones
        // (if stream was not terminated in time)
        uint256 streamedAmount = (_getNow() - timestamp) *
            uint256(int256(flowRate));

        // At this point the stream itself was already terminated, just do some bookkeeping
        // NOTE: think about termination window edge cases here
        _afterMilestoneStreamTermination(
            currentMilestoneIndex,
            streamedAmount,
            finalTermination
        );

        // TODO: However, that does not provide a 100% guarantee that the stream will be terminated in time
        // we still need to handle that "overstream" case

        // By the Superfluid's rules, must return valid context, otherwise - app is jailed.
        return ctx;
    }

    // //////////////////////////////////////////////////////////////
    // GELATO AUTOMATION FOR TERMINATION
    // //////////////////////////////////////////////////////////////

    /// @dev This function is called by Gelato network to check if automated termination is needed.
    /// @return canExec : whether Gelato should execute the task.
    /// @return execPayload :  data that executors should use for the execution.
    function gelatoChecker()
        external
        view
        returns (bool canExec, bytes memory execPayload)
    {
        uint256 currentMilestoneIndex = _getCurrentMilestoneIndex();

        // Check if gelato can terminate stream of current milestone
        canExec = canGelatoTerminateMilestoneStreamFinal(currentMilestoneIndex);

        execPayload = abi.encodeWithSelector(
            this.gelatoTerminateMilestoneStreamFinal.selector,
            currentMilestoneIndex
        );
    }

    function startGelatoTask() public {
        // Register task to run it automatically
        gelatoOps.createTaskNoPrepayment(
            address(this),
            this.gelatoTerminateMilestoneStreamFinal.selector,
            address(this),
            abi.encodeWithSelector(this.gelatoChecker.selector),
            0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
        );
    }

    function gelatoTerminateMilestoneStreamFinal(uint256 _milestoneId)
        public
        onlyGelatoOps
        canGelatoTerminateMilestoneFinal(_milestoneId)
    {
        terminateMilestoneStreamFinal(_milestoneId);

        uint256 fee;
        address feeToken;

        (fee, feeToken) = gelatoOps.getFeeDetails();

        _gelatoTransfer(fee, feeToken);
    }

    // TODO: Ensure that this wouldn't clash with our logic
    // Introduce limits and checks to prevent gelato from taking too much
    function _gelatoTransfer(uint256 _amount, address _paymentToken) internal {
        if (_paymentToken == 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE) {
            // If ETH address
            (bool success, ) = gelato.call{value: _amount}("");
            if (!success) revert InvestmentPool__GelatoEthTransferFailed();
        } else {
            // Else it is ERC20 token
            SafeERC20.safeTransfer(IERC20(_paymentToken), gelato, _amount);
        }
    }

    function _calculatePortion(uint256 _amountTotal, uint256 _portion)
        internal
        returns (uint256)
    {
        return (_amountTotal * _portion) / PERCENTAGE_DIVIDER;
    }

    // NOTE: We don't need that?
    function _payoutMissedInvestmentCompensations(uint256 _milestoneId)
        internal
    {
        // Represents the amount of funds that are owed for this milestone
        // Including latest investments
        // Will be used to calculate the amount of compensation to pay the creator
        // For the "missed" funds
        Milestone storage milestone = milestones[_milestoneId];

        uint256 totalMilestonePortion = milestone.intervalSeedPortion +
            milestone.intervalStreamingPortion;

        uint256 totalMilestoneFunds = _calculatePortion(
            totalInvestedAmount,
            totalMilestonePortion
        );

        uint256 owedAmount = totalMilestoneFunds - milestone.paidAmount;

        milestone.paidAmount = totalMilestoneFunds;

        if (owedAmount > 0) {
            acceptedToken.transfer(creator, owedAmount);
        }
    }

    // NOTE: potentially expensive, verify
    function _getRealTimeInvestIndex(uint256 timestamp)
        internal
        view
        returns (uint)
    {
        for (uint i = 0; i < milestoneCount; i++) {
            if (
                milestones[i].startDate <= timestamp &&
                milestones[i].endDate > timestamp
            ) {
                return i + 1;
            }
        }

        if (milestones[0].startDate > timestamp) {
            return 0;
            // Not Started yet, fundraiser
        } else {
            // Ended
            return milestoneCount;
        }
    }

    // NOTE: Milestone id here is the milestone you are investing "FOR".
    // Meaning, for initial fundraiser with the goal to achieve soft cap
    // the index would be 0, and returned coefficient shall be 100% (PERCENTAGE_DIVIDER)
    function _investToMilestone(
        address _investor,
        uint256 _milestoneId,
        uint256 amount
    ) internal {
        uint256 investmentCoefficient = memMilestonePortions[_milestoneId];

        if (memMilestoneInvestments[_milestoneId] == 0 && _milestoneId > 0) {
            memMilestoneInvestments[_milestoneId] += memMilestoneInvestments[
                _milestoneId - 1
            ];
        }

        uint256 scaledInvestment = (amount * PERCENTAGE_DIVIDER) /
            investmentCoefficient;

        memMilestoneInvestments[_milestoneId] += scaledInvestment;

        investedAmount[_investor][_milestoneId] += amount;

        totalInvestedAmount += amount;
    }

    function getMilestoneSeedAmount(uint256 _milestoneId)
        public
        view
        returns (uint256)
    {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];

        return
            (memInvAmount * milestones[_milestoneId].intervalSeedPortion) /
            PERCENTAGE_DIVIDER;
    }

    function getMilestoneStreamAmount(uint256 _milestoneId)
        public
        view
        returns (uint256)
    {
        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];

        return
            (memInvAmount * milestones[_milestoneId].intervalStreamingPortion) /
            PERCENTAGE_DIVIDER;
    }

    function getTotalMilestoneTokenAllocation(uint _milestoneId)
        public
        view
        returns (uint256)
    {
        uint totalPercentage = milestones[_milestoneId].intervalSeedPortion +
            milestones[_milestoneId].intervalStreamingPortion;

        uint256 memInvAmount = memMilestoneInvestments[_milestoneId];

        uint256 subt = memInvAmount * totalPercentage;

        return subt / PERCENTAGE_DIVIDER;
    }

    function _getEarlyTerminationProjectLeftPortion(
        uint256 _terminationMilestoneId
    ) internal view returns (uint256) {
        // Creator always has rights to get the seed amount for the termination milestone,
        // even after termination
        // this is to prevent project kills by whale investors
        // this way - investor will still be at loss for seed amount for next milestone

        uint256 tokensReserved;

        if (milestones[_terminationMilestoneId].paidAmount > 0) {
            tokensReserved = milestones[_terminationMilestoneId].paidAmount;
        } else {
            tokensReserved = getMilestoneSeedAmount(_terminationMilestoneId);
        }

        // TODO: perhaps linearize the logic?
        return
            memMilestonePortions[_terminationMilestoneId] -
            ((tokensReserved * PERCENTAGE_DIVIDER) /
                getTotalMilestoneTokenAllocation(_terminationMilestoneId));
    }

    function _getUnburnedAmountForInvestment(
        uint256 _investmentAmount,
        uint256 _actualProjectLeft,
        uint _investmentCoef
    ) internal pure returns (uint256) {
        return (_investmentAmount * _actualProjectLeft) / _investmentCoef;
    }
}
