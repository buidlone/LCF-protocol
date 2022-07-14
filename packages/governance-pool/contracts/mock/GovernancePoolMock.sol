// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {GovernancePool} from "../GovernancePool.sol";
import {IGovernancePool} from "../interfaces/IGovernancePool.sol";
import "../VotingToken.sol";

contract GovernancePoolMock is GovernancePool {
    constructor(VotingToken _votingToken, address _investmentPoolFactory)
        GovernancePool(_votingToken, _investmentPoolFactory)
    {}

    function updateInvestmentPoolStatusToUnavailable(address _investmentPool) public {
        uint256 id = getInvestmentPoolId(_investmentPool);
        investmentPoolStatus[id] = IGovernancePool.InvestmentPoolStatus.Unavailable;
    }

    function updateInvestmentPoolStatusToActiveVoting(address _investmentPool) public {
        uint256 id = getInvestmentPoolId(_investmentPool);
        investmentPoolStatus[id] = IGovernancePool.InvestmentPoolStatus.ActiveVoting;
    }

    function updateInvestmentPoolStatusToVotedAgainst(address _investmentPool) public {
        uint256 id = getInvestmentPoolId(_investmentPool);
        investmentPoolStatus[id] = IGovernancePool.InvestmentPoolStatus.VotedAgainst;
    }
}
