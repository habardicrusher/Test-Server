const { requireAuth } = require('../middleware/auth');
const { getDayData, saveDayData } = require('../models/orderModel');

module.exports = function(app) {
    app.get('/api/day/:date', requireAuth, async (req, res) => {
        const data = await getDayData(req.params.date);
        res.json(data);
    });

    app.put('/api/day/:date', requireAuth, async (req, res) => {
        try {
            const { orders, distribution } = req.body;
            await saveDayData(req.params.date, orders, distribution);
            res.json({ success: true });
        } catch (err) {
            console.error('PUT /api/day/:date error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
