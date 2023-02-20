// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";

contract VotingToken is ERC1155, AccessControl, ERC1155Burnable, ERC1155Supply {
    bytes32 public constant GOVERNANCE_POOL_ROLE = keccak256("GOVERNANCE_POOL_ROLE");

    constructor() ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 investmentPoolId,
        uint256 amount,
        bytes memory data
    ) public override {
        require(
            from == _msgSender() || isApprovedForAll(from, _msgSender()),
            "ERC1155: caller is not token owner nor approved"
        );
        // Update balance in governance pool
        IInvestmentPool investmentPool = IInvestmentPool(address(uint160(investmentPoolId)));
        IGovernancePool governancePool = IGovernancePool(investmentPool.getGovernancePool());

        if (from != address(governancePool) && to != address(governancePool)) {
            governancePool.transferVotes(from, to, amount);
        }

        // Update balance in voting token contract
        _safeTransferFrom(from, to, investmentPoolId, amount, data);
    }

    function mint(
        address _investor,
        uint256 _investmentPoolId,
        uint256 _amount,
        bytes memory _data
    ) public onlyRole(GOVERNANCE_POOL_ROLE) {
        _mint(_investor, _investmentPoolId, _amount, _data);
    }

    function mintBatch(
        address _investor,
        uint256[] memory _investmentPoolIds,
        uint256[] memory _amounts,
        bytes memory data
    ) public onlyRole(GOVERNANCE_POOL_ROLE) {
        _mintBatch(_investor, _investmentPoolIds, _amounts, data);
    }

    // The following functions are overrides required by Solidity.

    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override(ERC1155, ERC1155Supply) {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
