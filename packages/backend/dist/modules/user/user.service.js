"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const user_repository_1 = require("./user.repository");
class UserService {
    constructor(repository = new user_repository_1.UserRepository()) {
        this.repository = repository;
    }
    async createUser(dto) {
        return this.repository.create(dto);
    }
    async listUsers() {
        return this.repository.findAll();
    }
}
exports.UserService = UserService;
