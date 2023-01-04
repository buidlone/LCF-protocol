// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInvestmentPool} from "../interfaces/IInvestmentPool.sol";
import {IInitializableDistributionPool} from "../interfaces/IDistributionPool.sol";

contract DistributionPoolMockForIntegration is IInitializableDistributionPool {
    function initialize(
        IInvestmentPool _investmentPool,
        IERC20 _projectToken,
        uint256 _amountToLock
    ) external payable {}

    function didCreatorLockTokens() public pure returns (bool) {
        return true;
    }

    function lockTokens() external {}

    function allocateTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _investmentWeight,
        uint256 _weightDivisor,
        uint256 _allocationCoefficient
    ) external {}

    function removeTokensAllocation(uint256 _milestoneId, address _investor) external {}

    function claimAllocation() external {}

    function withdrawTokens() external {}

    function calculateExpectedTokensAllocation(
        uint256 _investedAmount
    ) public view returns (uint256) {}

    function getAllocatedAmount(
        address _investor,
        uint256 _milestoneId
    ) public view returns (uint256) {}

    function getAllocationData(address _investor) public view returns (uint256, uint256) {}

    function getAllocatedTokens(address _investor) public view returns (uint256) {}

    function getClaimedTokens(address _investor) public view returns (uint256) {}

    function getMilestonesWithAllocation(
        address _investor
    ) public view returns (uint256[] memory) {}

    function getPercentageDivider() public pure returns (uint256) {}

    function getInvestmentPool() public view returns (address) {}

    function getToken() public view returns (address) {}

    function getLockedTokens() public view returns (uint256) {}

    function getTotalAllocatedTokens() public view returns (uint256) {}
}
