function requireAuth(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}

function requireAdmin(req, res, next) {
    if (req.session.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}

module.exports = { requireAuth, requireAdmin };
