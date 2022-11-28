// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IInvestmentPool} from "../interfaces/IInvestmentPool.sol";

contract GovernancePoolMockForIntegration {
    function initialize(
        address _votingToken,
        IInvestmentPool _investmentPool,
        uint8 _threshold,
        uint256 _votestWithdrawFee
    ) external payable {}

    function cancelDuringMilestones(address _investment) external {
        IInvestmentPool(_investment).cancelDuringMilestones();
    }

    function mintVotingTokens(
        uint256 /*_milestoneId*/,
        address /*_investor*/,
        uint256 /*_amount*/
    ) external pure {}

    function burnVotes(uint256 _milestoneId, address _investor) external {}
}
