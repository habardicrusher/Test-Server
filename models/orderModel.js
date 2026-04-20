const { pool } = require('../db');

async function getDayData(date) {
    const res = await pool.query('SELECT orders, distribution FROM daily_data WHERE date = $1', [date]);
    if (res.rows.length === 0) return { orders: [], distribution: [] };
    return { orders: res.rows[0].orders, distribution: res.rows[0].distribution };
}

async function saveDayData(date, orders, distribution) {
    await pool.query(
        `INSERT INTO daily_data (date, orders, distribution) VALUES ($1, $2, $3)
         ON CONFLICT (date) DO UPDATE SET orders = $2, distribution = $3`,
        [date, JSON.stringify(orders), JSON.stringify(distribution)]
    );
}

module.exports = { getDayData, saveDayData };
