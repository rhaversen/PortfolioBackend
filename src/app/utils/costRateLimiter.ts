import { type Socket } from 'socket.io'

import logger from './logger.js'
import config from './setupConfig.js'

interface Entry {
	windowStart: number
	usedCost: number
}

export class CostRateLimiter {
	private readonly windowMs: number
	private readonly maxCost: number
	private readonly store = new Map<string, Entry>()
	private readonly now: () => number

	constructor (windowMs: number, maxCost: number, now: () => number = Date.now) {
		this.windowMs = windowMs
		this.maxCost = maxCost
		this.now = now
	}

	private getEntry (ip: string, now: number): Entry {
		const existing = this.store.get(ip)
		if (existing === undefined || now - existing.windowStart >= this.windowMs) {
			const fresh: Entry = { windowStart: now, usedCost: 0 }
			this.store.set(ip, fresh)
			return fresh
		}
		return existing
	}

	hasRemainingBudget (ip: string): boolean {
		return this.remaining(ip) > 0
	}

	charge (ip: string, cost: number): void {
		const entry = this.getEntry(ip, this.now())
		entry.usedCost += cost
	}

	remaining (ip: string): number {
		const entry = this.getEntry(ip, this.now())
		return Math.max(0, this.maxCost - entry.usedCost)
	}

	retryAfterMs (ip: string): number {
		const entry = this.store.get(ip)
		if (entry === undefined) { return 0 }
		const elapsed = this.now() - entry.windowStart
		return Math.max(0, this.windowMs - elapsed)
	}
}

const burstLimiter = new CostRateLimiter(config.costLimiterBurstWindowMs, config.costLimiterBurstBudget)
const sustainedLimiter = new CostRateLimiter(config.costLimiterSustainedWindowMs, config.costLimiterSustainedBudget)

export function getSocketIp (socket: Socket): string {
	const forwarded = socket.handshake.headers['x-forwarded-for']
	if (typeof forwarded === 'string') {
		return forwarded.split(',')[0].trim()
	}
	return socket.handshake.address
}

export function computeCost (outputTokens: number, inputTokens: number): number {
	const inputCost = inputTokens * config.inputPricePerMillionTokens / 1_000_000
	const outputCost = outputTokens * config.outputPricePerMillionTokens / 1_000_000
	return inputCost + outputCost
}

export function checkBudgetAvailable (ip: string): { allowed: boolean; retryAfterMs: number } {
	const burstExhausted = !burstLimiter.hasRemainingBudget(ip)
	const sustainedExhausted = !sustainedLimiter.hasRemainingBudget(ip)
	if (burstExhausted || sustainedExhausted) {
		const retryMs = Math.max(
			burstExhausted ? burstLimiter.retryAfterMs(ip) : 0,
			sustainedExhausted ? sustainedLimiter.retryAfterMs(ip) : 0
		)
		logger.warn('Cost rate limit exceeded', {
			ip,
			burstRemaining: burstLimiter.remaining(ip),
			sustainedRemaining: sustainedLimiter.remaining(ip),
			retryAfterMs: retryMs
		})
		return { allowed: false, retryAfterMs: retryMs }
	}
	return { allowed: true, retryAfterMs: 0 }
}

export function chargeCost (ip: string, cost: number): void {
	burstLimiter.charge(ip, cost)
	sustainedLimiter.charge(ip, cost)
	logger.info('Cost charged', {
		ip,
		costDollars: cost.toFixed(6),
		burstRemainingDollars: burstLimiter.remaining(ip).toFixed(6),
		sustainedRemainingDollars: sustainedLimiter.remaining(ip).toFixed(6)
	})
}
