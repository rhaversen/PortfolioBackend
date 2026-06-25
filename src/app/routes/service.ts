import { Router } from 'express'

import { BOX_SYSTEM } from '../websockets/sentientUselessBox.js'

const router = Router()

router.get('/livez', (_req, res) => {
	res.status(200).send('OK')
})

router.get('/readyz', (_req, res) => {
	res.status(200).send('OK')
})

router.get('/box/system-prompt', (_req, res) => {
	res.status(200).json({ systemPrompt: BOX_SYSTEM })
})

export default router
