const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

/**
 * Yetkazuvchi bilan qo'lda kiritiladigan oldi-berdi:
 *   qarz  — biz qarzdormiz (masalan tizimdan oldingi qarz, akt-sverka bo'yicha)
 *   tolov — kassadan tashqari to'lov (oldin yoki boshqa manbadan to'langan;
 *           bugungi kassaga ta'sir qilmaydi)
 * Kirimlar (purchase) va kassadan to'lovlar (cash_transaction) alohida
 * jadvallarda — balans uchalasidan hisoblanadi.
 */
class SupplierEntryModel extends Model {}

SupplierEntryModel.init({
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  supplier_id:   { type: DataTypes.INTEGER, allowNull: false },
  date:          { type: DataTypes.DATE, allowNull: false },
  type:          { type: DataTypes.ENUM('qarz', 'tolov'), allowNull: false },
  amount:        { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },    // so'm
  amount_usd:    { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
  exchange_rate: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  comment:       { type: DataTypes.TEXT, allowNull: true },
  created_by:    { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  modelName: 'SupplierEntryModel',
  tableName: 'supplier_entry',
  timestamps: true,
  underscored: true,
})

module.exports = SupplierEntryModel
