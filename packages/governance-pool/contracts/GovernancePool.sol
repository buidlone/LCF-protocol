// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import "./VotingToken.sol";
import {IGovernancePool} from "./interfaces/IGovernancePool.sol";

contract GovernancePool is ERC1155Holder, Context, IGovernancePool {
    event FinishVoting(address investmentPool);
    event ActivateVoting(address investmentPool);
    event VoteAgainstProject(address investmentPool, address investor, uint256 amount);
    event RetractVotes(address investmentPool, address investor, uint256 amount);

    // ERC1155 contract where all voting tokens are stored
    VotingToken public immutable VOTING_TOKEN;
    address public immutable INVESTMENT_POOL_FACTORY_ADDRESS;

    // TODO: check if uint8 is a good choice here
    uint8 public constant VOTES_PERCENTAGE_TRESHOLD = 51;

    // mapping from investment pool id => status
    mapping(uint256 => InvestmentPoolStatus) public investmentPoolStatus;
    // mapping from investor address => investment pool address => voting tokens asmount
    mapping(address => mapping(uint256 => uint256)) public votesAmount;

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

    /** @notice Function transfers investor votes tokens to the smart contract
        @param _investmentPool investment pool address
        @param _amount tokens amount investor wants to vote with
        @dev Before calling this function investor needs to approve spender with setApprovalForAll()
     */
    function voteAgainst(address _investmentPool, uint256 _amount) external {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        uint256 investorVotingTokenBalance = getVotingTokenBalance(_investmentPool, _msgSender());

        require(_amount > 0, "[GP]: amount needs to be greater than 0");
        require(investorVotingTokenBalance > 0, "[GP]: don't have any voting tokens");
        require(
            _amount <= investorVotingTokenBalance,
            "[GP]: amount can't be greater than voting tokens balance"
        );
        votesAmount[_msgSender()][investmentPoolId] += _amount;
        bool tresholdWillBeReached = willInvestorReachTreshold(_investmentPool, _amount);

        // Transfer the voting tokens from investor to the governance pool
        VOTING_TOKEN.safeTransferFrom(_msgSender(), address(this), investmentPoolId, _amount, "");

        emit VoteAgainstProject(_investmentPool, _msgSender(), _amount);

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
            "[GP]: retract amount can't be greater than voting token balance"
        );

        votesAmount[_msgSender()][investmentPoolId] = investorVotesAmount - _retractAmount;

        VOTING_TOKEN.safeTransferFrom(
            address(this),
            _msgSender(),
            investmentPoolId,
            _retractAmount,
            ""
        );

        emit RetractVotes(_investmentPool, _msgSender(), _retractAmount);
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

    /** @notice Get id value for ERC1155 voting token from it's address
        @param _investmentPool investment pool address
        @return investment pool id
     */
    function getInvestmentPoolId(address _investmentPool) public pure returns (uint256) {
        return uint256(uint160(_investmentPool));
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
        uint256 votesCountAgainst = getVotingTokenBalance(_investmentPool, address(this));

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

    /** @notice Mint new tokens for specified investment pool. Is called by investment pool contract
        @param _investor account address for which voting tokens will be minted
        @param _amount tokens amount to mint
     */
    function mintVotingTokens(address _investor, uint256 _amount)
        public
        onActiveInvestmentPool(_msgSender())
    {
        uint256 investmentPoolId = getInvestmentPoolId(_msgSender());
        VOTING_TOKEN.mint(_investor, investmentPoolId, _amount, "");
    }

    function _endProject(address _investmentPool) private {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        investmentPoolStatus[investmentPoolId] = InvestmentPoolStatus.VotedAgainst;
        // TODO: call investment pool function to end the project as voters decided to terminate the stream

        emit FinishVoting(_investmentPool);
    }
}
