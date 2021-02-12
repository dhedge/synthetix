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
		mockRewardsDistributionAddress,
	] = accounts;

	// Synthetix is the rewardsTokenA
	let rewardsTokenA,
		rewardsTokenB,
		stakingToken,
		externalRewardsToken,
		exchangeRates,
		stakingRewards,
		rewardsDistribution,
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
			RewardsDistribution: rewardsDistribution,
			FeePool: feePool,
			Synthetix: rewardsTokenA,
			ExchangeRates: exchangeRates,
			SystemSettings: systemSettings,
		} = await setupAllContracts({
			accounts,
			contracts: ['RewardsDistribution', 'Synthetix', 'FeePool', 'SystemSettings'],
		}));

		stakingRewards = await setupContract({
			accounts,
			contract: 'StakingDualRewards',
			args: [
				owner,
				rewardsDistribution.address,
				rewardsTokenA.address,
				rewardsTokenB.address,
				stakingToken.address,
			],
		});

		await Promise.all([
			rewardsDistribution.setAuthority(authority, { from: owner }),
			rewardsDistribution.setRewardEscrow(rewardEscrowAddress, { from: owner }),
			rewardsDistribution.setSynthetixProxy(rewardsTokenA.address, { from: owner }),
			rewardsDistribution.setFeePoolProxy(feePool.address, { from: owner }),
		]);

		await stakingRewards.setRewardsDistribution(mockRewardsDistributionAddress, {
			from: owner,
		});
		await setRewardsTokenExchangeRate();
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: stakingRewards.abi,
			ignoreParents: ['ReentrancyGuard', 'Owned'],
			expected: [
				'stake',
				'withdraw',
				'exit',
				'getReward',
				'notifyRewardAmount',
				'setPaused',
				'setRewardsDistribution',
				'setRewardsDuration',
				'recoverERC20',
				'updatePeriodFinish',
			],
		});
	});

	describe('Constructor & Settings', () => {
		it('rewards token balance should rollover after DURATION', async () => {
			const totalToStake = toUnit('100');
			const totalToDistribute = toUnit('5000');

			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingRewards.address, totalToStake, { from: stakingAccount1 });
			await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

			await rewardsTokenA.transfer(stakingRewards.address, totalToDistribute, { from: owner });
			await stakingRewards.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY * 7);

			const earnedFirst = await stakingRewards.earnedA(stakingAccount1);
			console.log('earnedFirst: '+ earnedFirst.toString());
			await setRewardsTokenExchangeRate();

			await rewardsTokenA.transfer(stakingRewards.address, totalToDistribute, { from: owner });
			await stakingRewards.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY * 7);

			const earnedSecond = await stakingRewards.earnedA(stakingAccount1);
			console.log('earnedSecond (After Fastforward): '+ earnedSecond.toString());
			assert.bnEqual(earnedSecond, earnedFirst.add(earnedFirst));
		});
	});
});
