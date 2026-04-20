// logout.js - يضيف زر خروج في أعلى الصفحة مع تأكيد
(function() {
    // التأكد من أن المستخدم مسجل الدخول (اختياري)
    fetch('/api/me', { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.user) {
                createLogoutButton();
            }
        })
        .catch(() => {});

    function createLogoutButton() {
        // البحث عن شريط التنقل أو إنشاء منطقة للزر
        let navLinks = document.querySelector('.nav-links');
        let header = document.querySelector('.header');
        
        if (!navLinks && header) {
            // إنشاء div للزر فوق شريط التنقل
            const logoutDiv = document.createElement('div');
            logoutDiv.style.textAlign = 'left';
            logoutDiv.style.margin = '10px 20px';
            logoutDiv.style.direction = 'ltr';
            const btn = document.createElement('button');
            btn.innerText = '🚪 تسجيل الخروج';
            btn.style.cssText = `
                background: linear-gradient(135deg, #f5576c, #eb3349);
                border: none;
                padding: 8px 20px;
                border-radius: 25px;
                color: white;
                font-weight: bold;
                cursor: pointer;
                transition: 0.3s;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            `;
            btn.onmouseover = () => btn.style.transform = 'scale(1.05)';
            btn.onmouseout = () => btn.style.transform = 'scale(1)';
            btn.onclick = () => {
                if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
                    fetch('/api/logout', { method: 'POST', credentials: 'include' })
                        .then(() => {
                            window.location.href = '/login.html';
                        })
                        .catch(() => {
                            window.location.href = '/login.html';
                        });
                }
            };
            logoutDiv.appendChild(btn);
            // إدراج الزر قبل شريط التنقل
            if (navLinks) {
                header.insertBefore(logoutDiv, navLinks);
            } else {
                header.appendChild(logoutDiv);
            }
        } else if (navLinks) {
            // إضافة زر بجانب الروابط
            const logoutItem = document.createElement('a');
            logoutItem.href = '#';
            logoutItem.innerText = '🚪 تسجيل الخروج';
            logoutItem.style.cssText = `
                background: linear-gradient(135deg, #f5576c, #eb3349);
                color: white;
                padding: 12px 24px;
                border-radius: 12px;
                text-decoration: none;
                font-weight: 600;
                margin-right: auto;
            `;
            logoutItem.onclick = (e) => {
                e.preventDefault();
                if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
                    fetch('/api/logout', { method: 'POST', credentials: 'include' })
                        .then(() => window.location.href = '/login.html')
                        .catch(() => window.location.href = '/login.html');
                }
            };
            navLinks.style.display = 'flex';
            navLinks.style.alignItems = 'center';
            navLinks.appendChild(logoutItem);
        }
    }
})();