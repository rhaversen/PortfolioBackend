import { Router } from 'express'

const router = Router()

router.get('/livez', (_req, res) => {
	res.status(200).send('OK')
})

router.get('/readyz', (_req, res) => {
	res.status(200).send('OK')
})

export default router
