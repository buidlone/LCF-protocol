// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {IInvestmentPool} from "../interfaces/IInvestmentPool.sol";
import {IInitializableGovernancePool} from "../interfaces/IGovernancePool.sol";

contract GovernancePoolMockForIntegration is IInitializableGovernancePool {
    function cancelDuringMilestones(address _investment) external {
        IInvestmentPool(_investment).cancelDuringMilestones();
    }

    function initialize(
        address _votingToken,
        IInvestmentPool _investmentPool,
        uint8 _threshold,
        uint256 _votestWithdrawFee
    ) external payable {}

    function mintVotingTokens(uint256 _milestoneId, address _investor, uint256 _amount) external {}

    function voteAgainst(uint256 _amount) external {}

    function retractVotes(uint256 _retractAmount) external {}

    function burnVotes(uint256 _milestoneId, address _investor) external {}

    function transferVotes(address _recipient, uint256 _amount) external {}

    function permanentlyLockVotes(uint256 _votes) external {}

    function getUnusedVotesAmount() external view returns (uint256) {}

    function votesAgainstPercentageCount(uint256 _votesAgainst) external view returns (uint8) {}

    function willInvestorReachThreshold(
        uint256 _investorVotesCount
    ) external view returns (bool) {}

    function getActiveVotingTokensBalance(
        uint256 _milestoneId,
        address _account
    ) external view returns (uint256) {}

    function getVotingTokensSupply() external view returns (uint256) {}

    function getVotingTokenBalance(address _account) external view returns (uint256) {}

    function getInvestmentPoolId() external view returns (uint256) {}

    function getVotingTokenAddress() external view returns (address) {}

    function getVotesPercentageThreshold() external view returns (uint8) {}

    function getVotesWithdrawPercentageFee() external view returns (uint256) {}

    function getFundraiserOngoingStateValue() external pure returns (uint256) {}

    function getMilestonesOngoingBeforeLastStateValue() external pure returns (uint256) {}

    function getLastMilestoneOngoingStateValue() external pure returns (uint256) {}

    function getAnyMilestoneOngoingStateValue() external pure returns (uint256) {}

    function getInvestmentPool() external view returns (address) {}

    function getVotesAmount(address _investor) external view returns (uint256) {}

    function getTotalVotesAmount() external view returns (uint256) {}

    function getLockedAmount(address _investor) external view returns (uint256) {}

    function getTotalLockedAmount() external view returns (uint256) {}

    function getMilestonesIdsInWhichBalanceChanged(
        address _investor
    ) external view returns (uint256[] memory) {}

    function getTokensMinted(
        address _investor,
        uint256 _milestoneId
    ) external view returns (uint256) {}
}
