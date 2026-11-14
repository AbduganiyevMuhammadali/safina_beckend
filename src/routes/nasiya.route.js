const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/nasiya.controller')
const auth    = require('../middleware/auth.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')
const perm    = require('../middleware/perm.middleware')

// Foizlar har kassirga kerak (sotuvda hisoblash uchun) — o'qish hammaga,
// o'zgartirish faqat sozlamalar huquqi borlarga.
router.get('/config', auth(), awaitHF(ctrl.getConfig))
router.put('/config', auth(), perm('settings', 'tahrir'), awaitHF(ctrl.saveConfig))

// Kredit tarixi (pasport / JSHSHIR / mijoz bo'yicha) va pasportni yozib qo'yish.
// `/:saleId` dan OLDIN turishi shart, aks holda "kredit" id deb olinadi.
router.get('/kredit',   auth(), awaitHF(ctrl.kredit))
router.post('/pasport', auth(), perm('sales', 'qoshish'), awaitHF(ctrl.pasportSaqla))

// Shartnomalar — mijoz ma'lumoti, "partners" huquqiga bog'langan
router.get('/',         auth(), awaitHF(ctrl.list))
router.get('/:saleId',  auth(), awaitHF(ctrl.getOne))

module.exports = router
