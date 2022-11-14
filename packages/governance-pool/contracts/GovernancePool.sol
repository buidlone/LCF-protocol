// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";

import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {VotingToken} from "./VotingToken.sol";

error GovernancePool__InvestmentPoolAlreadyExists();
error GovernancePool__InvestmentPoolDoesNotExist();
error GovernancePool__NotInvestmentPoolFactory();
error GovernancePool__AmountIsZero();
error GovernancePool__NoActiveVotingTokensOwned();
error GovernancePool__AmountIsGreaterThanVotingTokensBalance(uint256 amount, uint256 balance);
error GovernancePool__NoVotesAgainstProject();
error GovernancePool__AmountIsGreaterThanDelegatedVotes(uint256 amount, uint256 votes);
error GovernancePool__TotalSupplyIsZero();
error GovernancePool__TotalSupplyIsSmallerThanVotesAgainst(uint256 totalSupply, uint256 votes);
error GovernancePool__ThresholdNumberIsGreaterThan100();
error GovernancePool__InvestmentPoolStateNotAllowed(uint256 stateValue);
error GovernancePool__BurnAmountIsLargerThanBalance();
error GovernancePool__CannotTransferMoreThanUnlockedTokens();

/// @title Governance Pool contract.
contract GovernancePool is ERC1155Holder, Context, IGovernancePool {
    using Arrays for uint256[];

    // ERC1155 contract where all voting tokens are stored
    VotingToken internal immutable VOTING_TOKEN;
    address internal immutable INVESTMENT_POOL_FACTORY_ADDRESS;
    uint8 internal immutable VOTES_PERCENTAGE_THRESHOLD;
    uint256 internal immutable VOTES_WITHDRAW_FEE; // number out of 100%; E.g. 1 or 13
    // TODO: investment pool also hold the values of state. Only in one contract value should be hardcode and others should get from it.
    // This will prevent for later bugs when changing state values
    uint256 internal constant FUNDRAISER_ONGOING_STATE_VALUE = 4;
    uint256 internal constant MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE = 32;
    uint256 internal constant LAST_MILESTONE_ONGOING_STATE_VALUE = 64;
    uint256 internal ANY_MILESTONE_ONGOING_STATE_VALUE;

    /// @notice mapping from investment pool id => is initialized
    mapping(uint256 => bool) internal investmentPoolExists;
    /// @notice mapping from investor address => investment pool id => votes amount against the project
    mapping(address => mapping(uint256 => uint256)) internal votesAmount;
    /// @notice mapping from investment pool id => total votes amount against the project
    mapping(uint256 => uint256) internal totalVotesAmount;
    /// @notice mapping from investor address => investment pool id => locked amount
    mapping(address => mapping(uint256 => uint256)) internal lockedAmount;
    /// @notice mapping from investment pool id => total locked amount
    mapping(uint256 => uint256) internal totalLockedAmount;

    /**
     * @notice It's a memoization mapping from investor address => investment pool id => milestone id => amount of voting tokens
     * @dev It returns 0 if no investments were made in that milestone and number > 0 if investment was made.
     * @dev Number represents the active voting tokens amount, which can be used to vote against the project
     * @dev It doesn't hold real money value, but a value, which will be used in other formulas.
     * @dev Memoization will never be used on it's own, to get voting tokens balance.
     */
    mapping(address => mapping(uint256 => mapping(uint256 => uint256))) internal memActiveTokens;
    /**
     * @notice mapping from investor address => investment pool id => list of milestones in which voting tokens amount increaced
     * @dev Array returns all milestones, in which at least 1 investment was made by investor.
     */
    mapping(address => mapping(uint256 => uint256[]))
        internal milestonesIdsInWhichInvestorInvested;

    event ActivateInvestmentPool(address indexed investmentPool);
    event MintVotingTokens(
        address indexed investmentPool,
        address indexed investor,
        uint256 indexed milestoneId,
        uint256 amount
    );
    event VoteAgainstProject(
        address indexed investmentPool,
        address indexed investor,
        uint256 amount
    );
    event FinishVoting(address indexed investmentPool);
    event RetractVotes(address indexed investmentPool, address indexed investor, uint256 amount);
    event BurnVotes(address indexed investmentPool, address indexed investor, uint256 amount);
    event TransferVotes(
        address indexed investmentPool,
        address indexed sender,
        address indexed recipient,
        uint256 amount
    );
    event LockVotingTokens(
        address indexed investmentPool,
        address indexed investor,
        uint256 amount
    );

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

        ANY_MILESTONE_ONGOING_STATE_VALUE =
            getMilestonesOngoingBeforeLastStateValue() |
            getLastMilestoneOngoingStateValue();
    }

    /// @notice Ensures that provided current project state is one of the provided. It uses bitwise operations in condition
    modifier allowedInvestmentPoolStates(address _investmentPool, uint256 _states) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        if (!doesInvestmentPoolExist(investmentPoolId))
            revert GovernancePool__InvestmentPoolDoesNotExist();

        IInvestmentPool investmentPool = IInvestmentPool(_investmentPool);
        uint256 currentInvestmentPoolState = investmentPool.getProjectStateByteValue();
        if (_states & currentInvestmentPoolState == 0)
            revert GovernancePool__InvestmentPoolStateNotAllowed(currentInvestmentPoolState);
        _;
    }

    modifier investmentPoolDoesNotExist(address _investmentPool) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        if (doesInvestmentPoolExist(investmentPoolId)) {
            revert GovernancePool__InvestmentPoolAlreadyExists();
        }
        _;
    }

    modifier onlyInvestmentPoolFactory() {
        if (_msgSender() != getInvestmentPoolFactoryAddress())
            revert GovernancePool__NotInvestmentPoolFactory();
        _;
    }

    /// @notice Ensures that given amount is not zero
    modifier notZeroAmount(uint256 _amount) {
        if (_amount == 0) revert GovernancePool__AmountIsZero();
        _;
    }

    /** EXTERNAL FUNCTIONS */

    /** @notice Activate voting process for given investment pool. It will only be called once for every investment pool at the creation stage stage.
     *  @dev Is called by INVESTMENT POOL FACTORY.
     *  @dev Emits ActiveVoting event with investment pool address.
     *  @param _investmentPool investment pool address, which will be added to the active IPs mapping.
     *  @dev Reverts if sender ir not investment pool factory, if status is not unavailable.
     */
    function activateInvestmentPool(address _investmentPool)
        external
        onlyInvestmentPoolFactory
        investmentPoolDoesNotExist(_investmentPool)
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        investmentPoolExists[investmentPoolId] = true;

        emit ActivateInvestmentPool(_investmentPool);
    }

    /** @notice Mint new tokens for specified investment pool. Tokens are minted for investor, but they are not active from the begining
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
    )
        external
        notZeroAmount(_amount)
        allowedInvestmentPoolStates(
            _msgSender(),
            getFundraiserOngoingStateValue() | getMilestonesOngoingBeforeLastStateValue()
        )
    {
        uint256 investmentPoolId = getInvestmentPoolId(_msgSender());

        // Get all milestones in which investor invested. This array allows us to know when the voting tokens balance increased.
        uint256[] memory milestonesIds = getMilestonesIdsInWhichInvestorInvested(
            _investor,
            investmentPoolId
        );

        if (milestonesIds.length == 0) {
            // If array is zero, it means no investments exist and therefore investor doesn't own any voting tokens from past.
            memActiveTokens[_investor][investmentPoolId][_milestoneId] = _amount;
            milestonesIdsInWhichInvestorInvested[_investor][investmentPoolId].push(_milestoneId);
        } else {
            // If array is not zero, it means investor has made investments before.
            // Now we should add the voting tokens amount from previous investments and add the current amount.
            // This allows us to know the specific amount that investor started owning from the provided milestone start.
            if (memActiveTokens[_investor][investmentPoolId][_milestoneId] == 0) {
                // If it's first investment for this milestone, add milestone id to the array.
                milestonesIdsInWhichInvestorInvested[_investor][investmentPoolId].push(
                    _milestoneId
                );
            }

            memActiveTokens[_investor][investmentPoolId][_milestoneId] =
                getActiveVotingTokensBalance(_msgSender(), _milestoneId, _investor) +
                _amount;
        }
        // Tokens will never be minted for the milestones that already passed because this is called only by IP in invest function
        VOTING_TOKEN.mint(_investor, investmentPoolId, _amount, "");

        // msg.sender is investment pool
        emit MintVotingTokens(_msgSender(), _investor, _milestoneId, _amount);
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
        notZeroAmount(_amount)
        allowedInvestmentPoolStates(_investmentPool, getAnyMilestoneOngoingStateValue())
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);

        // Get amount of votes investor owns. Remove the votes that were used for voting already.
        uint256 votesLeft = getUnusedVotesAmount(_investmentPool);

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
        notZeroAmount(_retractAmount)
        allowedInvestmentPoolStates(_investmentPool, getAnyMilestoneOngoingStateValue())
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 investorVotesAmount = getVotesAmount(_msgSender(), investmentPoolId);

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
        uint256 amountToTransfer = (_retractAmount * (100 - getVotesWithdrawPercentageFee())) /
            100;

        VOTING_TOKEN.safeTransferFrom(
            address(this),
            _msgSender(),
            investmentPoolId,
            amountToTransfer,
            ""
        );

        emit RetractVotes(_investmentPool, _msgSender(), _retractAmount);
    }

    /** @notice Burn voting tokens, when user unpledges the investment. Prior voting token approval is needed.
     *  @dev Is called by INVESTMENT POOL.
     *  @dev Reverts if function is called not by investment pool, if burn amount is zero, if burn amount is larger than balance.
     *  @param _investor investors, who wants to unpledge and burn votes.
     *  @param _milestoneId milestone, in which investor invested previously.
     *  @param _burnAmount amount to burn.
     */
    function burnVotes(
        uint256 _milestoneId,
        address _investor,
        uint256 _burnAmount
    )
        external
        notZeroAmount(_burnAmount)
        allowedInvestmentPoolStates(
            _msgSender(),
            getFundraiserOngoingStateValue() | getAnyMilestoneOngoingStateValue()
        )
    {
        uint256 investmentPoolId = getInvestmentPoolId(_msgSender());
        uint256 tokensBalance = memActiveTokens[_investor][investmentPoolId][_milestoneId];

        if (_burnAmount > tokensBalance) revert GovernancePool__BurnAmountIsLargerThanBalance();

        if (_burnAmount == tokensBalance) {
            // We can pop the last milestone if investor wants to burn all of the milestone tokens
            // Unpledge function can only be executed with current milestone that is why we know that current milestone is the last item
            milestonesIdsInWhichInvestorInvested[_investor][investmentPoolId].pop();
        }

        memActiveTokens[_investor][investmentPoolId][_milestoneId] -= _burnAmount;
        VOTING_TOKEN.burn(_investor, investmentPoolId, _burnAmount);

        emit BurnVotes(_msgSender(), _investor, _burnAmount);
    }

    /** @notice transfer voting tokens (tokens can be locked too) with the ownership to it
     *  @param _investmentPool investment pool of token
     *  @param _recipient transfer recipients
     *  @param _amount to transfer from sender to recipient
     */
    function transferVotes(
        address _investmentPool,
        address _recipient,
        uint256 _amount
    ) external allowedInvestmentPoolStates(_investmentPool, getAnyMilestoneOngoingStateValue()) {
        if (_amount == 0) revert GovernancePool__AmountIsZero();
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 currentMilestoneId = IInvestmentPool(_investmentPool).getCurrentMilestoneId();
        uint256 votesLeft = getUnusedVotesAmount(_investmentPool);

        if (_amount > votesLeft) revert GovernancePool__CannotTransferMoreThanUnlockedTokens();

        uint256 senderActiveVotingTokensBalance = getActiveVotingTokensBalance(
            _investmentPool,
            currentMilestoneId,
            _msgSender()
        );
        uint256 recipientActiveVotingTokensBalance = getActiveVotingTokensBalance(
            _investmentPool,
            currentMilestoneId,
            _recipient
        );

        if (memActiveTokens[_msgSender()][investmentPoolId][currentMilestoneId] == 0) {
            milestonesIdsInWhichInvestorInvested[_msgSender()][investmentPoolId].push(
                currentMilestoneId
            );
        }

        if (memActiveTokens[_recipient][investmentPoolId][currentMilestoneId] == 0) {
            milestonesIdsInWhichInvestorInvested[_recipient][investmentPoolId].push(
                currentMilestoneId
            );
        }

        memActiveTokens[_msgSender()][investmentPoolId][currentMilestoneId] =
            senderActiveVotingTokensBalance -
            _amount;
        memActiveTokens[_recipient][investmentPoolId][currentMilestoneId] =
            recipientActiveVotingTokensBalance +
            _amount;

        VOTING_TOKEN.safeTransferFrom(_msgSender(), _recipient, investmentPoolId, _amount, "");

        emit TransferVotes(_investmentPool, _msgSender(), _recipient, _amount);
    }

    function permanentlyLockVotes(address _investmentPool, uint256 _votes)
        external
        notZeroAmount(_votes)
        allowedInvestmentPoolStates(_investmentPool, getAnyMilestoneOngoingStateValue())
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 currentMilestoneId = IInvestmentPool(_investmentPool).getCurrentMilestoneId();
        uint256 votesLeft = getUnusedVotesAmount(_investmentPool);

        if (_votes > votesLeft) revert GovernancePool__CannotTransferMoreThanUnlockedTokens();

        uint256 senderActiveVotingTokensBalance = getActiveVotingTokensBalance(
            _investmentPool,
            currentMilestoneId,
            _msgSender()
        );

        if (memActiveTokens[_msgSender()][investmentPoolId][currentMilestoneId] == 0) {
            milestonesIdsInWhichInvestorInvested[_msgSender()][investmentPoolId].push(
                currentMilestoneId
            );
        }

        memActiveTokens[_msgSender()][investmentPoolId][currentMilestoneId] =
            senderActiveVotingTokensBalance -
            _votes;
        lockedAmount[_msgSender()][investmentPoolId] += _votes;
        totalLockedAmount[investmentPoolId] += _votes;

        VOTING_TOKEN.safeTransferFrom(_msgSender(), address(this), investmentPoolId, _votes, "");

        emit LockVotingTokens(_investmentPool, _msgSender(), _votes);
    }

    /** PUBLIC FUNCTIONS */

    /** @notice function returns the amount, which is the max voting tokens he can still use for voting against the project.
     *  @param _investmentPool address of the investment pool, for which we want to get the token balance
     *  @return votes that are sill unused
     */
    function getUnusedVotesAmount(address _investmentPool) public view returns (uint256) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 currentMilestoneId = IInvestmentPool(_investmentPool).getCurrentMilestoneId();

        // Get the voting tokens that are active and can be used for voting
        uint256 activeVotingTokensBalance = getActiveVotingTokensBalance(
            _investmentPool,
            currentMilestoneId,
            _msgSender()
        );
        uint256 usedVotes = getVotesAmount(_msgSender(), investmentPoolId);

        // Get amount of votes investor hasn't used yet. Remove the votes that were used for voting already.
        uint256 votesLeft = activeVotingTokensBalance - usedVotes;
        return votesLeft;
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

        uint256 votesCountAgainst = getTotalVotesAmount(investmentPoolId);

        // Calculate new percentage with investors votes
        uint256 newCountVotesAgainst = votesCountAgainst + _investorVotesCount;
        uint8 newPercentageAgainst = votesAgainstPercentageCount(
            _investmentPool,
            newCountVotesAgainst
        );

        // Check if investors money will reach threshold percent or more
        // Percentages is going to be rounded down. That means no matter how high decimals are, they will be ignored.
        if (newPercentageAgainst >= getVotesPercentageThreshold()) {
            return true;
        } else {
            return false;
        }
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
        uint256[] memory milestonesIds = getMilestonesIdsInWhichInvestorInvested(
            _account,
            investmentPoolId
        );

        if (milestonesIds.length == 0) {
            // If milestonesIds array is empty that means that no investments were made
            // and no voting tokens were minted. Return zero.
            return 0;
        } else if (
            _milestoneId == 0 || memActiveTokens[_account][investmentPoolId][_milestoneId] != 0
        ) {
            // Return the value that mapping holds.
            // If milestone is zero, no matter the active tokens amount (it can be 0 or more),
            // it is the correct one, as no investments were made before it.
            // If active tokens amount is not zero, that means investor invested in that milestone,
            // that is why we can get the value immediately, without any additional step.
            return memActiveTokens[_account][investmentPoolId][_milestoneId];
        } else if (memActiveTokens[_account][investmentPoolId][_milestoneId] == 0) {
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
                return memActiveTokens[_account][investmentPoolId][lastMilestoneIdWithInvestment];
            } else if (
                nearestMilestoneIdFromTop == 0 &&
                _milestoneId < milestonesIds[nearestMilestoneIdFromTop]
            ) {
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
                return memActiveTokens[_account][investmentPoolId][milestoneIdWithInvestment];
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

    /** GETTERS */

    function getVotingTokenAddress() public view returns (address) {
        return address(VOTING_TOKEN);
    }

    function getInvestmentPoolFactoryAddress() public view returns (address) {
        return INVESTMENT_POOL_FACTORY_ADDRESS;
    }

    function getVotesPercentageThreshold() public view returns (uint8) {
        return VOTES_PERCENTAGE_THRESHOLD;
    }

    function getVotesWithdrawPercentageFee() public view returns (uint256) {
        return VOTES_WITHDRAW_FEE;
    }

    function getFundraiserOngoingStateValue() public pure returns (uint256) {
        return FUNDRAISER_ONGOING_STATE_VALUE;
    }

    function getMilestonesOngoingBeforeLastStateValue() public pure returns (uint256) {
        return MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE;
    }

    function getLastMilestoneOngoingStateValue() public pure returns (uint256) {
        return LAST_MILESTONE_ONGOING_STATE_VALUE;
    }

    function getAnyMilestoneOngoingStateValue() public view returns (uint256) {
        return ANY_MILESTONE_ONGOING_STATE_VALUE;
    }

    function doesInvestmentPoolExist(uint256 _investmentPoolId) public view returns (bool) {
        return investmentPoolExists[_investmentPoolId];
    }

    function getVotesAmount(address _investor, uint256 _investmentPoolId)
        public
        view
        returns (uint256)
    {
        return votesAmount[_investor][_investmentPoolId];
    }

    function getTotalVotesAmount(uint256 _investmentPoolId) public view returns (uint256) {
        return totalVotesAmount[_investmentPoolId];
    }

    function getLockedAmount(address _investor, uint256 _investmentPoolId)
        public
        view
        returns (uint256)
    {
        return lockedAmount[_investor][_investmentPoolId];
    }

    function getTotalLockedAmount(uint256 _investmentPoolId) public view returns (uint256) {
        return totalLockedAmount[_investmentPoolId];
    }

    function getMilestonesIdsInWhichInvestorInvested(address _investor, uint256 _investmentPoolId)
        public
        view
        returns (uint256[] memory)
    {
        return milestonesIdsInWhichInvestorInvested[_investor][_investmentPoolId];
    }

    /** INTERNAL FUNCTIONS */

    /**
     * @notice If project reaches threshold, this function sends request to the investment pool for terminating project
     * @param _investmentPool Address of the pool, which needs to be terminated
     */
    function _endProject(address _investmentPool) internal {
        // Call investment pool function to end the project as voters decided to terminate the stream
        IInvestmentPool(_investmentPool).cancelDuringMilestones();

        emit FinishVoting(_investmentPool);
    }

    function _getNow() internal view virtual returns (uint256) {
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }
}
