// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "../interfaces/GelatoTypes.sol";
import {IInvestmentPool} from "../interfaces/IInvestmentPool.sol";

contract GelatoOpsMock is IOps, IOpsProxyFactory {
    IInvestmentPool public executor;
    string public gelatoTaskInText;

    event RegisterGelatoTask(ModuleData moduleData);
    event CancelGelatoTask();

    receive() external payable {}

    function createTask(
        address _execAddress,
        bytes calldata /*execDataOrSelector*/,
        ModuleData calldata moduleData,
        address /*feeToken*/
    ) public returns (bytes32 task) {
        executor = IInvestmentPool(_execAddress);
        gelatoTaskInText = "abc";
        task = bytes32("abc");

        emit RegisterGelatoTask(moduleData);
    }

    function getFeeDetails() public pure returns (uint256, address) {
        return (0.01 ether, 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    }

    function gelato() public view returns (address payable) {
        return (payable(address(this)));
    }

    function gelatoTerminateMilestoneStream(uint16 _id) public {
        executor.gelatoTerminateMilestoneStream(_id);
    }

    function cancelTask(bytes32 /*_taskId*/) external {
        emit CancelGelatoTask();
    }

    // For simplicity this contract is returned because we won't deploy any proxy
    function getProxyOf(address /*account*/) public view returns (address, bool) {
        return (address(this), false);
    }
}
