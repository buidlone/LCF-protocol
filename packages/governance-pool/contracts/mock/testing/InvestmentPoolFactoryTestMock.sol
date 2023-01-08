// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {InvestmentPoolFactory} from "@buidlone/investment-pool/contracts/InvestmentPoolFactory.sol";
import {IVotingToken} from "@buidlone/investment-pool/contracts/interfaces/IVotingToken.sol";

contract InvestmentPoolFactoryTestMock is InvestmentPoolFactory {
    constructor(
        ISuperfluid _host,
        address payable _gelatoOps,
        address _ipImplementation,
        address _gpImplementation,
        address _dpImplementation,
        IVotingToken _votingToken
    )
        InvestmentPoolFactory(
            _host,
            _gelatoOps,
            _ipImplementation,
            _gpImplementation,
            _dpImplementation,
            _votingToken
        )
    {}

    function getTerminationWindow() public pure override returns (uint48) {
        return 30 minutes;
    }

    function getAutomatedTerminationWindow() public pure override returns (uint48) {
        return 15 minutes;
    }

    function getMilestoneMinDuration() public pure override returns (uint48) {
        return 2 hours;
    }

    function getFundraiserMinDuration() public pure override returns (uint48) {
        return 1 minutes;
    }
}
