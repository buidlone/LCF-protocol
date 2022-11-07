// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IGovernancePool {
    function activateInvestmentPool(address _investmentPool) external;

    function mintVotingTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _amount
    ) external;

    function voteAgainst(address _investmentPool, uint256 _amount) external;

    function retractVotes(address _investmentPool, uint256 _retractAmount) external;

    function burnVotes(
        uint256 _milestoneId,
        address _investor,
        uint256 _burnAmount
    ) external;

    function doesInvestmentPoolExist(uint256 _investmentPoolId) external view returns (bool);

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

    function willInvestorReachThreshold(address _investmentPool, uint256 _investorVotesCount)
        external
        view
        returns (bool);

    function getActiveVotingTokensBalance(
        address _investmentPool,
        uint256 _milestoneId,
        address _account
    ) external view returns (uint256);

    function getVotingTokenAddress() external view returns (address);

    function getInvestmentPoolFactoryAddress() external view returns (address);

    function getVotesPercentageThreshold() external view returns (uint8);

    function getVotesWithdrawPercentageFee() external view returns (uint256);

    function getVotesAmount(address _investor, uint256 _investmentPoolId)
        external
        view
        returns (uint256);

    function getTotalVotesAmount(uint256 _investmentPoolId) external view returns (uint256);

    function getMilestonesIdsInWhichInvestorInvested(address _investor, uint256 _investmentPoolId)
        external
        view
        returns (uint256[] memory);
}
