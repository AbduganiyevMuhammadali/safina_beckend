const UserModel = require('../models/user.model');
const HttpException = require('../utils/HttpException.utils');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { secret_jwt } = require('../startup/config');
const BaseController = require('./BaseController');
const { MyUser, MainUser } = require('../utils/userRoles.utils');
const { Op } = require('sequelize');
const moment = require('moment');
/******************************************************************************
 *                              User Controller
 ******************************************************************************/
// Parolni terib topishdan himoya: bir manzil + login bo'yicha ketma-ket
// 5 ta xato urinishdan keyin 5 daqiqa kutiladi. Kirish oynasida faqat
// qisqa parol so'ralgani uchun bu shart (sayt internetda ochiq).
const URINISH_MAX = 5
const BLOK_MS = 5 * 60 * 1000
const urinishlar = new Map()   // kalit -> { n, gacha }

class UserController extends BaseController {
    getAll = async (req, res, next) => {
        let modelList = await UserModel.findAll({
            where: {
                id: { [Op.ne]: MyUser }
            },
            order: [
                ['fullname', 'ASC'],
                ['id', 'ASC']
            ]
        });
        res.send(modelList);
    };

    getById = async (req, res, next) => {
        const user = await UserModel.findOne({
            where:{ id: req.params.id }
        });

        if (!user) {
            throw new HttpException(404, req.mf('data not found'));
        }

        res.send(user);
    };

    getByUsername = async (req, res, next) => {
        const user = await UserModel.findOne({where:{ username: req.params.username }});
        if (!user) {
            throw new HttpException(404, req.mf('data not found'));
        }

        res.send(user);
    };

    getCurrentUser = async (req, res, next) => {
        res.send(req.currentUser);
    };

    create = async (req, res, next) => {
        this.checkValidation(req);

        await this.hashPassword(req);
        let {
            username,
            fullname,
            password,
            role,
            email,
            warehouse,
            permissions,
            active,
        } = req.body;

        const model = await UserModel.create({
            username,
            fullname,
            password,
            role,
            email:       email       ?? null,
            warehouse:   warehouse   ?? null,
            permissions: permissions ?? null,
            active:      active !== undefined ? active : true,
        });

        if (!model) {
            throw new HttpException(500, req.mf('Something went wrong'));
        }

        res.status(201).send(model);
    };

    update = async (req, res, next) => {
        this.checkValidation(req);

        await this.hashPassword(req);
        let {
            username,
            fullname,
            password,
            role,
            email,
            warehouse,
            permissions,
            active,
        } = req.body;

        const model = await UserModel.findOne({ where: { id: req.params.id }} );

        if (!model) {
            throw new HttpException(404, req.mf('data not found'));
        }

        model.username = username;
        model.fullname = fullname;
        if (password) model.password = password;
        model.role = role;
        if (email       !== undefined) model.email       = email;
        if (warehouse   !== undefined) model.warehouse   = warehouse;
        if (permissions !== undefined) model.permissions = permissions;
        if (active      !== undefined) model.active      = active;
        await model.save();

        res.send(model);
    };

    delete = async (req, res, next) => {
        const model = await UserModel.findOne({ where : { id: req.params.id } })
        
        if (!model) {
            throw new HttpException(404, req.mf('data not found'));
        }

        if (model.id === MainUser) {
            throw new HttpException(400, req.mf('This item cannot be deleted'));
        }

        try {
            await model.destroy({ force: true });
        } catch (error) {
            await model.destroy();
        }

        res.send(req.mf('data has been deleted'));
    };

    userLogin = async (req, res, next) => {
        this.checkValidation(req);

        const { username, password: pass } = req.body;

        const kalit = `${req.ip}|${String(username || '').toLowerCase()}`;
        const holat = urinishlar.get(kalit);
        if (holat?.gacha > Date.now()) {
            const daq = Math.ceil((holat.gacha - Date.now()) / 60000);
            throw new HttpException(429, `Parol ko'p marta noto'g'ri kiritildi. ${daq} daqiqadan keyin qayta urinib ko'ring`);
        }
        const xato = () => {
            const n = (holat?.n || 0) + 1;
            urinishlar.set(kalit, n >= URINISH_MAX ? { n: 0, gacha: Date.now() + BLOK_MS } : { n, gacha: 0 });
            // Xotira o'smasin — eski yozuvlarni vaqti-vaqti bilan tozalaymiz
            if (urinishlar.size > 5000) for (const [k, v] of urinishlar) if (!(v.gacha > Date.now())) urinishlar.delete(k);
            throw new HttpException(401, req.mf('Incorrect login or password!'));
        };

        const user = await UserModel.findOne({
            where: {
                username
            }
        });

        if (!user) xato();

        const isMatch = await bcrypt.compare(pass, user.password);

        if (!isMatch) xato();
        urinishlar.delete(kalit);

        // user matched!
        const token = jwt.sign({ user_id: user.id.toString() }, secret_jwt, {
            expiresIn: '24h'
        });

        user.token = token;
        res.send(user);
    };

    // hash password if it exists
    hashPassword = async (req) => {
        if (req.body.password) {
            req.body.password = await bcrypt.hash(req.body.password, 8);
        }
    }
}



/******************************************************************************
 *                               Export
 ******************************************************************************/
module.exports = new UserController;