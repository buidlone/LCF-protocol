// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IGelatoOps {
    function createTask(
        address _execAddress,
        bytes4 _execSelector,
        address _resolverAddress,
        bytes calldata _resolverData
    ) external returns (bytes32 task);
}
