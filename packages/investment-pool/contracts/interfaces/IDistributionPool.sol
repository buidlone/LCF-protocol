// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IInvestmentPool} from "./IInvestmentPool.sol";

interface IDistributionPool {
    // Functions only for creator
    function lockTokens() external;

    function withdrawTokens() external;

    // Functions only for investors
    function allocateTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _investmentWeight
    ) external;

    function removeTokensAllocation(uint256 _milestoneId, address _investor) external;

    function openTokensStream(uint256 _milestoneId, address _investor) external;

    function terminateTokensStream(uint256 _milestoneId, address _investor) external;

    function milestoneJump(uint256 _milestoneId, address _investor) external;

    function getLockedTokens() external view returns (uint256);

    function calculateExpectedTokensAllocation(
        uint256 _investedAmount
    ) external view returns (uint256);

    function getAllocatedTokens(
        address _investor,
        uint256 _milestoneId
    ) external view returns (uint256);

    function getTotalAllocatedTokens(address _investor) external view returns (uint256);

    function getToken() external view returns (address);

    function getTokensBalance() external view returns (uint256);
}

interface IInitializableDistributionPool is IDistributionPool {
    function initialize(
        IInvestmentPool _investmentPool,
        ISuperToken _projectToken,
        uint256 _amountToLock
    ) external;
}
