// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";

contract InvestmentPoolMockForIntegration {
    IGovernancePool public governancePool;

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

    function cancelDuringMilestones() external pure {}
}
