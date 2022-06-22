// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

// Superfluid imports
import {ISuperfluid, ISuperToken, ISuperApp, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";


// Openzepelin imports
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

import {IInvestmentPool, IInitializableInvestmentPool} from "./interfaces/IInvestmentPool.sol";
import {IInvestmentPoolFactory} from "./interfaces/IInvestmentPoolFactory.sol";

import {InvestmentPool} from "./InvestmentPool.sol";

contract InvestmentPoolFactory is IInvestmentPoolFactory, Context {
    uint48 constant public VOTING_PERIOD = 7 days;
    uint48 constant public TERMINATION_WINDOW = 12 hours;
    // TODO: Add min/max durations for fundraiser campaign and milestone respectively
    uint constant public MILESTONE_MIN_DURATION = 30 days;
    uint constant public FUNDRAISER_MAX_DURATION = 90 days;

    // TODO: Arbitrary choice, set this later to something that makes sense
    uint32 constant public MAX_MILESTONE_COUNT = 10;

    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

    ISuperfluid public host;

    constructor(ISuperfluid _host)
    {
        assert(address(_host) != address(0));
        host = _host;
    }


    function createInvestmentPool(
        ISuperToken _acceptedToken,
        uint96 _softCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        Upgradability _upgradability,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) external returns (IInvestmentPool){
        IInitializableInvestmentPool invPool;
        _assertPoolInitArguments(
            host,
            _acceptedToken,
            _msgSender(),
            _softCap,
            _fundraiserStartAt,
            _fundraiserEndAt,
            _milestones);
        
        // The only one available so far
        if (_upgradability == Upgradability.NON_UPGRADABLE) {
            invPool = _deployLogic();
        }
        // Other supported types will just deploy a proxy to an existing logic contract
        // Perhaps clones can be used here for super cheap deployments
        else {
            revert("[IPF]: upgradeability types other than NON_UPGRADEABLE are not yet supported");
        }

        invPool.initialize(
            host,
            _acceptedToken,
            _msgSender(),
            _softCap,
            _fundraiserStartAt,
            _fundraiserEndAt,
            VOTING_PERIOD,
            TERMINATION_WINDOW,
            _milestones
        );

        // Final level is required by the Superfluid's spec right now
        // We only really care about termination callbacks, others - noop
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL
             | SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP
             | SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP
             | SuperAppDefinitions.AFTER_AGREEMENT_CREATED_NOOP
             | SuperAppDefinitions.AFTER_AGREEMENT_UPDATED_NOOP;

        host.registerAppByFactory(invPool, configWord);

        emit Created(_msgSender(), address(invPool), _upgradability);

        return invPool;
    }

    function _deployLogic() internal virtual returns(IInitializableInvestmentPool pool) {
        pool = new InvestmentPool();
    }

    function _assertPoolInitArguments(
        ISuperfluid _host,
        ISuperToken _superToken,
        address _creator,
        uint96 _softCap,
        uint96 _fundraiserStartAt,
        uint96 _fundraiserEndAt,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) internal view
    {
        require(address(_superToken) != address(0), "[IPF]: accepted token zero address");
        require(address(_creator) != address(0), "[IPF]: creator zero address");
        
        require(_fundraiserStartAt >= _getNow(), "[IPF]: fundraiser start at < now");
        require(_fundraiserEndAt > _fundraiserStartAt, "[IPF]:fundraiser end at < start at");
        require(_fundraiserEndAt - _fundraiserStartAt <= FUNDRAISER_MAX_DURATION, "[IPF]: fundraiser duration exceeds max duration");

        require(_milestones.length > 0, "[IPF]: must contain at least 1 milestone");
        require(_milestones.length <= MAX_MILESTONE_COUNT, "[IPF]: milestone count > max count");

        
        // Special case for the first milestone
        require(_milestones[0].startDate >= _fundraiserEndAt, "[IPF]: milestones can't start before fundraiser ends");
        require(_validateMilestoneInterval(_milestones[0]), "[IPF]: invalid milestone interval");

        // Starting at index 1, since the first milestone has been checked already
        for (uint32 i = 1; i < _milestones.length; ++i) {
            require(_validateMilestoneInterval(_milestones[0]), "[IPF]: invalid milestone interval");
            require((_milestones[i - 1].endDate + VOTING_PERIOD) <= _milestones[i].startDate, 
            "[IPF]: milestones must not overlap, including voting period");
        }
    }

    function _validateMilestoneInterval(IInvestmentPool.MilestoneInterval memory milestone) internal pure returns(bool) {
        return milestone.endDate > milestone.startDate &&
         (milestone.endDate - milestone.startDate >= MILESTONE_MIN_DURATION);
    }

    function _getNow() internal view virtual returns(uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }
}