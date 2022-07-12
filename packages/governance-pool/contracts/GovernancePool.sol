// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import "./VotingToken.sol";
import {IGovernancePool} from "./interfaces/IGovernancePool.sol";

import "hardhat/console.sol";

contract GovernacePool is ERC1155Holder, Context, IGovernancePool {
    // ERC1155 contract where all voting tokens are stored
    VotingToken public immutable votingToken;

    constructor(VotingToken _votingToken) {
        votingToken = _votingToken;
    }

    /** @notice Get id value for ERC1155 voting token from it's address
        @param _investmentPool investment pool address
        @return investment pool id
     */
    function getInvestmentPoolId(address _investmentPool)
        public
        pure
        returns (uint256)
    {
        return uint256(uint160(_investmentPool));
    }

    /** @notice Get tokens supply for investment pool token
        @param _investmentPool investment pool address
        @return total supply of tokens minted
     */
    function getVotingTokensSupply(address _investmentPool)
        public
        view
        returns (uint256)
    {
        return votingToken.totalSupply(getInvestmentPoolId(_investmentPool));
    }

    /** @notice Get balance of voting tokens for specified investor
        @param _investmentPool investment pool address
        @param _investor address of the investor
        @return balance of tokens owned
     */
    function getVotingTokenBalance(address _investmentPool, address _investor)
        public
        view
        returns (uint256)
    {
        return
            votingToken.balanceOf(
                _investor,
                getInvestmentPoolId(_investmentPool)
            );
    }

    /** @notice Mint new tokens for specified investment pool
        @param _investmentPool investment pool address
        @param _amount tokens amount to mint
     */
    // TODO: make function only available for investment pool
    function mintVotingTokens(address _investmentPool, uint256 _amount) public {
        votingToken.mint(
            _msgSender(),
            getInvestmentPoolId(_investmentPool),
            _amount,
            ""
        );
    }

    // function voteAgainst(address _investmentPool) public payable {
    //     uint256 investmentPoolId = getInvestmentPoolId(_investmentPool);
    //     uint256 investorVotingTokenBalance = getVotingTokenBalance(
    //         _investmentPool,
    //         _msgSender()
    //     );

    //     require(
    //         investorVotingTokenBalance > 0,
    //         "[GP]: don't have any voting tokens"
    //     );

    //     votingToken.setApprovalForAll(address(this), true);

    //     votingToken.safeTransferFrom(
    //         _msgSender(),
    //         address(this),
    //         investmentPoolId,
    //         investorVotingTokenBalance,
    //         ""
    //     );
    // }
}
