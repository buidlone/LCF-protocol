// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {InvestmentPool} from "../InvestmentPool.sol";

contract InvestmentPoolMock is InvestmentPool {
    uint256 public timestamp = 0;

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

    function increaseMilestone() public {
        currentMilestone++;
    }

    function setCurrentMilestone(uint256 _milestone) public {
        currentMilestone = _milestone;
    }

    function terminateMilestoneStreamFinal(uint256 _id) public {
        _terminateMilestoneStream(_id);
    }

    function claim(uint256 _id) public {
        _claim(_id);
    }

    function transferGelatoFee(uint256 _amount, address _paymentToken) public {
        _gelatoTransfer(_amount, _paymentToken);
    }

    function deleteGelatoTask() public {
        delete gelatoTask;
    }

    function setGelatoTaskCreated(bool _isCreated) public {
        gelatoTaskCreated = _isCreated;
    }

    function encodeGelatoTerminationWithSelector(
        uint256 _milestoneId
    ) public pure returns (bytes memory) {
        return abi.encodeWithSelector(this.gelatoTerminateMilestoneStream.selector, _milestoneId);
    }

    function ifNeededUpdateMemInvestmentValue(uint256 _milestoneId) public {
        _updateMemInvestment(_milestoneId);
    }

    function getMemoizedInvestorInvestment(
        address _investor,
        uint256 _milestoneId
    ) public view returns (uint256) {
        return _getMemoizedInvestorInvestment(_investor, _milestoneId);
    }

    function getMemInvestorInvestments(
        address _investor,
        uint256 _milestoneId
    ) public view returns (uint256) {
        return memInvestorInvestments[_investor][_milestoneId];
    }
}
