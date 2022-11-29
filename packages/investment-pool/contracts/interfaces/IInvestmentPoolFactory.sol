// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperToken, ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IInvestmentPool} from "./IInvestmentPool.sol";
import {IGovernancePool} from "./IGovernancePool.sol";

interface IInvestmentPoolFactory {
    /**
     * @dev ProxyType modes
     */
    enum ProxyType {
        CLONE_PROXY,
        // Not supported yet
        UUPS_PROXY
    }

    event Created(address indexed creator, address indexed pool, ProxyType proxyType);

    function createInvestmentPool(
        ISuperToken _acceptedToken,
        uint96 _softCap,
        uint96 _hardCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        ProxyType _proxyType,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) external payable returns (address);

    function getMaxMilestoneCount() external pure returns (uint32);

    function getTerminationWindow() external view returns (uint48);

    function getAutomatedTerminationWindow() external view returns (uint48);

    function getPercentageDivider() external pure returns (uint256);

    function getMilestoneMinDuration() external view returns (uint256);

    function getMilestoneMaxDuration() external view returns (uint256);

    function getFundraiserMinDuration() external view returns (uint256);

    function getFundraiserMaxDuration() external view returns (uint256);

    function getInvestmentWithdrawPercentageFee() external view returns (uint256);

    function getSoftCapMultiplier() external view returns (uint256);

    function getHardCapMultiplier() external view returns (uint256);

    function getGelatoFeeAllocationForProject() external view returns (uint256);

    function getGovernancePool() external view returns (address);

    function getSuperfluidHost() external view returns (address);

    function getGelatoOps() external view returns (address payable);

    function getInvestmentPoolImplementation() external view returns (address);
}
