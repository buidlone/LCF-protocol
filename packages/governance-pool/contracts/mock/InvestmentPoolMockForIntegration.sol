// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";

contract InvestmentPoolMockForIntegration {
    IGovernancePool public governancePool;
    bool anyMilestoneOngoingNow = false;
    uint256 currentMilestone = 0;

    constructor(IGovernancePool _governancePool) {
        governancePool = _governancePool;
    }

    function mintVotingTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _amount
    ) public {
        getGovernancePool().mintVotingTokens(_milestoneId, _investor, _amount);
    }

    function burnVotes(
        uint256 _milestoneId,
        address _investor,
        uint256 _burnAmount
    ) public {
        getGovernancePool().burnVotes(_milestoneId, _investor, _burnAmount);
    }

    function cancelDuringMilestones() external pure {}

    function getCurrentMilestoneId() external view returns (uint256) {
        return currentMilestone;
    }

    function increaseMilestone() external {
        currentMilestone += 1;
    }

    function isAnyMilestoneOngoingAndActive() external view returns (bool) {
        return anyMilestoneOngoingNow;
    }

    function setIsAnyMilestoneOngoing(bool _isOngoing) external {
        anyMilestoneOngoingNow = _isOngoing;
    }

    function getGovernancePool() public view returns (IGovernancePool) {
        return governancePool;
    }
}
