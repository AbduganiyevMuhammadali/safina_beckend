const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/valyuta.controller')
const auth    = require('../middleware/auth.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')
const perm    = require('../middleware/perm.middleware')

// Kurs har kassaga kerak (narxlarni ko'rsatish uchun) — o'qish hammaga,
// o'zgartirish faqat sozlamalar huquqi borlarga
router.get('/', auth(), awaitHF(ctrl.get))
router.put('/', auth(), perm('settings', 'tahrir'), awaitHF(ctrl.save))

module.exports = router
