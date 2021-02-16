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

	describe('Constructor & Settings', () => {
		it('rewards token balance should rollover after DURATION', async () => {
			const totalToStake = toUnit('100');
			
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewards.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewards.stake(totalToStake, { from: stakingAccount1 });

			const totalToDistribute_RewardToken_A = toUnit('5000');
			const totalToDistribute_RewardToken_B = toUnit('5000');

			await rewardsTokenA.transfer(stakingDualRewards.address, totalToDistribute_RewardToken_A, { from: owner });
			await rewardsTokenB.transfer(stakingDualRewards.address, totalToDistribute_RewardToken_B, { from: owner });

			await stakingDualRewards.notifyRewardAmount(totalToDistribute_RewardToken_A, totalToDistribute_RewardToken_B, {
				from: mockDualRewardsDistributionAddress,
			});

			await fastForward(DAY * 7);

			const earnedFirst_RewardToken_A = await stakingDualRewards.earnedA(stakingAccount1);
			const earnedFirst_RewardToken_B = await stakingDualRewards.earnedB(stakingAccount1);

			await setRewardsTokenExchangeRate();

			await rewardsTokenA.transfer(stakingDualRewards.address, totalToDistribute_RewardToken_A, { from: owner });
			await rewardsTokenB.transfer(stakingDualRewards.address, totalToDistribute_RewardToken_B, { from: owner });

			await stakingDualRewards.notifyRewardAmount(totalToDistribute_RewardToken_A, totalToDistribute_RewardToken_B, {
				from: mockDualRewardsDistributionAddress,
			});

			await fastForward(DAY * 7);

			const earnedSecond_RewardToken_A = await stakingDualRewards.earnedA(stakingAccount1);
			assert.bnEqual(earnedSecond_RewardToken_A, earnedFirst_RewardToken_A.add(earnedFirst_RewardToken_A));

			const earnedSecond_RewardToken_B = await stakingDualRewards.earnedB(stakingAccount1);
			assert.bnEqual(earnedSecond_RewardToken_B, earnedFirst_RewardToken_B.add(earnedFirst_RewardToken_B));

		});
	});
});