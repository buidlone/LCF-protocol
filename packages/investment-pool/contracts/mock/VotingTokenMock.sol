// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {IVotingToken} from "../interfaces/IVotingToken.sol";

contract VotingTokenMock is IVotingToken {
    bytes32 public constant GOVERNANCE_POOL_ROLE = keccak256("GOVERNANCE_POOL_ROLE");

    function grantRole(bytes32 role, address account) public {}
}
