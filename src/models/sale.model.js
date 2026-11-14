const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class SaleModel extends Model {}

SaleModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  doc_number:   { type: DataTypes.INTEGER },
  date:         { type: DataTypes.DATE },
  warehouse:    { type: DataTypes.STRING(100), defaultValue: 'Asosiy ombor' },
  client_id:    { type: DataTypes.INTEGER,     allowNull: true },
  payment_type: { type: DataTypes.ENUM('Naqd', 'Karta', "O'tkazma", 'Qarz'), defaultValue: 'Naqd' },
  price_type:   { type: DataTypes.ENUM('chakana', 'ulgurji'),                 defaultValue: 'chakana' },
  total_sum:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  discount:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  paid_sum:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  debt_sum:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  // Qisman qaytarishlar yig'indisi (chegirma hisobga olingan holda)
  returned_sum: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  // Qarzni to'lash muddati — har sotuvga alohida belgilanadi.
  // Nasiyada — grafikdagi navbatdagi to'lanmagan oy sanasi.
  due_date:     { type: DataTypes.DATEONLY, allowNull: true },
  // Shu sotuv qarziga yozilgan to'lovlar. `debt_sum` dastlabki qarz
  // bo'lib qoladi (mijoz hisob varag'i shunga tayanadi), qolgan qarz =
  // debt_sum − debt_paid.
  debt_paid:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  // Nasiya (muddatli to'lov). `installment_months` bo'sh bo'lsa — oddiy sotuv
  installment_months:  { type: DataTypes.INTEGER, allowNull: true },
  installment_percent: { type: DataTypes.DECIMAL(7, 3), allowNull: true },
  installment_markup:  { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  // Naqd narx (chegirmadan keyin, ustamasiz) — shartnomada ko'rsatiladi
  installment_base:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  cashier_id:   { type: DataTypes.INTEGER, allowNull: true },
  status:       { type: DataTypes.ENUM('draft', 'completed', 'cancelled'), defaultValue: 'completed' },
  comment:      { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  modelName: 'SaleModel',
  tableName: 'sale',
  timestamps: true,
  underscored: true,
})

module.exports = SaleModel
