"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRouter = void 0;
const express_1 = require("express");
const user_service_1 = require("./user.service");
const service = new user_service_1.UserService();
exports.userRouter = (0, express_1.Router)();
exports.userRouter.get('/', async (_req, res) => {
    try {
        const users = await service.listUsers();
        res.json(users);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list users' });
    }
});
exports.userRouter.post('/', async (req, res) => {
    try {
        const body = req.body;
        if (!body?.email || !body?.password || !body?.name) {
            res.status(400).json({ error: 'email, password, and name are required' });
            return;
        }
        const user = await service.createUser(body);
        res.status(201).json(user);
    }
    catch (err) {
        if (isUniqueViolation(err)) {
            res.status(409).json({ error: 'Email already exists' });
            return;
        }
        console.error(err);
        res.status(500).json({ error: 'Failed to create user' });
    }
});
function isUniqueViolation(err) {
    return (typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        err.code === '23505');
}
