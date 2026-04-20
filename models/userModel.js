const { pool } = require('../db');
const bcrypt = require('bcryptjs');

async function getUserByUsername(username) {
    const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return res.rows[0];
}

async function getUsers() {
    const res = await pool.query('SELECT id, username, role, factory, permissions, created_at FROM users');
    return res.rows;
}

async function createUser(username, password, role, factory, permissions) {
    const hashed = await bcrypt.hash(password, 10);
    const res = await pool.query(
        `INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [username, hashed, role, factory, permissions]
    );
    return res.rows[0];
}

async function updateUser(id, username, role, factory, permissions, newPassword = null) {
    let query = 'UPDATE users SET username = $1, role = $2, factory = $3, permissions = $4';
    let params = [username, role, factory, permissions];
    if (newPassword) {
        const hashed = await bcrypt.hash(newPassword, 10);
        query += ', password = $5';
        params.push(hashed);
    }
    query += ' WHERE id = $' + (params.length + 1);
    params.push(id);
    await pool.query(query, params);
}

async function deleteUser(id) {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
}

module.exports = { getUserByUsername, getUsers, createUser, updateUser, deleteUser };
