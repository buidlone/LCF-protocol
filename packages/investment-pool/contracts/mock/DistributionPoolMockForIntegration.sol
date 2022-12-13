// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInvestmentPool} from "../interfaces/IInvestmentPool.sol";

contract DistributionPoolMockForIntegration {
    function initialize(
        IInvestmentPool _investmentPool,
        IERC20 _projectToken,
        uint256 _amountToLock
    ) external payable {}

    function lockTokens(address _creator) external {}

    function allocateTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _investmentWeight,
        uint256 _weightDivisor,
        uint256 _allocationCoefficient
    ) external {}

    function removeTokensAllocation(uint256 _milestoneId, address _investor) external {}

    function didCreatorLockTokens() public pure returns (bool) {
        return true;
    }
}
