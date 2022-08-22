// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IInvestmentPool} from "./IInvestmentPool.sol";

interface IInvestmentPoolFactory {
    /**
     * @dev ProxyType modes
     */
    enum ProxyType {
        CLONE_PROXY,
        // Not supported yet
        UUPS_PROXY
    }

    event Created(
        address indexed creator,
        address indexed pool,
        ProxyType proxyType
    );

    function createInvestmentPool(
        ISuperToken _acceptedToken,
        uint96 _softCap,
        uint96 _hardCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        ProxyType _proxyType,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) external returns (IInvestmentPool);
}
