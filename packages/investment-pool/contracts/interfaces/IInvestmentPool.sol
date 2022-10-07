// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IGelatoOps} from "./IGelatoOps.sol";
import {IGovernancePool} from "./IGovernancePool.sol";

interface IInvestmentPool is ISuperApp {
    struct ProjectInfo {
        uint96 seedFundingLimit;
        uint96 softCap;
        uint96 hardCap;
        uint48 fundraiserStartAt;
        uint48 fundraiserEndAt;
    }

    struct MilestoneInterval {
        // Starting date of the milestone
        uint48 startDate;
        // End date of the milestone period
        uint48 endDate;
        // Describes the portion of the total funds(all milestones),
        // assigned as a seed portion for this milestone
        // 100% == 10 ** 6
        uint256 intervalSeedPortion;
        // Describes the portion of the total funds(all milestones),
        // assigned as a streaming portion for this milestone
        // 100% == 10 ** 6
        uint256 intervalStreamingPortion;
    }

    struct Milestone {
        uint48 startDate;
        uint48 endDate;
        bool paid;
        bool seedAmountPaid;
        bool streamOngoing;
        uint256 paidAmount;
        // Describes the portion of the total funds(all milestones),
        // assigned as a seed portion for this milestone
        // 100% == 10 ** 6
        uint256 intervalSeedPortion;
        // Describes the portion of the total funds(all milestones),
        // assigned as a streaming portion for this milestone
        // 100% == 10 ** 6
        uint256 intervalStreamingPortion;
        // TODO: More fields here for internal state tracking
    }

    function invest(uint256 _amount, bool _strict) external;

    function unpledge(uint256 _amount) external;

    function refund() external;

    function cancelBeforeFundraiserStart() external;

    function cancelDuringMilestones() external;

    function startFirstFundsStream() external;

    function milestoneJumpOrFinalProjectTermination() external;

    function withdrawRemainingEth() external;

    function isEmergencyTerminated() external view returns (bool);

    function isCanceledBeforeFundraiserStart() external view returns (bool);

    function isCanceledDuringMilestones() external view returns (bool);

    function isSoftCapReached() external view returns (bool);

    function didFundraiserPeriodEnd() external view returns (bool);

    function isFundraiserNotStarted() external view returns (bool);

    function isFundraiserOngoingNow() external view returns (bool);

    function isFundraiserEndedButNoMilestoneIsActive() external view returns (bool);

    function isMilestoneOngoingNow(uint _id) external view returns (bool);

    function isAnyMilestoneOngoing() external view returns (bool);

    function isLastMilestoneOngoing() external view returns (bool);

    function isFailedFundraiser() external view returns (bool);

    function didProjectEnd() external view returns (bool);

    function getProjectStateByteValue() external view returns (uint256 stateNumber);

    function canTerminateMilestoneStreamFinal(uint256 _milestoneId) external view returns (bool);

    function canGelatoTerminateMilestoneStreamFinal(uint256 _milestoneId)
        external
        view
        returns (bool);

    function getMilestoneSeedAmount(uint256 _milestoneId) external view returns (uint256);

    function getTotalMilestoneTokenAllocation(uint _milestoneId) external returns (uint256);

    function gelatoChecker() external view returns (bool canExec, bytes memory execPayload);

    function startGelatoTask() external;

    function gelatoTerminateMilestoneStreamFinal(uint256 _milestoneId) external;
}

interface IInitializableInvestmentPool is IInvestmentPool {
    function initialize(
        ISuperfluid _host,
        ISuperToken _acceptedToken,
        address _creator,
        IGelatoOps _gelatoOps,
        IInvestmentPool.ProjectInfo calldata _projectInfo,
        uint48 _terminationWindow,
        uint48 _automatedTerminationWindow,
        MilestoneInterval[] calldata _milestones,
        IGovernancePool _governancePool
    ) external payable;
}
