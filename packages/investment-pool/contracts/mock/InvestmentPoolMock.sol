// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {InvestmentPool} from "../InvestmentPool.sol";

contract InvestmentPoolMock is InvestmentPool {
    uint256 timestamp = 0;

    function setTimestamp(uint256 _timestamp) public {
        timestamp = _timestamp;
    }

    function _getNow() internal view virtual override returns (uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return timestamp == 0 ? block.timestamp : timestamp;
    }

    function getMemMilestonePortions(uint256 _id) public view returns (uint256) {
        return memMilestonePortions[_id];
    }

    function getMemMilestoneInvestments(uint256 _id) public view returns (uint256) {
        return memMilestoneInvestments[_id];
    }

    function setCurrentMilestone(uint256 _id) public {
        currentMilestone = _id;
    }
}
