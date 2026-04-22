// navbar.js - شريط التنقل الموحد (محدث)
(function() {
    // Keep-alive: كل 4 دقائق للحفاظ على الجلسة
    setInterval(async () => {
        try {
            await fetch('/api/me', { credentials: 'include' });
            console.log('navbar keep-alive');
        } catch(e) {}
    }, 4 * 60 * 1000);

    async function renderNavbar() {
        try {
            const res = await fetch('/api/me', { credentials: 'include' });
            const data = await res.json();
            if (!data.user) {
                window.location.href = '/login.html';
                return;
            }
            const role = data.user.role;
            const isAdmin = (role === 'admin');
            const isUser = (role === 'user');
            const isClient = (role === 'client');

            let navContainer = document.querySelector('.nav-links');
            if (!navContainer) {
                const container = document.querySelector('.container');
                if (!container) return;
                const header = document.querySelector('.header');
                if (header && header.nextSibling) {
                    navContainer = document.createElement('div');
                    navContainer.className = 'nav-links';
                    header.insertAdjacentElement('afterend', navContainer);
                } else {
                    return;
                }
            }

            // ========== الروابط الكاملة (تم إضافة expenses.html و cash_orders.html) ==========
            const allLinks = [
                { href: 'index.html', text: '📊 الرئيسية' },
                { href: 'orders.html', text: '📝 الطلبات' },
                { href: 'distribution.html', text: '🚚 التوزيع' },
                { href: 'trucks.html', text: '🚛 السيارات' },
                { href: 'products.html', text: '📦 أنواع البحص' },
                { href: 'factories.html', text: '🏭 المصانع' },
                { href: 'reports.html', text: '📊 تقارير الكسارة' },
                { href: 'scale_report.html', text: '⚖️ تقارير الميزان الشهرية' },
                { href: 'expenses.html', text: '💰 مصاريف السيارات' },
                { href: 'cash_orders.html', text: '💰 طلبات نقدية' },          // ✅ الصفحة الجديدة (طلبات نقدية)
                { href: 'distribution-quality.html', text: '📈 جودة التوزيع' },
                { href: 'trucks-failed.html', text: '⚠️ السيارات غير المستوفية' },
                { href: 'settings.html', text: '⚙️ الإعدادات' },
                { href: 'restrictions.html', text: '⛔ الحظر' },
                { href: 'users.html', text: '👥 المستخدمين' },
                { href: 'logs.html', text: '📜 السجلات' }
            ];

            let linksToShow = [];
            if (isAdmin || isUser) {
                linksToShow = allLinks;
            } else if (isClient) {
                linksToShow = [{ href: 'orders.html', text: '📝 الطلبات' }];
            }

            const currentPage = window.location.pathname.split('/').pop();
            navContainer.innerHTML = linksToShow.map(link => `
                <a href="${link.href}" class="nav-link ${currentPage === link.href ? 'active' : ''}">${link.text}</a>
            `).join('');

            // إضافة زر تسجيل الخروج (مرة واحدة فقط)
            if (!document.getElementById('logout-btn-container')) {
                const logoutDiv = document.createElement('div');
                logoutDiv.id = 'logout-btn-container';
                logoutDiv.style.cssText = 'position: absolute; top: 20px; left: 20px; z-index: 100;';
                const logoutBtn = document.createElement('button');
                logoutBtn.innerHTML = '🚪 تسجيل الخروج';
                logoutBtn.style.cssText = `
                    background: linear-gradient(135deg, #f5576c, #eb3349);
                    border: none;
                    padding: 8px 20px;
                    border-radius: 25px;
                    color: white;
                    font-weight: bold;
                    cursor: pointer;
                    transition: 0.3s;
                    font-size: 14px;
                `;
                logoutBtn.onmouseover = () => logoutBtn.style.transform = 'scale(1.05)';
                logoutBtn.onmouseout = () => logoutBtn.style.transform = 'scale(1)';
                logoutBtn.onclick = () => {
                    if (confirm('⚠️ هل أنت متأكد من تسجيل الخروج؟')) {
                        fetch('/api/logout', { method: 'POST', credentials: 'include' })
                            .then(() => { window.location.href = '/login.html'; })
                            .catch(() => { window.location.href = '/login.html'; });
                    }
                };
                logoutDiv.appendChild(logoutBtn);
                const header = document.querySelector('.header');
                if (header) {
                    header.style.position = 'relative';
                    header.appendChild(logoutDiv);
                }
            }
        } catch(e) {
            console.error('خطأ في renderNavbar:', e);
            window.location.href = '/login.html';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderNavbar);
    } else {
        renderNavbar();
    }
})();
