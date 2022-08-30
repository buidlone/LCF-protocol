// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGelatoOps} from "../interfaces/IGelatoOps.sol";
import {IInvestmentPool} from "../interfaces/IInvestmentPool.sol";

contract GelatoOpsMock is IGelatoOps {
    IInvestmentPool public executor;

    event RegisterGelatoTask();

    function createTaskNoPrepayment(
        address _execAddress,
        bytes4, /*_execSelector*/
        address, /*_resolverAddress*/
        bytes calldata, /*_resolverData*/
        address /*_feeToken*/
    ) public returns (bytes32 task) {
        executor = IInvestmentPool(_execAddress);
        emit RegisterGelatoTask();
        task = bytes32("");
    }

    function getFeeDetails() public pure returns (uint256, address) {
        return (uint256(0), address(0));
    }

    function gelato() public pure returns (address payable) {
        return (payable(address(0)));
    }

    function terminateMilestoneStream(uint256 _id) public {
        executor.gelatoTerminateMilestoneStreamFinal(_id);
    }
}
