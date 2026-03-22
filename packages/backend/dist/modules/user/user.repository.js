"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRepository = void 0;
const db_1 = require("../../db");
class UserRepository {
    async create(dto) {
        const result = await db_1.pool.query(`INSERT INTO users (email, name) VALUES ($1, $2)
       RETURNING id, email, name`, [dto.email, dto.name]);
        const row = result.rows[0];
        return { id: row.id, email: row.email, name: row.name };
    }
    async findAll() {
        const result = await db_1.pool.query(`SELECT id, email, name FROM users ORDER BY created_at DESC`);
        return result.rows.map((row) => ({
            id: row.id,
            email: row.email,
            name: row.name,
        }));
    }
}
exports.UserRepository = UserRepository;
