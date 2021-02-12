pragma solidity ^0.5.16;

// Inheritance
import "./Owned.sol";


contract DualRewardsDistributionRecipientV2 is Owned {
    address public rewardsDistribution;

    function notifyRewardAmount(uint256 rewardA) external;

    modifier onlyRewardsDistribution() {
        require(msg.sender == rewardsDistribution, "Caller is not RewardsDistribution contract");
        _;
    }

    function setRewardsDistribution(address _rewardsDistribution) external onlyOwner {
        rewardsDistribution = _rewardsDistribution;
    }
}
