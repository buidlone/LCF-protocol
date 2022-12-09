// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {DistributionPool} from "../DistributionPool.sol";

contract DistributionPoolMock is DistributionPool {
    function getMemoizedMilestoneAllocation(
        address _investor,
        uint256 _milestoneId
    ) public view returns (uint256) {
        return _getMemoizedMilestoneAllocation(_investor, _milestoneId);
    }

    function getMemMilestoneAllocation(
        address _investor,
        uint256 _milestoneId
    ) public view returns (uint256) {
        return memMilestoneAllocation[_investor][_milestoneId];
    }
}
