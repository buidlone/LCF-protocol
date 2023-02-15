// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {IInvestmentPool} from "./IInvestmentPool.sol";

interface IGovernancePool {
    function mintVotingTokens(uint16 _milestoneId, address _investor, uint256 _amount) external;

    function voteAgainst(uint256 _amount) external;

    function retractVotes(uint256 _retractAmount) external;

    function burnVotes(uint16 _milestoneId, address _investor) external;

    function transferVotes(address _sender, address _recipient, uint256 _amount) external;

    function permanentlyLockVotes(uint256 _votes) external;

    function getUnusedVotes(address _investor) external view returns (uint256);

    function percentageAgainst(uint256 _votesAgainst) external view returns (uint8);

    function thresholdReached(uint256 _investorVotesCount) external view returns (bool);

    function getActiveVotes(uint16 _milestoneId, address _account) external view returns (uint256);

    function getVotingTokensSupply() external view returns (uint256);

    function getVotingTokenBalance(address _account) external view returns (uint256);

    function getInvestmentPoolId() external view returns (uint256);

    function getVotingTokenAddress() external view returns (address);

    function getVotesPercentageThreshold() external view returns (uint8);

    function getVotesWithdrawPercentageFee() external view returns (uint32);

    function getFundraiserOngoingStateValue() external view returns (uint24);

    function getMilestonesOngoingBeforeLastStateValue() external view returns (uint24);

    function getAnyMilestoneOngoingStateValue() external view returns (uint24);

    function getInvestmentPool() external view returns (address);

    function getVotesAmount(address _investor) external view returns (uint256);

    function getTotalVotesAmount() external view returns (uint256);

    function getLockedAmount(address _investor) external view returns (uint256);

    function getTotalLockedAmount() external view returns (uint256);

    function getMilestonesWithVotes(address _investor) external view returns (uint16[] memory);

    function getTokensMinted(
        address _investor,
        uint16 _milestoneId
    ) external view returns (uint256);
}

interface IInitializableGovernancePool is IGovernancePool {
    function initialize(
        address _votingToken,
        IInvestmentPool _investmentPool,
        uint8 _threshold,
        uint32 _votestWithdrawFee
    ) external payable;
}
