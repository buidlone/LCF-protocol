// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {GovernancePool} from "../GovernancePool.sol";
import {VotingToken} from "../VotingToken.sol";

contract GovernancePoolMock is GovernancePool {
    constructor(
        VotingToken _votingToken,
        address _investmentPoolFactory,
        uint8 _treshold,
        uint8 _maxInvestments
    ) GovernancePool(_votingToken, _investmentPoolFactory, _treshold, _maxInvestments) {}

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

    function setTokensClaimedStatus(
        address _investmentPool,
        uint256 _listId,
        bool _isClaimed
    ) public {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        tokensLocked[_msgSender()][investmentPoolId][_listId].claimed = _isClaimed;
    }
}
