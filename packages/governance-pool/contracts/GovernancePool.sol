// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {VotingToken} from "./VotingToken.sol";

error GovernancePool__statusIsNotUnavailable();
error GovernancePool__statusIsNotActiveVoting();
error GovernancePool__statusIsNotVotedAgainst();
error GovernancePool__notInvestmentPoolFactory();
error GovernancePool__noIvestmentsMade();
error GovernancePool__amountIsZero();
error GovernancePool__noVotingTokensOwned();
error GovernancePool__amountIsGreaterThanVotingTokensBalance(uint256 amount, uint256 balance);
error GovernancePool__noVotesAgainstProject();
error GovernancePool__amountIsGreaterThanDelegatedVotes(uint256 amount, uint256 votes);
error GovernancePool__totalSupplyIsZero();
error GovernancePool__totalSupplyIsSmallerThanVotesAgainst(uint256 totalSupply, uint256 votes);
error GovernancePool__noVotingTokensAvailableForClaim();
error GovernancePool__thresholdNumberIsGreaterThan100();
error GovernancePool__maxInvestmentsCountReached();

/// @title Governance Pool contract.
contract GovernancePool is ERC1155Holder, Context, IGovernancePool {
    uint32 public constant MAX_INVESTMENTS_FOR_INVESTOR_PER_POOL = 10;

    // ERC1155 contract where all voting tokens are stored
    VotingToken public immutable VOTING_TOKEN;
    address public immutable INVESTMENT_POOL_FACTORY_ADDRESS;
    uint8 public immutable VOTES_PERCENTAGE_THRESHOLD;

    /// @notice mapping from investment pool id => status
    mapping(uint256 => InvestmentPoolStatus) public investmentPoolStatus;
    /// @notice mapping from investor address => investment pool id => voting tokens asmount
    mapping(address => mapping(uint256 => uint256)) public votesAmount;
    /// @notice mapping from investor address => investment pool id => list of structs with unlock time and amount
    mapping(address => mapping(uint256 => TokensLocked[])) public tokensLocked;
    /// @notice mapping from investment pool id => total votes amount
    mapping(uint256 => uint256) public totalVotesAmount; // total contract balance is not only votes it holds but investors tokens which will be unlocked in the future

    event ActivateVoting(address indexed investmentPool);
    event UnlockVotingTokens(
        address indexed investmentPool,
        address indexed investor,
        uint8 indexed listId,
        uint256 amount
    );
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
        uint8 _threshold
    ) {
        if (_threshold > 100) revert GovernancePool__thresholdNumberIsGreaterThan100();
        VOTING_TOKEN = _votingToken;
        INVESTMENT_POOL_FACTORY_ADDRESS = _investmentPoolFactory;
        VOTES_PERCENTAGE_THRESHOLD = _threshold;
    }

    modifier onUnavailableInvestmentPool(address _investmentPool) {
        if (!isInvestmentPoolUnavailable(_investmentPool)) {
            revert GovernancePool__statusIsNotUnavailable();
        }
        _;
    }

    modifier onActiveInvestmentPool(address _investmentPool) {
        if (!isInvestmentPoolVotingActive(_investmentPool))
            revert GovernancePool__statusIsNotActiveVoting();
        _;
    }

    modifier onlyInvestmentPoolFactory() {
        if (_msgSender() != INVESTMENT_POOL_FACTORY_ADDRESS)
            revert GovernancePool__notInvestmentPoolFactory();
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
     *  @param _investor account address for which voting tokens will be minted.
     *  @param _amount tokens amount to mint.
     *  @param _unlockTime time until newly minted tokens will be locked in governance pool. No checks for time are applied. It can be in the past, which means tokens are unlock instantly.
     */
    function mintVotingTokens(
        address _investor,
        uint256 _amount,
        uint48 _unlockTime
    ) external onActiveInvestmentPool(_msgSender()) {
        /// @dev Unlock time can be in the past, which means tokens are unlocked instantly.

        if (_amount == 0) revert GovernancePool__amountIsZero();
        uint256 investmentPoolId = getInvestmentPoolId(_msgSender());

        if (
            tokensLocked[_investor][investmentPoolId].length >=
            MAX_INVESTMENTS_FOR_INVESTOR_PER_POOL
        ) revert GovernancePool__maxInvestmentsCountReached();

        // Push new locked tokens info to mapping and mint them. Tokens will be held by governance pool until unlock time.
        tokensLocked[_investor][investmentPoolId].push(TokensLocked(_unlockTime, _amount, false));
        VOTING_TOKEN.mint(address(this), investmentPoolId, _amount, "");
    }

    /** @notice Transfer voting tokens if lock period ended.
     *  @dev Is called by INVESTOR.
     *  @dev Reverts if status is not active voting, if investor has zero investments, if all tokens are still locked.
     *  @dev Emits UnlockVotingTokens event with investment pool address, sender, id, amount. Voting Token contract emits TransferSingle event.
     *  @param _investmentPool investment pool address. Investor tries to unlock tokens for this investment pool.
     */
    function unlockVotingTokens(address _investmentPool)
        external
        onActiveInvestmentPool(_investmentPool)
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        TokensLocked[] memory lockedTokens = tokensLocked[_msgSender()][investmentPoolId];
        uint8 investmentsCount = uint8(lockedTokens.length);

        if (investmentsCount == 0) revert GovernancePool__noIvestmentsMade();
        uint256 owedTokens = 0;

        for (uint8 i = 0; i < investmentsCount; i++) {
            TokensLocked memory votingTokens = lockedTokens[i];

            // Transfer only tokens that haven't been claimed and unlock time was reached

            if (!votingTokens.claimed && votingTokens.unlockTime <= uint48(_getNow())) {
                tokensLocked[_msgSender()][investmentPoolId][i].claimed = true;

                uint256 amount = votingTokens.amount;
                owedTokens += amount;
                emit UnlockVotingTokens(_investmentPool, _msgSender(), i, amount);
            }
        }

        if (owedTokens > 0) {
            // Transfer the voting tokens from the governance pool to investor
            VOTING_TOKEN.safeTransferFrom(
                address(this),
                _msgSender(),
                investmentPoolId,
                owedTokens,
                ""
            );
        } else {
            revert GovernancePool__noVotingTokensAvailableForClaim();
        }
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
        if (_amount == 0) revert GovernancePool__amountIsZero();
        uint256 investorVotingTokenBalance = getVotingTokenBalance(_investmentPool, _msgSender());

        if (investorVotingTokenBalance == 0) revert GovernancePool__noVotingTokensOwned();
        if (_amount > investorVotingTokenBalance)
            revert GovernancePool__amountIsGreaterThanVotingTokensBalance(
                _amount,
                investorVotingTokenBalance
            );

        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);

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
        if (_retractAmount == 0) revert GovernancePool__amountIsZero();
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 investorVotesAmount = votesAmount[_msgSender()][investmentPoolId];

        if (investorVotesAmount == 0) revert GovernancePool__noVotesAgainstProject();
        if (_retractAmount > investorVotesAmount)
            revert GovernancePool__amountIsGreaterThanDelegatedVotes(
                _retractAmount,
                investorVotesAmount
            );

        // Update votes mappings
        votesAmount[_msgSender()][investmentPoolId] = investorVotesAmount - _retractAmount;
        totalVotesAmount[investmentPoolId] -= _retractAmount;

        VOTING_TOKEN.safeTransferFrom(
            address(this),
            _msgSender(),
            investmentPoolId,
            _retractAmount,
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

        if (totalSupply == 0) revert GovernancePool__totalSupplyIsZero();
        if (totalSupply < _votesAgainst)
            revert GovernancePool__totalSupplyIsSmallerThanVotesAgainst(
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

    /**
     * @notice If project reaches threshold, this function sends request to the investment pool for terminating project
     * @param _investmentPool Address of the pool, which needs to be terminated
     */
    function _endProject(address _investmentPool) private {
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
