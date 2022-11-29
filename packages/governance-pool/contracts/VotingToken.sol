// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

contract VotingToken is ERC1155, ERC1155Burnable, Ownable, ERC1155Supply {
    constructor() ERC1155("") {}

    function mint(
        address _investor,
        uint256 _investmentPoolId,
        uint256 _amount,
        bytes memory _data
    ) public onlyOwner {
        _mint(_investor, _investmentPoolId, _amount, _data);
    }

    function mintBatch(
        address _investor,
        uint256[] memory _investmentPoolIds,
        uint256[] memory _amounts,
        bytes memory data
    ) public onlyOwner {
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
}
