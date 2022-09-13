// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGelatoOps} from "../interfaces/IGelatoOps.sol";
import {IInvestmentPool} from "../interfaces/IInvestmentPool.sol";

contract GelatoOpsMock is IGelatoOps {
    IInvestmentPool public executor;

    event RegisterGelatoTask();

    receive() external payable {}

    function createTaskNoPrepayment(
        address _execAddress,
        bytes4, /*_execSelector*/
        address, /*_resolverAddress*/
        bytes calldata, /*_resolverData*/
        address /*_feeToken*/
    ) public returns (bytes32 task) {
        executor = IInvestmentPool(_execAddress);
        emit RegisterGelatoTask();
        task = bytes32("abc");
    }

    function getFeeDetails() public pure returns (uint256 fee, address feeToken) {
        return (0.01 ether, 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    }

    function gelato() public view returns (address payable) {
        return (payable(address(this)));
    }

    function gelatoTerminateMilestoneStream(uint256 _id) public {
        executor.gelatoTerminateMilestoneStreamFinal(_id);
    }

    function cancelTask(
        bytes32 /*_taskId*/
    ) external pure {}
}
