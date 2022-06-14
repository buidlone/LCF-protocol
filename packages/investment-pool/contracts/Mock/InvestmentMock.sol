// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { Investment } from "../Investment.sol";
// import "hardhat/console.sol";


contract InvestmentMock is Investment {

    uint256 timestamp = 0;

    constructor (
        ISuperfluid _host,
        ISuperToken _acceptedToken,
        string memory _registrationKey
    ) Investment (_host, _acceptedToken, _registrationKey) { }

    function setTimestamp(uint256 _timestamp) public {
        timestamp = _timestamp;
    }

    function _getNow() internal view virtual override returns(uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return timestamp == 0 ? block.timestamp : timestamp;
    }


    function validateStorageLayout() external pure{
        uint slot;
        uint offset;

        assembly {slot:= cfaV1Lib.slot offset:= cfaV1Lib.offset}
        // console.log("cfa slot: %s, offset: %s", slot, offset);
        require(slot == 0 && offset == 0, "cfaV1Lib variable shifted during development");

        assembly {slot:= acceptedToken.slot offset:= acceptedToken.offset}
        // console.log("acceptedToken slot: %s, offset: %s", slot, offset);
        require(slot == 2 && offset == 0, "acceptedToken variable shifted during development");

        assembly {slot:= count.slot offset:= count.offset}
        // console.log("count slot: %s, offset: %s", slot, offset);
        require(slot == 3 && offset == 0, "count variable shifted during development");

        assembly {slot:= campaigns.slot offset:= campaigns.offset}
        // console.log("campaigns slot: %s, offset: %s", slot, offset);
        require(slot == 4 && offset == 0, "campaigns variable shifted during development");

        assembly {slot:= investedAmount.slot offset:= investedAmount.offset}
        // console.log("investedAmount slot: %s, offset: %s", slot, offset);
        require(slot == 5 && offset == 0, "investedAmount variable shifted during development");

        // NOTE: If you wish to add a new variable - do it in a similar fashion
        // Console log statements can help you figure out the slot/offset pair
        // if you are unsure of the previous variable size.
        // Remember to switch function mutability to view for console.log to work
    }

    // TODO: Do the same validation for the struct order
}
