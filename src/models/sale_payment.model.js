const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

/**
 * Qarz to'lovining qaysi sotuvga yozilgani.
 *
 * Mijoz bitta to'lov qilsa ham u bir necha sotuv (shartnoma) orasida
 * taqsimlanishi mumkin — har biriga alohida satr yoziladi. Shartnoma
 * bo'yicha to'lovlar tarixi shu jadvaldan olinadi.
 */
class SalePaymentModel extends Model {}

SalePaymentModel.init({
  id:                  { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sale_id:             { type: DataTypes.INTEGER, allowNull: false },
  client_id:           { type: DataTypes.INTEGER, allowNull: true },
  cash_transaction_id: { type: DataTypes.INTEGER, allowNull: true },
  date:                { type: DataTypes.DATE },
  amount:              { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  payment_type:        { type: DataTypes.STRING(20), allowNull: true },
  cashier_name:        { type: DataTypes.STRING(100), allowNull: true },
}, {
  sequelize,
  modelName: 'SalePaymentModel',
  tableName: 'sale_payment',
  timestamps: true,
  underscored: true,
})

module.exports = SalePaymentModel
