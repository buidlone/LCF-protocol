// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {GovernancePool} from "../GovernancePool.sol";
import {VotingToken} from "../VotingToken.sol";

contract GovernancePoolMock is GovernancePool {
    uint256 timestamp = 0;

    constructor(
        VotingToken _votingToken,
        address _investmentPoolFactory,
        uint8 _threshold,
        uint256 _votestWithdrawFee
    ) GovernancePool(_votingToken, _investmentPoolFactory, _threshold, _votestWithdrawFee) {}

    function setTimestamp(uint256 _timestamp) public {
        timestamp = _timestamp;
    }

    function _getNow() internal view virtual override returns (uint256) {
        // solhint-disable-next-line not-rely-on-time
        return timestamp == 0 ? block.timestamp : timestamp;
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
        uint256 _milestoneId,
        bool _isClaimed
    ) public {
        uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
        tokensLocked[_msgSender()][investmentPoolId][_milestoneId].claimed = _isClaimed;
    }
}
