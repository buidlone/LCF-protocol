// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import "./VotingToken.sol";
import {IGovernancePool} from "./interfaces/IGovernancePool.sol";

contract GovernancePool is ERC1155Holder, Context, IGovernancePool {
    // ERC1155 contract where all voting tokens are stored
    VotingToken public immutable VOTING_TOKEN;
    address public immutable INVESTMENT_POOL_FACTORY_ADDRESS;
    uint8 public constant VOTES_PERCENTAGE_TRESHOLD = 51;
    // TODO should be passed by investment pool factory?
    uint8 public constant MAX_INVESTMENTS_FOR_INVESTOR_PER_POOL = 10;

    // mapping from investment pool id => status
    mapping(uint256 => InvestmentPoolStatus) public investmentPoolStatus;
    // mapping from investor address => investment pool id => voting tokens asmount
    mapping(address => mapping(uint256 => uint256)) public votesAmount;
    // mapping from investor address => investment pool id => list of structs with unlock time and amount
    mapping(address => mapping(uint256 => TokensLocked[])) public tokensLocked;
    // mapping from investment pool id => total votes amount
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

    constructor(VotingToken _votingToken, address _investmentPoolFactory) {
        VOTING_TOKEN = _votingToken;
        INVESTMENT_POOL_FACTORY_ADDRESS = _investmentPoolFactory;
    }

    modifier onUnavailableInvestmentPool(address _investmentPool) {
        require(
            isInvestmentPoolUnavailable(_investmentPool),
            "[GP]: investment pool is assigned with another status than unavailable"
        );
        _;
    }

    modifier onActiveInvestmentPool(address _investmentPool) {
        require(
            isInvestmentPoolVotingActive(_investmentPool),
            "[GP]: investment pool is assigned with another status than active voting"
        );
        _;
    }

    modifier onVotedAgainstInvestmentPool(address _investmentPool) {
        require(
            isInvestmentPoolVotingFinished(_investmentPool),
            "[GP]: investment pool is assigned with another status than voted against"
        );
        _;
    }

    modifier onlyInvestmentPoolFactory() {
        require(
            _msgSender() == INVESTMENT_POOL_FACTORY_ADDRESS,
            "[GP]: not an investment pool factory"
        );
        _;
    }

    /** @notice Function will only be called once for every investment pool
                at the contructor stage from the IP factory. 
        @param _investmentPool investment pool address, which will be added to the active IPs mapping
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

    /** @notice Mint new tokens for specified investment pool. Is called by investment pool contract
        @param _investor account address for which voting tokens will be minted
        @param _amount tokens amount to mint
     */
    function mintVotingTokens(
        address _investor,
        uint256 _amount,
        uint256 _unlockTime
    ) external onActiveInvestmentPool(_msgSender()) {
        uint256 investmentPoolId = getInvestmentPoolId(_msgSender());

        // Push new locked tokens info to mapping and mint them. Tokens will be held by governance pool until unlock time.
        tokensLocked[_investor][investmentPoolId].push(TokensLocked(_unlockTime, _amount, false));
        VOTING_TOKEN.mint(address(this), investmentPoolId, _amount, "");
    }

    /** @notice Transfer voting tokens if lock period ended
        @param _investmentPool investment pool address, which will be added to the active IPs mapping
     */
    function unlockVotingTokens(address _investmentPool)
        external
        onActiveInvestmentPool(_investmentPool)
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        TokensLocked[] memory lockedTokens = tokensLocked[_msgSender()][investmentPoolId];

        // Check how many investments did investor make into specified project
        uint8 investmentsCount = uint8(lockedTokens.length);
        require(investmentsCount > 0, "[GP]: haven't invested in this project");

        for (uint8 i = 0; i < investmentsCount; i++) {
            TokensLocked memory votingTokens = lockedTokens[i];

            // Transfer only tokens that haven't been claimed and unlock time was reached
            if (!votingTokens.claimed && votingTokens.unlockTime <= block.timestamp) {
                uint256 amount = votingTokens.amount;

                tokensLocked[_msgSender()][investmentPoolId][i].claimed = true;

                // Transfer the voting tokens from the governance pool to investor
                VOTING_TOKEN.safeTransferFrom(
                    address(this),
                    _msgSender(),
                    investmentPoolId,
                    amount,
                    ""
                );

                emit UnlockVotingTokens(_investmentPool, _msgSender(), i, amount);
            }
        }
    }

    /** @notice Function transfers investor votes tokens to the smart contract
        @param _investmentPool investment pool address
        @param _amount tokens amount investor wants to vote with
        @dev Before calling this function investor needs to approve spender with setApprovalForAll()
     */
    function voteAgainst(address _investmentPool, uint256 _amount)
        external
        onActiveInvestmentPool(_investmentPool)
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 investorVotingTokenBalance = getVotingTokenBalance(_investmentPool, _msgSender());

        require(_amount > 0, "[GP]: amount needs to be greater than 0");
        require(investorVotingTokenBalance > 0, "[GP]: don't have any voting tokens");
        require(
            _amount <= investorVotingTokenBalance,
            "[GP]: amount can't be greater than voting tokens balance"
        );

        // Check if new votes amount specified by investor will reach 51%
        bool tresholdWillBeReached = willInvestorReachTreshold(_investmentPool, _amount);

        // Update votes mappings
        votesAmount[_msgSender()][investmentPoolId] += _amount;
        totalVotesAmount[investmentPoolId] += _amount;

        // Transfer the voting tokens from investor to the governance pool
        VOTING_TOKEN.safeTransferFrom(_msgSender(), address(this), investmentPoolId, _amount, "");

        emit VoteAgainstProject(_investmentPool, _msgSender(), _amount);

        // If treshold is reached, it means that project needs to be ended
        if (tresholdWillBeReached) {
            _endProject(_investmentPool);
        }
    }

    /** @notice Investors can retract votes tokens from the smart contract if voting is still active
        @param _investmentPool investment pool address
        @param _retractAmount tokens amount investor wants retract from votes
     */
    function retractVotes(address _investmentPool, uint256 _retractAmount)
        external
        onActiveInvestmentPool(_investmentPool)
    {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 investorVotesAmount = votesAmount[_msgSender()][investmentPoolId];

        require(_retractAmount > 0, "[GP]: retract amount neeeds to be greater than 0");
        require(investorVotesAmount > 0, "[GP]: did't vote against the project");
        require(
            _retractAmount <= investorVotesAmount,
            "[GP]: retract amount can't be greater than delegated for voting"
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
        @param _investmentPool investment pool address
        @param _votesAgainst amount of token which will be used to calculate its percentage.
        @return the percentage without any decimal places (e.g. 10; 62; 97)
     */
    function votesAgainstPercentageCount(address _investmentPool, uint256 _votesAgainst)
        public
        view
        returns (uint8)
    {
        uint256 totalSupply = getVotingTokensSupply(_investmentPool);

        require(totalSupply > 0, "[GP]: total tokens supply is zero");
        require(
            totalSupply >= _votesAgainst,
            "[GP]: total supply of tokens needs to be higher than votes against"
        );

        uint8 percentage = uint8((_votesAgainst * 100) / totalSupply);
        return percentage;
    }

    /** @notice Check if investor votes amount will reach the treshold needed for terminating the project
        @param _investmentPool investment pool address
        @param _investorVotesCount amount of tokens investor will send to the governance pool
        @return if treshold will be reached or not
     */
    function willInvestorReachTreshold(address _investmentPool, uint256 _investorVotesCount)
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

        // Check if investors money will reach treshold percent or more
        if (newPercentageAgainst >= VOTES_PERCENTAGE_TRESHOLD) {
            return true;
        } else {
            return false;
        }
    }

    function isInvestmentPoolUnavailable(address _investmentPool) public view returns (bool) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        return
            investmentPoolStatus[investmentPoolId] == InvestmentPoolStatus.Unavailable
                ? true
                : false;
    }

    function isInvestmentPoolVotingActive(address _investmentPool) public view returns (bool) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        return
            investmentPoolStatus[investmentPoolId] == InvestmentPoolStatus.ActiveVoting
                ? true
                : false;
    }

    function isInvestmentPoolVotingFinished(address _investmentPool) public view returns (bool) {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        return
            investmentPoolStatus[investmentPoolId] == InvestmentPoolStatus.VotedAgainst
                ? true
                : false;
    }

    /** @notice Get tokens supply for investment pool token
        @param _investmentPool investment pool address
        @return total supply of tokens minted
     */
    function getVotingTokensSupply(address _investmentPool) public view returns (uint256) {
        return VOTING_TOKEN.totalSupply(getInvestmentPoolId(_investmentPool));
    }

    /** @notice Get balance of voting tokens for specified investor
        @param _investmentPool investment pool address
        @param _account address of the account to check
        @return balance of tokens owned
     */
    function getVotingTokenBalance(address _investmentPool, address _account)
        public
        view
        returns (uint256)
    {
        return VOTING_TOKEN.balanceOf(_account, getInvestmentPoolId(_investmentPool));
    }

    /** @notice Get id value for ERC1155 voting token from it's address
        @param _investmentPool investment pool address
        @return investment pool id
     */
    function getInvestmentPoolId(address _investmentPool) public pure returns (uint256) {
        return uint256(uint160(_investmentPool));
    }

    function _endProject(address _investmentPool) private {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        investmentPoolStatus[investmentPoolId] = InvestmentPoolStatus.VotedAgainst;
        // TODO: call investment pool function to end the project as voters decided to terminate the stream

        emit FinishVoting(_investmentPool);
    }
}
