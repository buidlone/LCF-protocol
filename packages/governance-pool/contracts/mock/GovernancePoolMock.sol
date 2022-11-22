// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
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

    function setInvestmentPoolExists(uint256 _investmentPool, bool _exists) public {
        investmentPoolExists[_investmentPool] = _exists;
    }

    function getMemActiveTokens(
        address _investor,
        uint256 _ipId,
        uint256 _milestoneId
    ) public view returns (uint256) {
        return memActiveTokens[_investor][_ipId][_milestoneId];
    }
}
