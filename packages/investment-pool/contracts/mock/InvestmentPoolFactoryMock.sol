// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/proxy/Clones.sol";
import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IInitializableInvestmentPool} from "../interfaces/IInvestmentPool.sol";

import {InvestmentPoolFactory} from "../InvestmentPoolFactory.sol";
import {InvestmentPoolMock} from "./InvestmentPoolMock.sol";

contract InvestmentPoolFactoryMock is InvestmentPoolFactory {
    // Assign all Clones library functions to addresses
    using Clones for address;

    uint256 public timestamp = 0;

    // solhint-disable-next-line no-empty-blocks
    constructor(
        ISuperfluid _host,
        address payable _gelatoOps,
        address _implementationContract
    ) InvestmentPoolFactory(_host, _gelatoOps, _implementationContract) {}

    function setTimestamp(uint256 _timestamp) public {
        timestamp = _timestamp;
    }

    function _getNow() internal view virtual override returns (uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return timestamp == 0 ? block.timestamp : timestamp;
    }

    function _deployClone() internal virtual override returns (IInitializableInvestmentPool pool) {
        InvestmentPoolMock p = InvestmentPoolMock(
            payable(getInvestmentPoolImplementation().clone())
        );
        p.setTimestamp(timestamp);
        return p;
    }

    function deployClone() public returns (IInitializableInvestmentPool pool) {
        pool = _deployClone();
    }
}
