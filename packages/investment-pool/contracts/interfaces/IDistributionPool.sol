// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInvestmentPool} from "./IInvestmentPool.sol";

interface IDistributionPool {
    function lockTokens() external;

    function allocateTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _investmentWeight,
        uint256 _weightDivisor,
        uint256 _allocationCoefficient
    ) external;

    function removeTokensAllocation(uint256 _milestoneId, address _investor) external;

    function claimAllocation() external;

    function withdrawTokens() external;

    function calculateExpectedTokensAllocation(
        uint256 _investedAmount
    ) external view returns (uint256);

    function getAllocatedAmount(
        address _investor,
        uint256 _milestoneId
    ) external view returns (uint256);

    function getAllocationData(address _investor) external view returns (uint256, uint256);

    function getAllocatedTokens(address _investor) external view returns (uint256);

    function getClaimedTokens(address _investor) external view returns (uint256);

    function getMilestonesWithAllocation(
        address _investor
    ) external view returns (uint256[] memory);

    function getPercentageDivider() external pure returns (uint256);

    function getInvestmentPool() external view returns (address);

    function getToken() external view returns (address);

    function getLockedTokens() external view returns (uint256);

    function didCreatorLockTokens() external view returns (bool);

    function getTotalAllocatedTokens() external view returns (uint256);
}

interface IInitializableDistributionPool is IDistributionPool {
    function initialize(
        IInvestmentPool _investmentPool,
        IERC20 _projectToken,
        uint256 _amountToLock
    ) external payable;
}
