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
	return outputTokens + Math.ceil(inputTokens / 5)
}

export function checkBudgetAvailable (ip: string): boolean {
	if (!burstLimiter.hasRemainingBudget(ip) || !sustainedLimiter.hasRemainingBudget(ip)) {
		logger.warn('Cost rate limit exceeded', {
			ip,
			burstRemaining: burstLimiter.remaining(ip),
			sustainedRemaining: sustainedLimiter.remaining(ip)
		})
		return false
	}
	return true
}

export function chargeCost (ip: string, cost: number): void {
	burstLimiter.charge(ip, cost)
	sustainedLimiter.charge(ip, cost)
	logger.debug('Cost charged', {
		ip,
		cost,
		burstRemaining: burstLimiter.remaining(ip),
		sustainedRemaining: sustainedLimiter.remaining(ip)
	})
}
