const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/supplier.controller')
const auth    = require('../middleware/auth.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')
const perm    = require('../middleware/perm.middleware')

router.get('/',              auth(), awaitHF(ctrl.getAll))
router.get('/:id',           auth(), awaitHF(ctrl.getById))
router.get('/:id/purchases', auth(), awaitHF(ctrl.getPurchases))
router.get('/:id/ledger',   auth(), awaitHF(ctrl.getLedger))
router.post('/',             auth(), perm('suppliers', 'qoshish'), awaitHF(ctrl.create))
router.post('/:id/pay',      auth(), perm('suppliers', 'tahrir'),  awaitHF(ctrl.pay))
router.post('/:id/debt',     auth(), perm('suppliers', 'tahrir'),  awaitHF(ctrl.debt))
router.delete('/:id/entries/:entryId', auth(), perm('suppliers', 'tahrir'), awaitHF(ctrl.deleteEntry))
router.put('/:id',           auth(), perm('suppliers', 'tahrir'),  awaitHF(ctrl.update))
router.delete('/:id',        auth(), perm('suppliers', 'tahrir'),  awaitHF(ctrl.delete))

module.exports = router
