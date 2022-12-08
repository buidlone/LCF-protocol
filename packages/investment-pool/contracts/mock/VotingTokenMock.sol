// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {IVotingToken} from "../interfaces/IVotingToken.sol";

contract VotingTokenMock is IVotingToken {
    bytes32 public constant GOVERNANCE_POOL_ROLE = keccak256("GOVERNANCE_POOL_ROLE");

    function grantRole(bytes32 role, address account) public {}
}
