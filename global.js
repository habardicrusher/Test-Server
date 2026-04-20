// global.js - إضافة زر تسجيل الخروج بشكل ثابت في جميع الصفحات
(function() {
    // التأكد من أن المستخدم مسجل الدخول
    fetch('/api/me', { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.user) {
                addLogoutButton();
            }
        })
        .catch(() => {});

    function addLogoutButton() {
        // تجنب إضافة الزر أكثر من مرة
        if (document.getElementById('global-logout-btn')) return;

        // إنشاء الزر
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'global-logout-btn';
        logoutBtn.innerHTML = '🚪 تسجيل الخروج';
        logoutBtn.style.cssText = `
            position: fixed;
            top: 15px;
            left: 15px;
            z-index: 9999;
            background: linear-gradient(135deg, #f5576c, #eb3349);
            border: none;
            padding: 8px 20px;
            border-radius: 30px;
            color: white;
            font-weight: bold;
            cursor: pointer;
            font-size: 14px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            transition: 0.2s;
        `;
        logoutBtn.onmouseover = () => logoutBtn.style.transform = 'scale(1.02)';
        logoutBtn.onmouseout = () => logoutBtn.style.transform = 'scale(1)';
        logoutBtn.onclick = () => {
            if (confirm('⚠️ هل أنت متأكد من تسجيل الخروج؟')) {
                fetch('/api/logout', { method: 'POST', credentials: 'include' })
                    .then(() => { window.location.href = '/login.html'; })
                    .catch(() => { window.location.href = '/login.html'; });
            }
        };

        document.body.appendChild(logoutBtn);

        // إضافة مسافة علوية للصفحة حتى لا يغطي الزر المحتوى
        const style = document.createElement('style');
        style.textContent = `
            body {
                padding-top: 60px !important;
            }
            @media (max-width: 768px) {
                body {
                    padding-top: 70px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }
})();