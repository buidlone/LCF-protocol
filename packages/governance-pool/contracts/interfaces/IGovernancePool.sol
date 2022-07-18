// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IGovernancePool {
    enum InvestmentPoolStatus {
        Unavailable,
        ActiveVoting,
        VotedAgainst
    }

    function activateInvestmentPool(address _investmentPool) external;

    function voteAgainst(address _investmentPool, uint256 _amount) external;

    function retractVotes(address _investmentPool, uint256 _retractAmount) external;

    function isInvestmentPoolUnavailable(address _investmentPool) external view returns (bool);

    function isInvestmentPoolVotingActive(address _investmentPool) external view returns (bool);

    function isInvestmentPoolVotingFinished(address _investmentPool) external view returns (bool);

    function getInvestmentPoolId(address _investmentPool) external pure returns (uint256);

    function getVotingTokensSupply(address _investmentPool) external view returns (uint256);

    function getVotingTokenBalance(address _investmentPool, address _account)
        external
        view
        returns (uint256);

    function votesAgainstPercentageCount(address _investmentPool, uint256 _votesAgainst)
        external
        view
        returns (uint8);

    function willInvestorReachTreshold(address _investmentPool, uint256 _investorVotesCount)
        external
        view
        returns (bool);

    function mintVotingTokens(address _investor, uint256 _amount) external;
}
