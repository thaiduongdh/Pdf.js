// Dark mode toggle for PDF.js viewer
(function () {
    // Check saved preference or system preference
    const savedMode = localStorage.getItem('pdfjs-dark-mode');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedMode === 'dark' || (savedMode === null && prefersDark)) {
        document.body.classList.add('dark-mode');
    }

    // Create toggle button
    const btn = document.createElement('button');
    btn.id = 'darkModeToggle';
    btn.className = 'toolbarButton'; // Use PDF.js class
    btn.innerHTML = document.body.classList.contains('dark-mode') ? '<span>☀️</span>' : '<span>🌙</span>';
    btn.title = 'Toggle dark mode';
    btn.tabIndex = 0;

    btn.onclick = function () {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('pdfjs-dark-mode', isDark ? 'dark' : 'light');
        btn.innerHTML = isDark ? '<span>☀️</span>' : '<span>🌙</span>';
    };

    // Insert into toolbar (before secondary toolbar toggle)
    const toolbar = document.getElementById('toolbarViewerRight');
    if (toolbar) {
        // Try to insert before the secondary toolbar toggle (tools menu)
        const secondaryToggle = document.getElementById('secondaryToolbarToggle');
        if (secondaryToggle) {
            toolbar.insertBefore(btn, secondaryToggle);
        } else {
            toolbar.appendChild(btn);
        }
    } else {
        // Fallback
        document.body.appendChild(btn);
    }
})();
