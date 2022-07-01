// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

interface IInvestmentPool is ISuperApp {
    struct MilestoneInterval {
        // Starting date of the milestone
        uint48 startDate;
        // End date of the milestone period
        uint48 endDate;
    }

    struct Milestone {
        uint48 startDate;
        uint48 endDate;
        bool paid;
        bool streamOngoing;
        uint256 paidAmount;
        // TODO: More fields here for internal state tracking
    }

    function invest(uint256 _amount) external;

    function unpledge(uint256 _amount) external;

    function refund() external;

    function claim(uint256 _milestoneId) external;

    function terminateMilestoneStreamFinal(uint256 _milestoneId) external;

    function isFundraiserOngoingNow() external view returns (bool);

    function isMilestoneOngoingNow(uint _id) external view returns (bool);

    function isSoftCapReached() external view returns (bool);

    function didFundraiserPeriodEnd() external view returns (bool);

    function isFailedFundraiser() external view returns (bool);

    function canTerminateMilestoneStreamFinal(uint256 _milestoneId)
        external
        view
        returns (bool);

    function canAutomatedStreamTerminationBePerformed(uint256 _milestoneId)
        external
        view
        returns (bool);

    function gelatoChecker()
        external
        view
        returns (bool canExec, bytes memory execPayload);
}

interface IInitializableInvestmentPool is IInvestmentPool {
    function initialize(
        ISuperfluid _host,
        ISuperToken _acceptedToken,
        address _creator,
        address _gelatoOps,
        uint96 _softCap,
        uint48 _fundraiserStartAt,
        uint48 _fundraiserEndAt,
        uint48 _votingPeriod,
        uint48 _terminationWindow,
        uint48 _automatedTerminationWindow,
        MilestoneInterval[] calldata _milestones
    ) external;
}
