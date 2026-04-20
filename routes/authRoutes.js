
const bcrypt = require('bcryptjs');
const { getUserByUsername } = require('../models/userModel');

module.exports = function(app) {
    app.get('/api/me', (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'غير مصرح' });
        res.json({ user: req.session.user });
    });

    app.post('/api/login', async (req, res) => {
        const { username, password } = req.body;
        const user = await getUserByUsername(username);
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            factory: user.factory,
            permissions: user.permissions
        };
        res.json({ success: true, user: req.session.user });
    });

    app.post('/api/logout', (req, res) => {
        req.session.destroy();
        res.json({ success: true });
    });
};
