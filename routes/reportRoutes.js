const { requireAuth } = require('../middleware/auth');
const { getDayData } = require('../models/orderModel');

module.exports = function(app) {
    app.get('/api/reports', requireAuth, async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            const start = new Date(startDate);
            const end = new Date(endDate);
            let allDistributions = [], dailyData = {}, driverStats = {}, factoryStats = {}, materialStats = {};

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const dayData = await getDayData(dateStr);
                if (dayData.distribution && dayData.distribution.length) {
                    dailyData[dateStr] = dayData.distribution.length;
                    dayData.distribution.forEach(dist => {
                        dist.date = dateStr;
                        allDistributions.push(dist);
                        const key = dist.truck?.number;
                        if (key) {
                            if (!driverStats[key]) driverStats[key] = { number: key, driver: dist.truck.driver, total: 0 };
                            driverStats[key].total++;
                        }
                        const factory = dist.factory;
                        if (factory) {
                            if (!factoryStats[factory]) factoryStats[factory] = { name: factory, total: 0 };
                            factoryStats[factory].total++;
                        }
                        const material = dist.material;
                        if (material) {
                            if (!materialStats[material]) materialStats[material] = { name: material, total: 0 };
                            materialStats[material].total++;
                        }
                    });
                }
            }
            res.json({ allDistributions, dailyData, driverStats: Object.values(driverStats), factoryStats: Object.values(factoryStats), materialStats: Object.values(materialStats), startDate, endDate });
        } catch (err) {
            console.error('Error in /api/reports:', err);
            res.status(500).json({ error: 'فشل في جلب التقارير' });
        }
    });
};
