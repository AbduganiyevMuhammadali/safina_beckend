const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

/**
 * Nasiya grafigi — har oy uchun bitta satr.
 *
 * `amount` — shu oy to'lanishi kerak bo'lgan summa (qaytarishda kamayishi
 * mumkin), `paid` — shu oyga yozilgan to'lovlar. Qolgan = amount − paid.
 * Yig'indilar sotuvdagi qiymatlarga teng: Σamount = sale.debt_sum,
 * Σpaid = sale.debt_paid.
 */
class SaleInstallmentModel extends Model {}

SaleInstallmentModel.init({
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sale_id:   { type: DataTypes.INTEGER, allowNull: false },
  client_id: { type: DataTypes.INTEGER, allowNull: true },
  no:        { type: DataTypes.INTEGER, allowNull: false },
  due_date:  { type: DataTypes.DATEONLY, allowNull: false },
  amount:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  paid:      { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  paid_at:   { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  modelName: 'SaleInstallmentModel',
  tableName: 'sale_installment',
  timestamps: true,
  underscored: true,
})

module.exports = SaleInstallmentModel
