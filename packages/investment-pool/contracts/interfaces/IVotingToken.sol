// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

interface IVotingToken {
    function GOVERNANCE_POOL_ROLE() external returns (bytes32);

    function grantRole(bytes32 role, address account) external;
}
