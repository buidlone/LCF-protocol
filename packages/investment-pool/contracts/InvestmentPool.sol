// @ DPATRON 2022
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

import {IInitializableInvestmentPool} from "./interfaces/IInvestmentPool.sol";
import {IGelatoOps} from "./interfaces/IGelatoOps.sol";

import "hardhat/console.sol";

contract InvestmentPool is
    IInitializableInvestmentPool,
    SuperAppBase,
    Context,
    Initializable
{
    event Cancel();
    event Invest(address indexed caller, uint256 amount);
    event Unpledge(address indexed caller, uint256 amount);
    event Claim(uint256 milestoneId);
    event Refund(address indexed caller, uint256 amount);

    bytes32 public constant CFA_ID =
        keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");

    using CFAv1Library for CFAv1Library.InitData;
    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    // Contains addresses of superfluid's host and ConstanFlowAgreement
    CFAv1Library.InitData public cfaV1Lib;

    // Contains the address of accepted investment token
    ISuperToken public acceptedToken;

    address public creator;

    address public gelatoOps;

    // TODO: validate that uint96 for soft cap is enough
    uint96 public softCap;

    uint48 public fundraiserStartAt;

    uint48 public fundraiserEndAt;

    uint48 public totalStreamingDuration;

    uint48 public votingPeriod;

    uint48 public terminationWindow;

    uint48 public automatedTerminationWindow;

    bool public canceled;

    // Investment data
    uint256 public totalInvestedAmount;
    // Mapping from pledger => amount invested
    mapping(address => uint256) public investedAmount;

    // Milestone data
    // Total amount of milestones in this investment pool
    uint256 public milestoneCount;
    // TODO: Look into, maybe an array would be better, since we have a fixed amount?
    mapping(uint256 => Milestone) public milestones;
    uint256 public currentMilestone;
    uint256 public maxUnlockedMilestone;

    // //////////////////////////////////////////////////////////////
    // Superfluid ERRORS for callbacks
    // //////////////////////////////////////////////////////////////

    /// @dev Thrown when the wrong token is streamed to the contract.
    error InvalidToken();

    /// @dev Thrown when the `msg.sender` of the app callbacks is not the Superfluid host.
    error Unauthorized();

    /// @dev Checks every callback to validate inputs. MUST be called by the host.
    /// @param token The Super Token streamed in. MUST be the in-token.
    modifier validCallback(ISuperToken token) {
        if (token != acceptedToken) revert InvalidToken();

        // NOTE: Checking msg.sender here instead of _msgSender()
        // because it's supposed to be called by the Superfluid host only
        if (msg.sender != address(cfaV1Lib.host)) revert Unauthorized();
        _;
    }

    modifier isNotCanceled() {
        require(!canceled, "[IP]: campaign canceled");
        _;
    }

    /** @notice Confirms that the investor's current investment is greater or equal to amount
        @param _investor Address of the investor to check
        @param _amount Amount of funds to check for
     */
    modifier hasInvestedSufficientAmount(address _investor, uint256 _amount) {
        require(
            investedAmount[_investor] >= _amount,
            "[IP]: amount > invested"
        );
        _;
    }

    /** @notice Confirms that the fundraiser has reached a soft cap
     */
    modifier softCapReached() {
        require(isSoftCapReached(), "[IP]: total investment < softCap");
        _;
    }

    /** @notice Ensures that the fundraiser is not started yet
     */
    modifier fundraiserNotStartedYet() {
        require(
            _getNow() < fundraiserStartAt,
            "[IP]: campaign started already"
        );
        _;
    }

    /** @notice Ensures that the fundraiser period for a given campaign is ongoing
     */
    modifier fundraiserOngoingNow() {
        require(isFundraiserOngoingNow(), "[IP]: not in fundraiser period");
        _;
    }

    /** @notice Ensures that the fundraiser has failed and investors are eligible for refunds
     */
    modifier failedFundraiser() {
        require(isFailedFundraiser(), "[IP]: is not a failed campaign");
        _;
    }

    /** @notice Ensures that the message sender is the fundraiser creator
     */
    modifier onlyCreator() {
        require(creator == _msgSender(), "[IP]: not creator");
        _;
    }

    modifier milestoneUnlocked(uint256 index) {
        require(
            index <= _getMaxUnlockedMilestone(),
            "[IP]: milestone still locked"
        );
        _;
    }

    modifier milestoneNotPaid(uint index) {
        require(!milestones[index].paid, "[IP]: milestone paid already");
        _;
    }

    modifier canTerminateMilestoneFinal(uint index) {
        require(
            canTerminateMilestoneStreamFinal(index),
            "[IP]: cannot terminate stream for this milestone"
        );
        _;
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
            milestone.endDate + votingPeriod - terminationWindow <= _getNow();
    }

    function canAutomatedStreamTerminationBePerformed(uint256 _milestoneId)
        public
        view
        returns (bool)
    {
        Milestone storage milestone = milestones[_milestoneId];

        return
            milestone.streamOngoing &&
            milestone.endDate + votingPeriod - automatedTerminationWindow <=
            _getNow();
    }

    function initialize(
        ISuperfluid _host,
        ISuperToken _acceptedToken,
        address _creator,
        address _gelatoOps,
        uint96 _softCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        uint48 _votingPeriod,
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
        softCap = _softCap;
        fundraiserStartAt = _fundraiserStartAt;
        fundraiserEndAt = _fundraiserEndAt;
        votingPeriod = _votingPeriod;
        terminationWindow = _terminationWindow;
        automatedTerminationWindow = _automatedTerminationWindow;
        milestoneCount = _milestones.length;
        currentMilestone = 0;

        MilestoneInterval memory interval;
        for (uint32 i = 0; i < _milestones.length; ++i) {
            interval = _milestones[i];
            milestones[i] = Milestone({
                startDate: interval.startDate,
                endDate: interval.endDate,
                paid: false,
                streamOngoing: false,
                paidAmount: 0
            });

            totalStreamingDuration =
                totalStreamingDuration +
                (_milestones[i].endDate - _milestones[i].startDate);
        }

        // Register gelato's automation task
        startGelatoTask();
    }

    /** @notice Allows to invest a specified amount of funds
        @dev Prior approval from _msgSender() to this contract is required
        @param _amount Amount of tokens to invest, must be <= approved amount
     */
    function invest(uint256 _amount)
        external
        fundraiserOngoingNow
        isNotCanceled
    {
        totalInvestedAmount += _amount;
        investedAmount[_msgSender()] += _amount;
        acceptedToken.transferFrom(_msgSender(), address(this), _amount);

        emit Invest(_msgSender(), _amount);
    }

    /** @notice Allows investors to change their mind during the fundraiser period and get their funds back. All at once, or just a specified portion
        @param _amount Amount of funds to withdraw.
     */
    function unpledge(uint256 _amount)
        external
        fundraiserOngoingNow
        hasInvestedSufficientAmount(_msgSender(), _amount)
    {
        totalInvestedAmount -= _amount;
        investedAmount[_msgSender()] -= _amount;
        acceptedToken.transfer(_msgSender(), _amount);

        emit Unpledge(_msgSender(), _amount);
    }

    /** @notice Allows investors to withdraw all locked funds for a failed campaign(if the soft cap has not been raised by the fundraiser end date)
     */
    function refund()
        external
        failedFundraiser // TODO: Possible that after milestone voting is added, this needs to be changed
    // to account for milestone rejection
    {
        uint256 bal = investedAmount[_msgSender()];
        require(bal > 0, "[IP]: no money invested");

        investedAmount[_msgSender()] = 0;
        acceptedToken.transfer(_msgSender(), bal);

        emit Refund(_msgSender(), bal);
    }

    /** @notice Allows the pool creator to start streaming/receive funds for a certain milestone
        @param _milestoneId Milestone index to claim funds for
     */
    function claim(uint256 _milestoneId)
        external
        onlyCreator
        milestoneUnlocked(_milestoneId)
        milestoneNotPaid(_milestoneId)
        isNotCanceled
    {
        Milestone storage milestone = milestones[_milestoneId];
        uint256 tokenPortion = calculateTokenPortionForMilestone(_milestoneId);
        uint256 owedAmount = tokenPortion - milestone.paidAmount;

        // NOTE: we'll need to account for termination window here
        // in order to not create very high rate and short lived streams
        // that are difficult to terminate in time
        // NOTE: Any special cases for the last milestone? Cause it probably has no voting period
        if (milestone.endDate + votingPeriod - terminationWindow <= _getNow()) {
            // Milestone has passed, we should pay immediately
            milestone.paid = true;
            milestone.paidAmount = tokenPortion;
            acceptedToken.transfer(creator, owedAmount);
        } else {
            require(
                !milestone.streamOngoing,
                "[IP]: already streaming for this milestone"
            );
            // Milestone is still ongoing, calculate the flowrate and stream
            uint leftStreamDuration = milestone.endDate +
                votingPeriod -
                _getNow();

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

    /** @notice Stops fundraiser campaign
     */
    function cancel()
        external
        onlyCreator
        isNotCanceled
        fundraiserNotStartedYet
    {
        canceled = true;
        emit Cancel();
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
        canExec = canAutomatedStreamTerminationBePerformed(
            currentMilestoneIndex
        );

        execPayload = abi.encodeWithSelector(
            this.terminateMilestoneStreamFinal.selector,
            currentMilestoneIndex
        );
    }

    function startGelatoTask() public {
        // Register task to run it automatically
        IGelatoOps(gelatoOps).createTask(
            address(this),
            this.terminateMilestoneStreamFinal.selector,
            address(this),
            abi.encodeWithSelector(this.gelatoChecker.selector)
        );
    }
}
