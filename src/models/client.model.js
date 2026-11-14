const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')
const { normPasport, normPinfl } = require('../utils/pasport.utils')

class ClientModel extends Model {}

ClientModel.init({
  id:      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code:    { type: DataTypes.STRING(30),  allowNull: true },
  name:    { type: DataTypes.STRING(200), allowNull: false },
  phone:   { type: DataTypes.STRING(30),  allowNull: true },
  address: { type: DataTypes.TEXT,        allowNull: true },
  balance: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  comment: { type: DataTypes.TEXT,        allowNull: true },
  active:  { type: DataTypes.BOOLEAN,     defaultValue: true },
  // Pasport (AA1234567) va JSHSHIR — nasiya shartnomasi va kredit tarixi uchun.
  // Bir xil ko'rinishda saqlanadi (katta harf, bo'sh joysiz), bo'sh — NULL.
  passport: {
    type: DataTypes.STRING(20), allowNull: true,
    set(v) { this.setDataValue('passport', normPasport(v)) },
  },
  pinfl: {
    type: DataTypes.STRING(14), allowNull: true,
    set(v) { this.setDataValue('pinfl', normPinfl(v)) },
  },
  // CRM: mijoz holati — qarz undirishda kim bilan qanday ishlashni belgilaydi
  status:  { type: DataTypes.STRING(20),  defaultValue: 'faol' },
  // Erkin yorliqlar ("VIP", "ehtiyot bo'l"...). JSON massiv sifatida saqlanadi.
  tags: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('tags')
      try { return raw ? JSON.parse(raw) : [] } catch { return [] }
    },
    set(val) {
      this.setDataValue('tags', Array.isArray(val) ? JSON.stringify(val) : null)
    },
  },
}, {
  sequelize,
  modelName: 'ClientModel',
  tableName: 'client',
  timestamps: true,
  underscored: true,
})

module.exports = ClientModel
