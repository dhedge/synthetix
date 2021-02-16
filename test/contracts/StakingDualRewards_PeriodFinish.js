const { contract } = require('hardhat');
const { toBN } = require('web3-utils');

const { toBytes32 } = require('../..');
const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');
const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');
const { mockToken, setupAllContracts, setupContract } = require('./setup');
const { currentTime, toUnit, fastForward } = require('../utils')();

contract('StakingDualRewards', accounts => {
	const [
		,
		owner,
		oracle,
		authority,
		rewardEscrowAddress,
		stakingAccount1,
		mockDualRewardsDistributionAddress,
	] = accounts;

	// Synthetix is the rewardsTokenA
	let rewardsTokenA,
		rewardsTokenB,
		stakingToken,
		externalRewardsToken,
		exchangeRates,
		stakingDualRewards,
		dualRewardsDistribution,
		systemSettings,
		feePool;

	const DAY = 86400;
	const ZERO_BN = toBN(0);

	const setRewardsTokenExchangeRate = async ({ rateStaleDays } = { rateStaleDays: 7 }) => {
		const rewardsTokenAIdentifier = await rewardsTokenA.symbol();

		await systemSettings.setRateStalePeriod(DAY * rateStaleDays, { from: owner });
		const updatedTime = await currentTime();
		await exchangeRates.updateRates(
			[toBytes32(rewardsTokenAIdentifier)],
			[toUnit('2')],
			updatedTime,
			{
				from: oracle,
			}
		);
		assert.equal(await exchangeRates.rateIsStale(toBytes32(rewardsTokenAIdentifier)), false);
	};

	addSnapshotBeforeRestoreAfterEach();

	before(async () => {
		({ token: stakingToken } = await mockToken({
			accounts,
			name: 'Staking Token',
			symbol: 'STKN',
		}));

		({ token: rewardsTokenB } = await mockToken({
			accounts,
			name: 'dHEDGE DAO',
			symbol: 'DHT',
		}));

		({ token: externalRewardsToken } = await mockToken({
			accounts,
			name: 'External Rewards Token',
			symbol: 'MOAR',
		}));

		({
			DualRewardsDistribution: dualRewardsDistribution,
			FeePool: feePool,
			Synthetix: rewardsTokenA,
			ExchangeRates: exchangeRates,
			SystemSettings: systemSettings,
		} = await setupAllContracts({
			accounts,
			contracts: ['DualRewardsDistribution', 'Synthetix', 'FeePool', 'SystemSettings'],
		}));

		stakingDualRewards = await setupContract({
			accounts,
			contract: 'StakingDualRewards',
			args: [
				owner,
				dualRewardsDistribution.address,
				rewardsTokenA.address,
				rewardsTokenB.address,
				stakingToken.address,
			],
		});

		await Promise.all([
			dualRewardsDistribution.setAuthority(authority, { from: owner }),
			dualRewardsDistribution.setRewardEscrow(rewardEscrowAddress, { from: owner }),
			dualRewardsDistribution.setSynthetixProxy(rewardsTokenA.address, { from: owner }),
			dualRewardsDistribution.setRewardTokenProxy(rewardsTokenB.address, { from: owner }),
			dualRewardsDistribution.setFeePoolProxy(feePool.address, { from: owner }),
		]);

		await stakingDualRewards.setDualRewardsDistribution(mockDualRewardsDistributionAddress, {
			from: owner,
		});
		await setRewardsTokenExchangeRate();
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: stakingDualRewards.abi,
			ignoreParents: ['ReentrancyGuard', 'Owned'],
			expected: [
				'stake',
				'withdraw',
				'exit',
				'getReward',
				'notifyRewardAmount',
				'setPaused',
				'setDualRewardsDistribution',
				'setRewardsDuration',
				'recoverERC20',
				'updatePeriodFinish',
			],
		});
	});

	describe('Integration Tests', () => {
		before(async () => {
			// Set rewardDistribution address
			await stakingDualRewards.setDualRewardsDistribution(dualRewardsDistribution.address, {
				from: owner,
			});
			assert.equal(await stakingDualRewards.dualRewardsDistribution(), dualRewardsDistribution.address);

			await setRewardsTokenExchangeRate();
		});


	describe('Integration Tests', () => {
		before(async () => {
			// Set rewardDistribution address
			await stakingDualRewards.setDualRewardsDistribution(dualRewardsDistribution.address, {
				from: owner,
			});
			assert.equal(
				await stakingDualRewards.dualRewardsDistribution(),
				dualRewardsDistribution.address
			);

			await setRewardsTokenExchangeRate();
		});

		it('stake and claim', async () => {
			// Transfer some LP Tokens to user
			const totalToStake = toUnit('500');
			
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });

				// Stake LP Tokens
				await stakingToken.approve(stakingDualRewards.address, totalToStake, {
					from: stakingAccount1,
				});
				await stakingDualRewards.stake(totalToStake, { from: stakingAccount1 });

			// Distribute some rewards
			const totalToDistribute_RewardToken_A = toUnit('35000');
			const totalToDistribute_RewardToken_B = toUnit('35000');

			assert.equal(await dualRewardsDistribution.distributionsLength(), 0);
			await dualRewardsDistribution.addDualRewardsDistribution(
				totalToDistribute_RewardToken_A,
				totalToDistribute_RewardToken_B,
				stakingDualRewards.address,
				{
					from: owner,
				}
			);
			assert.equal(await dualRewardsDistribution.distributionsLength(), 1);

			// Transfer RewardsToken-A to the RewardsDistribution contract address
			await rewardsTokenA.transfer(dualRewardsDistribution.address, totalToDistribute_RewardToken_A, { from: owner });

			// Transfer RewardsToken-B to the RewardsDistribution contract address
			await rewardsTokenB.transfer(dualRewardsDistribution.address, totalToDistribute_RewardToken_B, { from: owner });

			// Distribute Rewards called from Synthetix contract as the authority to distribute
			await dualRewardsDistribution.distributeRewards(totalToDistribute_RewardToken_A, totalToDistribute_RewardToken_B, {
				from: authority,
			});

			// Period finish should be ~7 days from now
			const periodFinish = await stakingDualRewards.periodFinish();
			const curTimestamp = await currentTime();
		
			assert.equal(parseInt(periodFinish.toString(), 10), curTimestamp + DAY * 7);

			// Reward duration is 7 days, so we'll
			// Fastforward time by 6 days to prevent expiration
			await fastForward(DAY * 6);

			// Reward rate For RewardToken-A and reward per token
			const rewardRate_RewardToken_A = await stakingDualRewards.rewardRateA();
			assert.bnGt(rewardRate_RewardToken_A, ZERO_BN);

			const rewardPerToken_RewardToken_A = await stakingDualRewards.rewardPerTokenA();
			assert.bnGt(rewardPerToken_RewardToken_A, ZERO_BN);

			// Reward rate For RewardToken-B and reward per token
			const rewardRate_RewardToken_B = await stakingDualRewards.rewardRateB();
			assert.bnGt(rewardRate_RewardToken_B, ZERO_BN);

			const rewardPerToken_RewardToken_B = await stakingDualRewards.rewardPerTokenB();
			assert.bnGt(rewardPerToken_RewardToken_B, ZERO_BN);

			// Make sure we earned in proportion to reward per token - For RewardToken-A
			const rewards_RewardToken_A_Earned = await stakingDualRewards.earnedA(stakingAccount1);
			assert.bnEqual(rewards_RewardToken_A_Earned, rewardPerToken_RewardToken_A.mul(totalToStake).div(toUnit(1)));

			// Make sure we earned in proportion to reward per token - For RewardToken-B
			const rewards_RewardToken_B_Earned = await stakingDualRewards.earnedB(stakingAccount1);
			assert.bnEqual(rewards_RewardToken_B_Earned, rewardPerToken_RewardToken_B.mul(totalToStake).div(toUnit(1)));

			// Make sure after withdrawing, we still have the ~amount of rewardRewards
			// The two values will be a bit different as time has "passed"

			//User:stakingAccount1 Withdraws 100 LP tokens from stakingContract
			const initialWithdraw = toUnit('100');

			await stakingDualRewards.withdraw(initialWithdraw, { from: stakingAccount1 });
			assert.bnEqual(initialWithdraw, await stakingToken.balanceOf(stakingAccount1));

			//rewards of type rewardToken-A Post-Withdraw
			const rewards_RewardToken_A_Earned_Post_Withdraw = await stakingDualRewards.earnedA(stakingAccount1);

			//assert for the Delta-leftover/reminder of the rewards of type rewardToken-A
			assert.bnClose(rewards_RewardToken_A_Earned, rewards_RewardToken_A_Earned_Post_Withdraw, toUnit('0.1'));


			//rewards of type rewardToken-B Post-Withdraw
			const rewards_RewardToken_B_Earned_Post_Withdraw = await stakingDualRewards.earnedB(stakingAccount1);

			//assert for the Delta-leftover/reminder of the rewards of type rewardToken-B
			assert.bnClose(rewards_RewardToken_B_Earned, rewards_RewardToken_B_Earned_Post_Withdraw, toUnit('0.1'));


			// Get rewards ( transfer the rewards of type rewardToken-A allocated for stakingAccount1 )
			const initialRewardBal_RewardToken_A = await rewardsTokenA.balanceOf(stakingAccount1);
			await stakingDualRewards.getReward({ from: stakingAccount1 });
			const postRewardRewardBal_RewardToken_A = await rewardsTokenA.balanceOf(stakingAccount1);

			assert.bnGt(postRewardRewardBal_RewardToken_A, initialRewardBal_RewardToken_A);



			// Get rewards ( transfer the rewards of type rewardToken-B allocated for stakingAccount1 )
			const initialRewardBal_RewardToken_B = await rewardsTokenB.balanceOf(stakingAccount1);
			await stakingDualRewards.getReward({ from: stakingAccount1 });
			const postRewardRewardBal_RewardToken_B = await rewardsTokenB.balanceOf(stakingAccount1);

			assert.bnGt(postRewardRewardBal_RewardToken_B, initialRewardBal_RewardToken_B);

			// Exit
			const preExitLPBal = await stakingToken.balanceOf(stakingAccount1);
			await stakingDualRewards.exit({ from: stakingAccount1 });
			const postExitLPBal = await stakingToken.balanceOf(stakingAccount1);
			assert.bnGt(postExitLPBal, preExitLPBal);
		});
	});

	});
});
