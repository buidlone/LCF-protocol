// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";

import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {VotingToken} from "./VotingToken.sol";

error GovernancePool__StatusIsNotUnavailable();
error GovernancePool__StatusIsNotActiveVoting();
error GovernancePool__StatusIsNotVotedAgainst();
error GovernancePool__NotInvestmentPoolFactory();
error GovernancePool__AmountIsZero();
error GovernancePool__NoActiveVotingTokensOwned();
error GovernancePool__AmountIsGreaterThanVotingTokensBalance(uint256 amount, uint256 balance);
error GovernancePool__NoVotesAgainstProject();
error GovernancePool__AmountIsGreaterThanDelegatedVotes(uint256 amount, uint256 votes);
error GovernancePool__TotalSupplyIsZero();
error GovernancePool__TotalSupplyIsSmallerThanVotesAgainst(uint256 totalSupply, uint256 votes);
error GovernancePool__ThresholdNumberIsGreaterThan100();
error GovernancePool__InvestmentPoolStateNotAllowed();

/// @title Governance Pool contract.
contract GovernancePool is ERC1155Holder, Context, IGovernancePool {
    using Arrays for uint256[];

    // ERC1155 contract where all voting tokens are stored
    VotingToken public immutable VOTING_TOKEN;
    address public immutable INVESTMENT_POOL_FACTORY_ADDRESS;
    uint8 public immutable VOTES_PERCENTAGE_THRESHOLD;
    uint256 public immutable VOTES_WITHDRAW_FEE; // number out of 100%; E.g. 1 or 13

    /// @notice mapping from investment pool id => status
    mapping(uint256 => InvestmentPoolStatus) public investmentPoolStatus;
    /// @notice mapping from investor address => investment pool id => votes amount against the project
    mapping(address => mapping(uint256 => uint256)) public votesAmount;
    /// @notice mapping from investment pool id => total votes amount against the project
    mapping(uint256 => uint256) public totalVotesAmount;

    /// @notice mapping from investor address => investment pool id => milestone id => amount of voting tokens, investor started to own
    mapping(address => mapping(uint256 => mapping(uint256 => uint256))) public activeTokens;
    /// @notice mapping from investor address => investment pool id => list of milestones in which voting tokens amount increaced
    mapping(address => mapping(uint256 => uint256[])) public milestonesIdsInWhichInvestorInvested;

    event ActivateVoting(address indexed investmentPool);
    event VoteAgainstProject(
        address indexed investmentPool,
        address indexed investor,
        uint256 amount
    );
    event RetractVotes(address indexed investmentPool, address indexed investor, uint256 amount);
    event FinishVoting(address indexed investmentPool);

    /** @notice Create new governance pool contract.
     *  @dev Is called by DEPLOYER.
     *  @param _votingToken address of ERC1155 token, which will be used for voting.
     *  @param _investmentPoolFactory address of investment pool factory, which will deploy all investment pools.
     *  @param _threshold number as percentage for votes threshold. Max value is 100.
     *  @dev Reverts if _threshold is greater than 100 (%).
     */
    constructor(
        VotingToken _votingToken,
        address _investmentPoolFactory,
        uint8 _threshold,
        uint256 _votestWithdrawFee
    ) {
        if (_threshold > 100) revert GovernancePool__ThresholdNumberIsGreaterThan100();
        VOTING_TOKEN = _votingToken;
        INVESTMENT_POOL_FACTORY_ADDRESS = _investmentPoolFactory;
        VOTES_PERCENTAGE_THRESHOLD = _threshold;
        VOTES_WITHDRAW_FEE = _votestWithdrawFee;
    }

    modifier onUnavailableInvestmentPool(address _investmentPool) {
        if (!isInvestmentPoolUnavailable(_investmentPool)) {
            revert GovernancePool__StatusIsNotUnavailable();
        }
        _;
    }

    modifier onActiveInvestmentPool(address _investmentPool) {
        if (!isInvestmentPoolVotingActive(_investmentPool))
            revert GovernancePool__StatusIsNotActiveVoting();
        _;
    }

    modifier onlyInvestmentPoolFactory() {
        if (_msgSender() != INVESTMENT_POOL_FACTORY_ADDRESS)
            revert GovernancePool__NotInvestmentPoolFactory();
        _;
    }

    /** @notice Activate voting process for given investment pool. It will only be called once for every investment pool at the creation stage stage.
     *  @dev Is called by INVESTMENT POOL FACTORY.
     *  @dev Emits ActiveVoting event with investment pool address.
     *  @param _investmentPool investment pool address, which will be added to the active IPs mapping.
     *  @dev Reverts if sender ir not investment pool factory, if status is not unavailable.
     */
    function activateInvestmentPool(address _investmentPool)
        external
        onlyInvestmentPoolFactory
        onUnavailableInvestmentPool(_investmentPool)
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);

        investmentPoolStatus[investmentPoolId] = InvestmentPoolStatus.ActiveVoting;
        emit ActivateVoting(_investmentPool);
    }

    /** @notice Mint new tokens for specified investment pool. Tokens are held by governance pool contract until unlock time is reached.
     *  @dev Is called by INVESTMENT POOL.
     *  @dev Reverts if status is not active voting, amount to mint is zero.
     *  @dev Voting Token contract emits TransferSingle event.
     *  @param _milestoneId id of milestone in which the newly minted voting tokens will become active
     *  @param _investor account address for which voting tokens will be minted.
     *  @param _amount tokens amount to mint.
     */
    function mintVotingTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _amount
    ) external onActiveInvestmentPool(_msgSender()) {
        if (_amount == 0) revert GovernancePool__AmountIsZero();

        uint256 investmentPoolId = getInvestmentPoolId(_msgSender());
        uint256[] memory milestonesIds = milestonesIdsInWhichInvestorInvested[_investor][
            investmentPoolId
        ];

        if (milestonesIds.length == 0) {
            activeTokens[_investor][investmentPoolId][_milestoneId] = _amount;
            milestonesIdsInWhichInvestorInvested[_investor][investmentPoolId].push(_milestoneId);
        } else {
            uint256 milestoneIdOfLastIncrease = milestonesIds[milestonesIds.length - 1];
            activeTokens[_investor][investmentPoolId][_milestoneId] =
                activeTokens[_investor][investmentPoolId][milestoneIdOfLastIncrease] +
                _amount;

            if (milestoneIdOfLastIncrease != _milestoneId) {
                milestonesIdsInWhichInvestorInvested[_investor][investmentPoolId].push(
                    _milestoneId
                );
            }
        }

        // Tokens will never be minted for the milestones that already passed because this is called only by IP in invest function
        VOTING_TOKEN.mint(_investor, investmentPoolId, _amount, "");
    }

    /** @notice Vote against the project by transfering investor vote tokens to the governance pool contract.
     *  @notice Before calling this function investor needs to approve spender with 'votingToken.setApprovalForAll(governancePoolAddress, true)'.
     *  @dev Is called by INVESTOR.
     *  @dev Reverts if status is not active voting, if amount is zero, if investor doesn't own any tokens, if amount is greater than token balance.
     *  @dev Emits VoteAgainstProject with investment pool address, sender, amount. If threshold reached emit FinishVoting with investment pool address.Voting Token contract emits TransferSingle event.
     *  @param _investmentPool investment pool address, to which investor transfers tokens by voting against it.
     *  @param _amount tokens amount investor wants to vote with.
     */
    function voteAgainst(address _investmentPool, uint256 _amount)
        external
        onActiveInvestmentPool(_investmentPool)
    {
        if (_amount == 0) revert GovernancePool__AmountIsZero();
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        IInvestmentPool investmentPool = IInvestmentPool(_investmentPool);
        uint256 currentMilestoneId = investmentPool.getCurrentMilestoneId();
        bool anyMilestoneOngoing = investmentPool.isAnyMilestoneOngoingAndActive();
        if (!anyMilestoneOngoing) {
            revert GovernancePool__InvestmentPoolStateNotAllowed();
        }

        uint256 investorActiveVotingTokensBalance = getActiveVotingTokensBalance(
            _investmentPool,
            currentMilestoneId,
            _msgSender()
        );
        uint256 votesLeft = investorActiveVotingTokensBalance -
            votesAmount[_msgSender()][investmentPoolId];

        if (votesLeft == 0) revert GovernancePool__NoActiveVotingTokensOwned();
        if (_amount > votesLeft)
            revert GovernancePool__AmountIsGreaterThanVotingTokensBalance(_amount, votesLeft);

        // Check if new votes amount specified by investor will reach 51%
        bool thresholdWillBeReached = willInvestorReachThreshold(_investmentPool, _amount);

        // Update votes mappings
        votesAmount[_msgSender()][investmentPoolId] += _amount;
        totalVotesAmount[investmentPoolId] += _amount;

        // Transfer the voting tokens from investor to the governance pool
        VOTING_TOKEN.safeTransferFrom(_msgSender(), address(this), investmentPoolId, _amount, "");

        emit VoteAgainstProject(_investmentPool, _msgSender(), _amount);

        // If threshold is reached, it means that project needs to be ended
        if (thresholdWillBeReached) {
            _endProject(_investmentPool);
        }
    }

    /** @notice Retract votes (voting tokens) from the governance pool if voting is still active.
     *  @dev Is called by INVESTOR.
     *  @dev Reverts if amount is zero, if investor has 0 votes against project, if given amount is greater than delegated votes.
     *  @dev Emits RetractVotes event with investment pool address, sender, amount. Voting Token contract emits TransferSingle event.
     *  @param _investmentPool investment pool address, from which to retract votes.
     *  @param _retractAmount tokens amount investor wants retract from delegated votes.
     */
    function retractVotes(address _investmentPool, uint256 _retractAmount)
        external
        onActiveInvestmentPool(_investmentPool)
    {
        if (_retractAmount == 0) revert GovernancePool__AmountIsZero();
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 investorVotesAmount = votesAmount[_msgSender()][investmentPoolId];

        if (investorVotesAmount == 0) revert GovernancePool__NoVotesAgainstProject();
        if (_retractAmount > investorVotesAmount)
            revert GovernancePool__AmountIsGreaterThanDelegatedVotes(
                _retractAmount,
                investorVotesAmount
            );

        // Update votes mappings
        votesAmount[_msgSender()][investmentPoolId] = investorVotesAmount - _retractAmount;
        totalVotesAmount[investmentPoolId] -= _retractAmount;

        // Apply fee for votes withdrawal
        uint256 amountToTransfer = (_retractAmount * (100 - VOTES_WITHDRAW_FEE)) / 100;

        VOTING_TOKEN.safeTransferFrom(
            address(this),
            _msgSender(),
            investmentPoolId,
            amountToTransfer,
            ""
        );

        emit RetractVotes(_investmentPool, _msgSender(), _retractAmount);
    }

    /** @notice Calculate the votes against to the total tokens supply percentage
     *  @param _investmentPool investment pool address
     *  @param _votesAgainst amount of tokens, which will be used to calculate its percentage.
     *  @return uint8 -> the percentage without any decimal places (e.g. 10; 62; 97)
     */
    function votesAgainstPercentageCount(address _investmentPool, uint256 _votesAgainst)
        public
        view
        returns (uint8)
    {
        uint256 totalSupply = getVotingTokensSupply(_investmentPool);

        if (totalSupply == 0) revert GovernancePool__TotalSupplyIsZero();
        if (totalSupply < _votesAgainst)
            revert GovernancePool__TotalSupplyIsSmallerThanVotesAgainst(
                totalSupply,
                _votesAgainst
            );

        uint8 percentage = uint8((_votesAgainst * 100) / totalSupply);
        return percentage;
    }

    /** @notice Check if investor votes amount will reach the threshold needed for terminating the project
     *  @param _investmentPool investment pool address
     *  @param _investorVotesCount amount of tokens investor votes with.
     *  @return bool -> if threshold will be reached or not
     */
    function willInvestorReachThreshold(address _investmentPool, uint256 _investorVotesCount)
        public
        view
        returns (bool)
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);

        uint256 votesCountAgainst = totalVotesAmount[investmentPoolId];

        // Calculate new percentage with investors votes
        uint256 newCountVotesAgainst = votesCountAgainst + _investorVotesCount;
        uint8 newPercentageAgainst = votesAgainstPercentageCount(
            _investmentPool,
            newCountVotesAgainst
        );

        // Check if investors money will reach threshold percent or more
        // Percentages is going to be rounded down. That means no matter how high decimals are, they will be ignored.
        if (newPercentageAgainst >= VOTES_PERCENTAGE_THRESHOLD) {
            return true;
        } else {
            return false;
        }
    }

    function isInvestmentPoolUnavailable(address _investmentPool) public view returns (bool) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        return investmentPoolStatus[investmentPoolId] == InvestmentPoolStatus.Unavailable;
    }

    function isInvestmentPoolVotingActive(address _investmentPool) public view returns (bool) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        return investmentPoolStatus[investmentPoolId] == InvestmentPoolStatus.ActiveVoting;
    }

    /** @notice Get balance of active voting tokens for specified milestone.
     *  @notice The balance is retrieve by checking if in milestone id investor invested.
     *  @notice If amount is zero that means investment was not made in given milestone.
     *  @notice That's why it finds the nearest milestone that is smaller than given one
     *  @notice and returns its balance or if no investments were made at all - zero.
     *  @param _investmentPool investment pool address
     *  @param _milestoneId milestone id in which tokens should be active
     *  @param _account address of the account to check
     *  @return uint256 -> balance of tokens owned in milestone
     */
    function getActiveVotingTokensBalance(
        address _investmentPool,
        uint256 _milestoneId,
        address _account
    ) public view returns (uint256) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256[] memory milestonesIds = milestonesIdsInWhichInvestorInvested[_account][
            investmentPoolId
        ];

        if (milestonesIds.length == 0) {
            // If milestonesIds array is empty that means that no investments were made
            // and no voting tokens were minted. Return zero.assert
            return 0;
        } else if (
            _milestoneId == 0 || activeTokens[_account][investmentPoolId][_milestoneId] != 0
        ) {
            // Return the value that mapping holds.
            // If milestone is zero, no matter the active tokens amount (it can be 0 or more),
            // it is the correct one, as no investments were made before it.
            // If active tokens amount is not zero, that means investor invested in that milestone,
            // that is why we can get the value immediately, without any additional step.
            return activeTokens[_account][investmentPoolId][_milestoneId];
        } else if (activeTokens[_account][investmentPoolId][_milestoneId] == 0) {
            // If active tokens amount is zero, that means investment was MADE before it
            // or was NOT MADE at all. It also means that investment definitely was not made in the current milestone.

            // array.findUpperBound(element) searches a sorted array and returns the first index that contains a value greater or equal to element.
            // If no such index exists (i.e. all values in the array are strictly less than element), the array length is returned.
            // Because in previous condition we checked if investments were made to the milestone id,
            // we can be sure that findUpperBound function will return the value greater than element of length of the array,
            // but not the value that is equal.
            /// @dev not using milestonesIds variable because findUpperBound works only with storage variables.
            uint256 nearestMilestoneIdFromTop = milestonesIdsInWhichInvestorInvested[_account][
                investmentPoolId
            ].findUpperBound(_milestoneId);

            if (nearestMilestoneIdFromTop == milestonesIds.length) {
                // If length of an array was returned, it means
                // no milestone id in the array is greater than the current one.
                // Get the last value on milestonesIds array, because all the milestones after it
                // have the same active tokens amount.
                uint256 lastMilestoneIdWithInvestment = milestonesIds[milestonesIds.length - 1];
                return activeTokens[_account][investmentPoolId][lastMilestoneIdWithInvestment];
            } else if (nearestMilestoneIdFromTop == 0 && _milestoneId < milestonesIds[0]) {
                // If the index of milestone that was found is zero AND
                // current milestone is LESS than milestone retrieved from milestonesIds
                // it means no investments were made before the current milestone.
                // Thus, no voting tokens were minted at all.
                // This condition can be met when looking for tokens amount in past milestones
                return 0;
            } else if (milestonesIds.length > 1 && nearestMilestoneIdFromTop != 0) {
                // If more than 1 investment was made, nearestMilestoneIdFromTop will return
                // the index that is higher by 1 array element. That is we need to subtract 1, to get the right index
                // When we have the right index, we can return the active tokens amount
                // This condition can be met when looking for tokens amount in past milestones
                uint256 milestoneIdWithInvestment = milestonesIds[nearestMilestoneIdFromTop - 1];
                return activeTokens[_account][investmentPoolId][milestoneIdWithInvestment];
            }
        }

        // At this point all of the cases should be handled and value should already be returns
        // This part of code should never be reached, but for unknown cases we will return zero.
        return 0;
    }

    /** @notice Get tokens supply for investment pool token
     *  @param _investmentPool investment pool address
     *  @return uint256 -> total supply of tokens minted
     */
    function getVotingTokensSupply(address _investmentPool) public view returns (uint256) {
        return VOTING_TOKEN.totalSupply(getInvestmentPoolId(_investmentPool));
    }

    /** @notice Get balance of voting tokens for specified investor
     *  @param _investmentPool investment pool address
     *  @param _account address of the account to check
     *  @return uint256 -> balance of tokens owned
     */
    function getVotingTokenBalance(address _investmentPool, address _account)
        public
        view
        returns (uint256)
    {
        return VOTING_TOKEN.balanceOf(_account, getInvestmentPoolId(_investmentPool));
    }

    /** @notice Get id value for ERC1155 voting token from it's address
     *  @param _investmentPool investment pool address
     * @return uint256 -> investment pool id
     */
    function getInvestmentPoolId(address _investmentPool) public pure returns (uint256) {
        return uint256(uint160(_investmentPool));
    }

    /** INTERNAL FUNCTIONS */

    /**
     * @notice If project reaches threshold, this function sends request to the investment pool for terminating project
     * @param _investmentPool Address of the pool, which needs to be terminated
     */
    function _endProject(address _investmentPool) internal {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        investmentPoolStatus[investmentPoolId] = InvestmentPoolStatus.VotedAgainst;

        // Call investment pool function to end the project as voters decided to terminate the stream
        IInvestmentPool(_investmentPool).cancelDuringMilestones();

        emit FinishVoting(_investmentPool);
    }

    function _getNow() internal view virtual returns (uint256) {
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }
}
