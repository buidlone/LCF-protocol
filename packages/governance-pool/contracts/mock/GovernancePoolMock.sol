// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {GovernancePool} from "../GovernancePool.sol";
import {VotingToken} from "../VotingToken.sol";

contract GovernancePoolMock is GovernancePool {
    uint256 public timestamp = 0;

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

    function setInvestmentPool(address _investmentPool) public {
        investmentPool = IInvestmentPool(_investmentPool);
    }

    function getMemActiveTokens(address _investor, uint256 _milestoneId)
        public
        view
        returns (uint256)
    {
        return memActiveTokens[_investor][_milestoneId];
    }
}
