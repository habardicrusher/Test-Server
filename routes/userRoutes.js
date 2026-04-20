const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getUsers, createUser, updateUser, deleteUser, getUserByUsername } = require('../models/userModel');

module.exports = function(app) {
    app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
        const users = await getUsers();
        res.json(users);
    });

    app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
        const { username, password, role, factory, permissions } = req.body;
        const existing = await getUserByUsername(username);
        if (existing) return res.status(400).json({ error: 'اسم المستخدم موجود' });
        await createUser(username, password, role, factory, permissions);
        res.json({ success: true });
    });

    app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
        const id = parseInt(req.params.id);
        const { username, role, factory, permissions, password } = req.body;
        await updateUser(id, username, role, factory, permissions, password);
        res.json({ success: true });
    });

    app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
        const id = parseInt(req.params.id);
        await deleteUser(id);
        res.json({ success: true });
    });
};
