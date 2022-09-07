// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IInvestmentPool} from "../interfaces/IInvestmentPool.sol";

contract GovernancePoolMockForIntegration {
    function cancelDuringMilestones(address _investment) external {
        IInvestmentPool(_investment).cancelDuringMilestones();
    }

    function activateInvestmentPool(
        address /*_investmentPool*/
    ) external pure {}

    function mintVotingTokens(
        address, /*_investor*/
        uint256, /*_amount*/
        uint48 /*_unlockTime*/
    ) external pure {}
}
