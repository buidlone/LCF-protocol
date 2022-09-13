// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {InvestmentPoolFactory} from "@buidlone/investment-pool/contracts/InvestmentPoolFactory.sol";
import {IGelatoOps} from "@buidlone/investment-pool/contracts/interfaces/IGelatoOps.sol";

contract InvestmentPoolFactoryTestMock is InvestmentPoolFactory {
    constructor(
        ISuperfluid _host,
        IGelatoOps _gelatoOps,
        address _implementationContract
    ) InvestmentPoolFactory(_host, _gelatoOps, _implementationContract) {
        TERMINATION_WINDOW = 20 minutes;
        AUTOMATED_TERMINATION_WINDOW = 10 minutes;
        MILESTONE_MIN_DURATION = 1 minutes;
        MILESTONE_MAX_DURATION = 60 minutes;
        FUNDRAISER_MIN_DURATION = 1 minutes;
        FUNDRAISER_MAX_DURATION = 60 minutes;
    }
}
