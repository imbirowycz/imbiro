"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const db_1 = require("./db");
const user_controller_1 = require("./modules/user/user.controller");
const app = (0, express_1.default)();
const port = Number(process.env.PORT) || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
app.use('/api/users', user_controller_1.userRouter);
async function main() {
    await (0, db_1.initDb)();
    app.listen(port, '0.0.0.0', () => {
        console.log(`Backend listening on http://0.0.0.0:${port}`);
    });
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
