const { pool } = require('../db');

async function getRestrictions() {
    const res = await pool.query('SELECT * FROM restrictions ORDER BY created_at DESC');
    return res.rows;
}

async function addRestriction(truckNumber, driverName, restrictedFactories, reason, createdBy) {
    const res = await pool.query(
        `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [truckNumber, driverName, JSON.stringify(restrictedFactories), reason, createdBy]
    );
    return res.rows[0];
}

async function updateRestriction(id, active) {
    await pool.query('UPDATE restrictions SET active = $1 WHERE id = $2', [active, id]);
}

async function deleteRestriction(id) {
    await pool.query('DELETE FROM restrictions WHERE id = $1', [id]);
}

module.exports = { getRestrictions, addRestriction, updateRestriction, deleteRestriction };
