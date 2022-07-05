// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGelatoOps} from "../interfaces/IGelatoOps.sol";

contract GelatoOpsMock is IGelatoOps {
    event RegisterGelatoTask();

    function createTaskNoPrepayment(
        address _execAddress,
        bytes4 _execSelector,
        address _resolverAddress,
        bytes calldata _resolverData,
        address _feeToken
    ) public returns (bytes32 task) {
        emit RegisterGelatoTask();
        task = bytes32("");
    }

    function getFeeDetails() public view returns (uint256, address) {
        return (uint256(0), address(0));
    }

    function gelato() public view returns (address payable) {
        return (payable(address(0)));
    }
}
