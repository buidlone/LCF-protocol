// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {IGelatoOps} from "../interfaces/IGelatoOps.sol";

contract GelatoOpsMock is IGelatoOps {
    event RegisterGelatoTask();

    function createTask(
        address _execAddress,
        bytes4 _execSelector,
        address _resolverAddress,
        bytes calldata _resolverData
    ) public returns (bytes32 task) {
        emit RegisterGelatoTask();
        task = bytes32("");
    }
}
