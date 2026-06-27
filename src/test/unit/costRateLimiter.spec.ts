import { expect } from 'chai'
import { describe, it } from 'mocha'

import { CostRateLimiter } from '../../app/utils/costRateLimiter.js'

describe('CostRateLimiter', function () {
	it('has budget available initially', function () {
		const limiter = new CostRateLimiter(10000, 100)
		expect(limiter.hasRemainingBudget('1.1.1.1')).to.be.true
	})

	it('depletes budget after charging', function () {
		let t = 0
		const limiter = new CostRateLimiter(10000, 100, () => t)
		limiter.charge('1.1.1.1', 100)
		expect(limiter.hasRemainingBudget('1.1.1.1')).to.be.false
	})

	it('budget can go negative from a single over-sized charge', function () {
		let t = 0
		const limiter = new CostRateLimiter(10000, 100, () => t)
		limiter.charge('1.1.1.1', 150)
		expect(limiter.remaining('1.1.1.1')).to.equal(0)
		expect(limiter.hasRemainingBudget('1.1.1.1')).to.be.false
	})

	it('accumulates charges correctly', function () {
		let t = 0
		const limiter = new CostRateLimiter(10000, 100, () => t)
		limiter.charge('1.1.1.1', 60)
		expect(limiter.remaining('1.1.1.1')).to.equal(40)
		limiter.charge('1.1.1.1', 40)
		expect(limiter.remaining('1.1.1.1')).to.equal(0)
		expect(limiter.hasRemainingBudget('1.1.1.1')).to.be.false
	})

	it('resets the window after windowMs elapses', function () {
		let t = 0
		const limiter = new CostRateLimiter(10000, 100, () => t)
		limiter.charge('1.1.1.1', 100)
		expect(limiter.hasRemainingBudget('1.1.1.1')).to.be.false

		t = 10001
		expect(limiter.hasRemainingBudget('1.1.1.1')).to.be.true
	})

	it('does not reset before the window elapses', function () {
		let t = 0
		const limiter = new CostRateLimiter(10000, 100, () => t)
		limiter.charge('1.1.1.1', 100)

		t = 9999
		expect(limiter.hasRemainingBudget('1.1.1.1')).to.be.false
	})

	it('isolates budgets per IP', function () {
		let t = 0
		const limiter = new CostRateLimiter(10000, 100, () => t)
		limiter.charge('1.1.1.1', 100)
		expect(limiter.hasRemainingBudget('1.1.1.1')).to.be.false
		expect(limiter.hasRemainingBudget('2.2.2.2')).to.be.true
	})

	it('returns correct remaining cost', function () {
		let t = 0
		const limiter = new CostRateLimiter(10000, 100, () => t)
		limiter.charge('1.1.1.1', 60)
		expect(limiter.remaining('1.1.1.1')).to.equal(40)
	})

	it('remaining resets to full budget after window expires', function () {
		let t = 0
		const limiter = new CostRateLimiter(10000, 100, () => t)
		limiter.charge('1.1.1.1', 80)
		t = 10001
		expect(limiter.remaining('1.1.1.1')).to.equal(100)
	})
})

