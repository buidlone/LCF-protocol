// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";

contract InvestmentPoolMockForIntegration {
    IGovernancePool public governancePool;
    uint256 currentMilestone = 0;
    uint256 investmentPoolStateValue;

    constructor(IGovernancePool _governancePool) {
        governancePool = _governancePool;
    }

    function mintVotingTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _amount
    ) public {
        governancePool.mintVotingTokens(_milestoneId, _investor, _amount);
    }

    function burnVotes(
        uint256 _milestoneId,
        address _investor,
        uint256 _burnAmount
    ) public {
        governancePool.burnVotes(_milestoneId, _investor, _burnAmount);
    }

    function cancelDuringMilestones() external pure {}

    function getCurrentMilestoneId() external view returns (uint256) {
        return currentMilestone;
    }

    function increaseMilestone() external {
        currentMilestone += 1;
    }

    function setProjectState(uint256 _state) public {
        investmentPoolStateValue = _state;
    }

    function getProjectStateByteValue() public view returns (uint256 stateNumber) {
        return investmentPoolStateValue;
    }

    function getGovernancePool() public view returns (address) {
        return address(governancePool);
    }
}
