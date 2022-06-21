// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IInvestmentPool} from "./IInvestmentPool.sol";

interface IInvestmentPoolFactory {
    /**
     * @dev Upgradability modes
     */
    enum Upgradability {
        // So far, only non-upgradeable deployments are supported (no-proxy)
        NON_UPGRADABLE,

        // Not supported yet
        UUPS_PROXY,

        // Not supported yet
        CLONE_PROXY
    }

    event Created(address indexed creator, address indexed pool, Upgradability upgradability);

    function createInvestmentPool(
        ISuperToken _acceptedToken,
        uint96 _softCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        Upgradability _upgradability,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) external returns (IInvestmentPool);
}