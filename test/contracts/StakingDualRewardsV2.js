const { contract } = require('hardhat');
const { toBN } = require('web3-utils');

const { toBytes32 } = require('../..');
const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');
const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');
const { mockToken, setupAllContracts, setupContract } = require('./setup');
const { currentTime, toUnit, fastForward } = require('../utils')();

contract('StakingDualRewardsV2', accounts => {
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
		stakingDualRewardsV2,
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

		stakingDualRewardsV2 = await setupContract({
			accounts,
			contract: 'StakingDualRewardsV2',
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

		await stakingDualRewardsV2.setRewardsDistribution(mockRewardsDistributionAddress, {
			from: owner,
		});
		await setRewardsTokenExchangeRate();
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: stakingDualRewardsV2.abi,
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
		//done();
	});

	describe('Constructor & Settings', () => {
		it('should set rewards token on constructor', async () => {
			console.log('running should set rewards token on constructor');
			assert.equal(await stakingDualRewardsV2.rewardsTokenA(), rewardsTokenA.address);
		});

		it('should staking token on constructor', async () => {
			console.log('running should staking token on constructor');
			assert.equal(await stakingDualRewardsV2.stakingToken(), stakingToken.address);
		});

		it('should set owner on constructor', async () => {
			console.log('running should set owner on constructor');
			const ownerAddress = await stakingDualRewardsV2.owner();
			assert.equal(ownerAddress, owner);
		});
	});

	describe('Function permissions', () => {
		const rewardValue = toUnit(1.0);

		before(async () => {
			await rewardsTokenA.transfer(stakingDualRewardsV2.address, rewardValue, { from: owner });
		});

		it('only owner can call notifyRewardAmount', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: stakingDualRewardsV2.notifyRewardAmount,
				args: [rewardValue, 0],
				address: mockRewardsDistributionAddress,
				accounts,
			});
		});

		it('only rewardsDistribution address can call notifyRewardAmount', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: stakingDualRewardsV2.notifyRewardAmount,
				args: [rewardValue, 0],
				address: mockRewardsDistributionAddress,
				accounts,
			});
		});

		it('only owner address can call setRewardsDuration', async () => {
			await fastForward(DAY * 7);
			await onlyGivenAddressCanInvoke({
				fnc: stakingDualRewardsV2.setRewardsDuration,
				args: [70],
				address: owner,
				accounts,
			});
		});

		it('only owner address can call setPaused', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: stakingDualRewardsV2.setPaused,
				args: [true],
				address: owner,
				accounts,
			});
		});

		it('only owner can call updatePeriodFinish', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: stakingDualRewardsV2.updatePeriodFinish,
				args: [0],
				address: owner,
				accounts,
			});
		});
	});

	describe('Pausable', async () => {
		beforeEach(async () => {
			await stakingDualRewardsV2.setPaused(true, { from: owner });
		});
		it('should revert calling stake() when paused', async () => {
			const totalToStake = toUnit('100');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });

			await assert.revert(
				stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 }),
				'This action cannot be performed while the contract is paused'
			);
		});
		it('should not revert calling stake() when unpaused', async () => {
			await stakingDualRewardsV2.setPaused(false, { from: owner });

			const totalToStake = toUnit('100');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });

			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });
		});
	});

	describe('External Rewards Recovery', () => {
		const amount = toUnit('5000');
		beforeEach(async () => {
			// Send ERC20 to StakingDualRewardsV2 Contract
			await externalRewardsToken.transfer(stakingDualRewardsV2.address, amount, { from: owner });
			assert.bnEqual(await externalRewardsToken.balanceOf(stakingDualRewardsV2.address), amount);
		});
		it('only owner can call recoverERC20', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: stakingDualRewardsV2.recoverERC20,
				args: [externalRewardsToken.address, amount],
				address: owner,
				accounts,
				reason: 'Only the contract owner may perform this action',
			});
		});
		it('should revert if recovering staking token', async () => {
			await assert.revert(
				stakingDualRewardsV2.recoverERC20(stakingToken.address, amount, {
					from: owner,
				}),
				'Cannot withdraw the staking token'
			);
		});
		it('should retrieve external token from StakingDualRewardsV2 and reduce contracts balance', async () => {
			await stakingDualRewardsV2.recoverERC20(externalRewardsToken.address, amount, {
				from: owner,
			});
			assert.bnEqual(await externalRewardsToken.balanceOf(stakingDualRewardsV2.address), ZERO_BN);
		});
		it('should retrieve external token from StakingDualRewardsV2 and increase owners balance', async () => {
			const ownerMOARBalanceBefore = await externalRewardsToken.balanceOf(owner);

			await stakingDualRewardsV2.recoverERC20(externalRewardsToken.address, amount, {
				from: owner,
			});

			const ownerMOARBalanceAfter = await externalRewardsToken.balanceOf(owner);
			assert.bnEqual(ownerMOARBalanceAfter.sub(ownerMOARBalanceBefore), amount);
		});
		it('should emit Recovered event', async () => {
			const transaction = await stakingDualRewardsV2.recoverERC20(externalRewardsToken.address, amount, {
				from: owner,
			});
			assert.eventEqual(transaction, 'Recovered', {
				token: externalRewardsToken.address,
				amount: amount,
			});
		});
	});

	describe('lastTimeRewardApplicable()', () => {
		it('should return 0', async () => {
			assert.bnEqual(await stakingDualRewardsV2.lastTimeRewardApplicable(), ZERO_BN);
		});

		describe('when updated', () => {
			it('should equal current timestamp', async () => {
				await stakingDualRewardsV2.notifyRewardAmount(toUnit(1.0), 0, {
					from: mockRewardsDistributionAddress,
				});

				const cur = await currentTime();
				const lastTimeReward = await stakingDualRewardsV2.lastTimeRewardApplicable();

				assert.equal(cur.toString(), lastTimeReward.toString());
			});
		});
	});

	describe('rewardPerTokenA()', () => {
		it('should return 0', async () => {
			assert.bnEqual(await stakingDualRewardsV2.rewardPerTokenA(), ZERO_BN);
		});

		it('should be > 0', async () => {
			const totalToStake = toUnit('100');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			const totalSupply = await stakingDualRewardsV2.totalSupply();
			assert.bnGt(totalSupply, ZERO_BN);

			const rewardValue = toUnit(5000.0);
			await rewardsTokenA.transfer(stakingDualRewardsV2.address, rewardValue, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(rewardValue, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY);

			const rewardPerToken = await stakingDualRewardsV2.rewardPerTokenA();
			assert.bnGt(rewardPerToken, ZERO_BN);
		});
	});

	describe('stake()', () => {
		it('staking increases staking balance', async () => {
			const totalToStake = toUnit('100');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });

			const initialStakeBal = await stakingDualRewardsV2.balanceOf(stakingAccount1);
			const initialLpBal = await stakingToken.balanceOf(stakingAccount1);

			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			const postStakeBal = await stakingDualRewardsV2.balanceOf(stakingAccount1);
			const postLpBal = await stakingToken.balanceOf(stakingAccount1);

			assert.bnLt(postLpBal, initialLpBal);
			assert.bnGt(postStakeBal, initialStakeBal);
		});

		it('cannot stake 0', async () => {
			await assert.revert(stakingDualRewardsV2.stake('0'), 'Cannot stake 0');
		});
	});

	describe('earnedA()', () => {
		it('should be 0 when not staking', async () => {
			assert.bnEqual(await stakingDualRewardsV2.earnedA(stakingAccount1), ZERO_BN);
		});

		it('should be > 0 when staking', async () => {
			const totalToStake = toUnit('100');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			const rewardValue = toUnit(5000.0);
			await rewardsTokenA.transfer(stakingDualRewardsV2.address, rewardValue, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(rewardValue, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY);

			const earned = await stakingDualRewardsV2.earnedA(stakingAccount1);

			assert.bnGt(earned, ZERO_BN);
		});

		it('rewardRate should increase if new rewards come before DURATION ends', async () => {
			const totalToDistribute = toUnit('5000');

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			const rewardRateInitial = await stakingDualRewardsV2.rewardRateA();

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			const rewardRateLater = await stakingDualRewardsV2.rewardRateA();

			assert.bnGt(rewardRateInitial, ZERO_BN);
			assert.bnGt(rewardRateLater, rewardRateInitial);
		});

		it('rewards token balance should rollover after DURATION', async () => {
			const totalToStake = toUnit('100');
			const totalToDistribute = toUnit('5000');

			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY * 7);

			const earnedFirst = await stakingDualRewardsV2.earnedA(stakingAccount1);
			console.log('earnedFirst: '+ earnedFirst.toString());
			await setRewardsTokenExchangeRate();

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY * 7);

			const earnedSecond = await stakingDualRewardsV2.earnedA(stakingAccount1);
			console.log('earnedSecond (After Fastforward): '+ earnedSecond.toString());

			assert.bnEqual(earnedSecond, earnedFirst.add(earnedFirst));
		});
	});

	describe('getReward()', () => {
		it('should increase rewards token balance', async () => {
			const totalToStake = toUnit('100');
			const totalToDistribute = toUnit('5000');

			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY);

			const initialRewardBal = await rewardsTokenA.balanceOf(stakingAccount1);
			const initialEarnedBal = await stakingDualRewardsV2.earnedA(stakingAccount1);
			await stakingDualRewardsV2.getReward({ from: stakingAccount1 });
			const postRewardBal = await rewardsTokenA.balanceOf(stakingAccount1);
			const postEarnedBal = await stakingDualRewardsV2.earnedA(stakingAccount1);

			assert.bnLt(postEarnedBal, initialEarnedBal);
			assert.bnGt(postRewardBal, initialRewardBal);
		});
	});

	describe('setRewardsDuration()', () => {
		const sevenDays = DAY * 7;
		const seventyDays = DAY * 70;
		it('should increase rewards duration before starting distribution', async () => {
			const defaultDuration = await stakingDualRewardsV2.rewardsDuration();
			assert.bnEqual(defaultDuration, sevenDays);

			await stakingDualRewardsV2.setRewardsDuration(seventyDays, { from: owner });
			const newDuration = await stakingDualRewardsV2.rewardsDuration();
			assert.bnEqual(newDuration, seventyDays);
		});
		it('should revert when setting setRewardsDuration before the period has finished', async () => {
			const totalToStake = toUnit('100');
			const totalToDistribute = toUnit('5000');

			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY);

			await assert.revert(
				stakingDualRewardsV2.setRewardsDuration(seventyDays, { from: owner }),
				'Previous rewards period must be complete before changing the duration for the new period'
			);
		});
		it('should update when setting setRewardsDuration after the period has finished', async () => {
			const totalToStake = toUnit('100');
			const totalToDistribute = toUnit('5000');

			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY * 8);

			const transaction = await stakingDualRewardsV2.setRewardsDuration(seventyDays, { from: owner });
			assert.eventEqual(transaction, 'RewardsDurationUpdated', {
				newDuration: seventyDays,
			});

			const newDuration = await stakingDualRewardsV2.rewardsDuration();
			assert.bnEqual(newDuration, seventyDays);

			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});
		});

		it('should update when setting setRewardsDuration after the period has finished', async () => {
			const totalToStake = toUnit('100');
			const totalToDistribute = toUnit('5000');

			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY * 4);
			await stakingDualRewardsV2.getReward({ from: stakingAccount1 });
			await fastForward(DAY * 4);

			// New Rewards period much lower
			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			const transaction = await stakingDualRewardsV2.setRewardsDuration(seventyDays, { from: owner });
			assert.eventEqual(transaction, 'RewardsDurationUpdated', {
				newDuration: seventyDays,
			});

			const newDuration = await stakingDualRewardsV2.rewardsDuration();
			assert.bnEqual(newDuration, seventyDays);

			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY * 71);
			await stakingDualRewardsV2.getReward({ from: stakingAccount1 });
		});
	});

	describe('getRewardForDuration()', () => {
		it('should increase rewards token balance', async () => {
			const totalToDistribute = toUnit('5000');
			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(totalToDistribute, 0, {
				from: mockRewardsDistributionAddress,
			});

			const rewardForDuration = await stakingDualRewardsV2.getRewardAForDuration();

			const duration = await stakingDualRewardsV2.rewardsDuration();
			const rewardRate = await stakingDualRewardsV2.rewardRateA();

			assert.bnGt(rewardForDuration, ZERO_BN);
			assert.bnEqual(rewardForDuration, duration.mul(rewardRate));
		});
	});

	describe('withdraw()', () => {
		it('cannot withdraw if nothing staked', async () => {
			await assert.revert(stakingDualRewardsV2.withdraw(toUnit('100')), 'SafeMath: subtraction overflow');
		});

		it('should increases lp token balance and decreases staking balance', async () => {
			const totalToStake = toUnit('100');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			const initialStakingTokenBal = await stakingToken.balanceOf(stakingAccount1);
			const initialStakeBal = await stakingDualRewardsV2.balanceOf(stakingAccount1);

			await stakingDualRewardsV2.withdraw(totalToStake, { from: stakingAccount1 });

			const postStakingTokenBal = await stakingToken.balanceOf(stakingAccount1);
			const postStakeBal = await stakingDualRewardsV2.balanceOf(stakingAccount1);

			assert.bnEqual(postStakeBal.add(toBN(totalToStake)), initialStakeBal);
			assert.bnEqual(initialStakingTokenBal.add(toBN(totalToStake)), postStakingTokenBal);
		});

		it('cannot withdraw 0', async () => {
			await assert.revert(stakingDualRewardsV2.withdraw('0'), 'Cannot withdraw 0');
		});
	});

	describe('updatePeriodFinish()', () => {
		const updateTimeStamp = toUnit('100');

		before(async () => {
			await stakingDualRewardsV2.updatePeriodFinish(updateTimeStamp, {
				from: owner,
			});
		});

		it('should update periodFinish', async () => {
			const periodFinish = await stakingDualRewardsV2.periodFinish();
			assert.bnEqual(periodFinish, updateTimeStamp);
		});

		it('should update rewardRate to zero', async () => {
			const rewardRate = await stakingDualRewardsV2.rewardRateA();
			assert.bnEqual(rewardRate, ZERO_BN);
		});
	});

	describe('exit()', () => {
		it('should retrieve all earned and increase rewards bal', async () => {
			const totalToStake = toUnit('100');
			const totalToDistribute = toUnit('5000');

			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			await rewardsTokenA.transfer(stakingDualRewardsV2.address, totalToDistribute, { from: owner });
			await stakingDualRewardsV2.notifyRewardAmount(toUnit(5000.0), 0, {
				from: mockRewardsDistributionAddress,
			});

			await fastForward(DAY);

			const initialRewardBal = await rewardsTokenA.balanceOf(stakingAccount1);
			const initialEarnedBal = await stakingDualRewardsV2.earnedA(stakingAccount1);
			await stakingDualRewardsV2.exit({ from: stakingAccount1 });
			const postRewardBal = await rewardsTokenA.balanceOf(stakingAccount1);
			const postEarnedBal = await stakingDualRewardsV2.earnedA(stakingAccount1);

			assert.bnLt(postEarnedBal, initialEarnedBal);
			assert.bnGt(postRewardBal, initialRewardBal);
			assert.bnEqual(postEarnedBal, ZERO_BN);
		});
	});

	describe('notifyRewardAmount()', () => {
		let localStakingRewards;

		before(async () => {
			localStakingRewards = await setupContract({
				accounts,
				contract: 'StakingDualRewardsV2',
				args: [
					owner,
					rewardsDistribution.address,
					rewardsTokenA.address,
					rewardsTokenB.address,
					stakingToken.address,
				],
			});

			await localStakingRewards.setRewardsDistribution(mockRewardsDistributionAddress, {
				from: owner,
			});
		});

		it('Reverts if the provided reward is greater than the balance.', async () => {
			const rewardValue = toUnit(1000);
			await rewardsTokenA.transfer(localStakingRewards.address, rewardValue, { from: owner });
			await assert.revert(
				localStakingRewards.notifyRewardAmount(rewardValue.add(toUnit(0.1)), 0, {
					from: mockRewardsDistributionAddress,
				}),
				'Provided reward-A too high'
			);
		});

		it('Reverts if the provided reward is greater than the balance, plus rolled-over balance.', async () => {
			const rewardValue = toUnit(1000);
			await rewardsTokenA.transfer(localStakingRewards.address, rewardValue, { from: owner });
			localStakingRewards.notifyRewardAmount(rewardValue, 0, {
				from: mockRewardsDistributionAddress,
			});
			await rewardsTokenA.transfer(localStakingRewards.address, rewardValue, { from: owner });
			// Now take into account any leftover quantity.
			await assert.revert(
				localStakingRewards.notifyRewardAmount(rewardValue.add(toUnit(0.1)), 0, {
					from: mockRewardsDistributionAddress,
				}),
				'Provided reward-A too high'
			);
		});
	});

	describe('Integration Tests', () => {
		before(async () => {
			// Set rewardDistribution address
			await stakingDualRewardsV2.setRewardsDistribution(rewardsDistribution.address, {
				from: owner,
			});
			assert.equal(await stakingDualRewardsV2.rewardsDistribution(), rewardsDistribution.address);

			await setRewardsTokenExchangeRate();
		});

		it('stake and claim', async () => {
			// Transfer some LP Tokens to user
			const totalToStake = toUnit('500');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });

			// Stake LP Tokens
			await stakingToken.approve(stakingDualRewardsV2.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewardsV2.stake(totalToStake, { from: stakingAccount1 });

			// Distribute some rewards
			const totalToDistribute = toUnit('35000');
			assert.equal(await rewardsDistribution.distributionsLength(), 0);
			await rewardsDistribution.addRewardDistribution(stakingDualRewardsV2.address, totalToDistribute, {
				from: owner,
			});
			assert.equal(await rewardsDistribution.distributionsLength(), 1);

			// Transfer Rewards to the RewardsDistribution contract address
			await rewardsTokenA.transfer(rewardsDistribution.address, totalToDistribute, { from: owner });

			// Distribute Rewards called from Synthetix contract as the authority to distribute
			await rewardsDistribution.distributeRewards(totalToDistribute, {
				from: authority,
			});

			// Period finish should be ~7 days from now
			const periodFinish = await stakingDualRewardsV2.periodFinish();
			const curTimestamp = await currentTime();

			console.log('periodFinish: ', periodFinish.toString());
			console.log('periodFinish-parsed: ', parseInt(periodFinish.toString(), 10));
			console.log('curTimestamp: ', curTimestamp.toString());
			console.log('curTimestamp-advanced-by-7-days: ', curTimestamp + DAY * 7);

			assert.equal(parseInt(periodFinish.toString(), 10), curTimestamp + DAY * 7);

			// Reward duration is 7 days, so we'll
			// Fastforward time by 6 days to prevent expiration
			await fastForward(DAY * 6);

			// Reward rate and reward per token
			const rewardRate = await stakingDualRewardsV2.rewardRateA();
			assert.bnGt(rewardRate, ZERO_BN);

			const rewardPerToken = await stakingDualRewardsV2.rewardPerTokenA();
			assert.bnGt(rewardPerToken, ZERO_BN);

			// Make sure we earned in proportion to reward per token
			const rewardRewardsEarned = await stakingDualRewardsV2.earnedA(stakingAccount1);
			assert.bnEqual(rewardRewardsEarned, rewardPerToken.mul(totalToStake).div(toUnit(1)));

			// Make sure after withdrawing, we still have the ~amount of rewardRewards
			// The two values will be a bit different as time has "passed"
			const initialWithdraw = toUnit('100');
			await stakingDualRewardsV2.withdraw(initialWithdraw, { from: stakingAccount1 });
			assert.bnEqual(initialWithdraw, await stakingToken.balanceOf(stakingAccount1));

			const rewardRewardsEarnedPostWithdraw = await stakingDualRewardsV2.earnedA(stakingAccount1);
			assert.bnClose(rewardRewardsEarned, rewardRewardsEarnedPostWithdraw, toUnit('0.1'));

			// Get rewards
			const initialRewardBal = await rewardsTokenA.balanceOf(stakingAccount1);
			await stakingDualRewardsV2.getReward({ from: stakingAccount1 });
			const postRewardRewardBal = await rewardsTokenA.balanceOf(stakingAccount1);
			assert.bnGt(postRewardRewardBal, initialRewardBal);

			// Exit
			const preExitLPBal = await stakingToken.balanceOf(stakingAccount1);
			await stakingDualRewardsV2.exit({ from: stakingAccount1 });
			const postExitLPBal = await stakingToken.balanceOf(stakingAccount1);
			assert.bnGt(postExitLPBal, preExitLPBal);
		});
	});
});
