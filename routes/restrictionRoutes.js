const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getRestrictions, addRestriction, updateRestriction, deleteRestriction } = require('../models/restrictionModel');

module.exports = function(app) {
    app.get('/api/restrictions', requireAuth, async (req, res) => {
        const restrictions = await getRestrictions();
        res.json(restrictions);
    });

    app.post('/api/restrictions', requireAuth, requireAdmin, async (req, res) => {
        const { truckNumber, driverName, restrictedFactories, reason } = req.body;
        const newRestriction = await addRestriction(truckNumber, driverName, restrictedFactories, reason, req.session.user.username);
        res.json(newRestriction);
    });

    app.put('/api/restrictions/:id', requireAuth, requireAdmin, async (req, res) => {
        const id = parseInt(req.params.id);
        const { active } = req.body;
        await updateRestriction(id, active);
        res.json({ success: true });
    });

    app.delete('/api/restrictions/:id', requireAuth, requireAdmin, async (req, res) => {
        const id = parseInt(req.params.id);
        await deleteRestriction(id);
        res.json({ success: true });
    });
};
