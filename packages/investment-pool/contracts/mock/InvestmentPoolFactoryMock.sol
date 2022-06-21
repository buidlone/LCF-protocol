// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IInitializableInvestmentPool} from "../interfaces/IInvestmentPool.sol";

import { InvestmentPoolFactory } from "../InvestmentPoolFactory.sol";
import {InvestmentPoolMock} from "./InvestmentPoolMock.sol";

contract InvestmentPoolFactoryMock is InvestmentPoolFactory {
    uint256 timestamp = 0;

    constructor (ISuperfluid _host) InvestmentPoolFactory(_host) { }

    function setTimestamp(uint256 _timestamp) public {
        timestamp = _timestamp;
    }

    function _getNow() internal view virtual override returns(uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return timestamp == 0 ? block.timestamp : timestamp;
    }

    function _deployLogic() internal override virtual returns(IInitializableInvestmentPool pool) {
        InvestmentPoolMock p = new InvestmentPoolMock();
        p.setTimestamp(timestamp);
        return p;
    }
}