// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IGelatoOps {
    function createTaskNoPrepayment(
        address _execAddress,
        bytes4 _execSelector,
        address _resolverAddress,
        bytes calldata _resolverData,
        address _feeToken
    ) external returns (bytes32 task);

    function getFeeDetails() external view returns (uint256, address);

    function gelato() external view returns (address payable);

    function cancelTask(bytes32 _taskId) external;
}
