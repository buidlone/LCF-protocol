// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IInitializableInvestmentPool} from "../interfaces/IInvestmentPool.sol";
import {IGelatoOps} from "../interfaces/IGelatoOps.sol";

import {InvestmentPoolFactory} from "../InvestmentPoolFactory.sol";
import {InvestmentPoolMock} from "./InvestmentPoolMock.sol";

contract InvestmentPoolFactoryMock is InvestmentPoolFactory {
    uint256 public timestamp = 0;

    // solhint-disable-next-line no-empty-blocks
    constructor(ISuperfluid _host, IGelatoOps _gelatoOps)
        InvestmentPoolFactory(_host, _gelatoOps)
    {}

    function setTimestamp(uint256 _timestamp) public {
        timestamp = _timestamp;
    }

    function _getNow() internal view virtual override returns (uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return timestamp == 0 ? block.timestamp : timestamp;
    }

    function _deployLogic()
        internal
        virtual
        override
        returns (IInitializableInvestmentPool pool)
    {
        InvestmentPoolMock p = new InvestmentPoolMock();
        p.setTimestamp(timestamp);
        return p;
    }
}
